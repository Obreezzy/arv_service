// backend/services/riskEngine.js
// ARV Defaulters Management System v2
// ─────────────────────────────────────────────────────────────────────────────
// Exports:
//   calculateRiskScore(patientId, activeWeatherAlerts?)  — single patient
//   batchCalculateRisk(patientIds, activeWeatherAlerts?) — dashboard / bulk
//   checkMLHealth()                                      — server startup check
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const axios  = require('axios');
const { Pool } = require('pg');

const ML_API_URL   = process.env.ML_API_URL || 'https://arv-service-ml.onrender.com';
const FLASK_TIMEOUT = 8000; // ms — Render cold-start can be slow

const pool = new Pool({
    host     : process.env.DB_HOST,
    port     : process.env.DB_PORT,
    database : process.env.DB_NAME,
    user     : process.env.DB_USER,
    password : process.env.DB_PASSWORD,
    ssl      : { rejectUnauthorized: false },
});


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — FEATURE COMPUTATION QUERY
// Aggregates all 4 tables into the exact 28 features the XGBoost model expects.
// All NULLs are COALESCE'd so the model never receives a NULL value.
// ═════════════════════════════════════════════════════════════════════════════
const FEATURE_QUERY = `
WITH patient_base AS (
    SELECT
        p.id                                                             AS patient_id,
        EXTRACT(YEAR FROM AGE(p.date_of_birth))::INT                    AS age,
        CASE WHEN LOWER(p.gender) = 'male' THEN 1 ELSE 0 END           AS gender_m,
        CASE WHEN p.has_supporter   THEN 1 ELSE 0 END                   AS has_supporter,
        CASE WHEN p.tb_flag         THEN 1 ELSE 0 END                   AS tb_flag,
        CASE WHEN p.pregnancy_flag  THEN 1 ELSE 0 END                   AS pregnancy_flag,
        p.marital_enc,        -- 0=Single 1=Married 2=Divorced 3=Widowed
        p.functional_enc,     -- 0=Working 1=Ambulatory 2=Bedridden
        p.chronic_score,
        p.who_clinical_stage, -- 1–4
        p.months_on_art,
        p.regimen_changes,
        p.location            -- used for weather alert matching
    FROM patients p
    WHERE p.id = ANY($1::int[])
),

pickup_agg AS (
    SELECT
        mp.patient_id,
        COALESCE(ROUND(AVG(CASE WHEN mp.was_missed      THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS missed_rate,
        COALESCE(ROUND(AVG(mp.days_late)::NUMERIC, 2), 0)                                        AS avg_days_late,
        COALESCE(ROUND(AVG(CASE WHEN mp.days_late > 7   THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS pct_very_late,
        COALESCE(ROUND(AVG(CASE WHEN mp.is_mmd          THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS mmd_rate,
        COALESCE(ROUND(AVG(mp.days_supply)::NUMERIC, 2), 30)                                     AS avg_days_supply,
        COALESCE(ROUND(AVG(CASE WHEN mp.had_stock_out   THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS stock_out_rate,
        COALESCE(ROUND(AVG(CASE WHEN mp.had_side_effect THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS side_effect_rate,
        COALESCE(ROUND(AVG(CASE WHEN mp.had_counselling THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS counselling_rate,
        COALESCE(SUM(mp.pharm_reg_change::INT), 0)                                               AS pharm_reg_changes,
        -- Latest weight and BMI via correlated subquery (most recent pickup date)
        COALESCE((
            SELECT mp2.weight_kg FROM medication_pickups mp2
            WHERE mp2.patient_id = mp.patient_id AND mp2.weight_kg IS NOT NULL
            ORDER BY mp2.pickup_date DESC LIMIT 1
        ), 0) AS latest_weight,
        COALESCE((
            SELECT mp2.bmi FROM medication_pickups mp2
            WHERE mp2.patient_id = mp.patient_id AND mp2.bmi IS NOT NULL
            ORDER BY mp2.pickup_date DESC LIMIT 1
        ), 0) AS latest_bmi
    FROM medication_pickups mp
    WHERE mp.patient_id = ANY($1::int[])
    GROUP BY mp.patient_id
),

lab_agg AS (
    SELECT
        lr.patient_id,
        -- Latest CD4
        COALESCE((
            SELECT lr2.result_value FROM lab_results lr2
            WHERE lr2.patient_id = lr.patient_id AND lr2.test_type = 'CD4'
            ORDER BY lr2.test_date DESC LIMIT 1
        ), 0) AS latest_cd4,
        -- First (baseline) CD4
        COALESCE((
            SELECT lr2.result_value FROM lab_results lr2
            WHERE lr2.patient_id = lr.patient_id AND lr2.test_type = 'CD4'
            ORDER BY lr2.test_date ASC LIMIT 1
        ), 0) AS first_cd4,
        -- CD4 improvement = latest minus baseline
        COALESCE((
            SELECT late.result_value - early.result_value
            FROM
                (SELECT result_value FROM lab_results
                 WHERE patient_id = lr.patient_id AND test_type = 'CD4'
                 ORDER BY test_date DESC LIMIT 1) late,
                (SELECT result_value FROM lab_results
                 WHERE patient_id = lr.patient_id AND test_type = 'CD4'
                 ORDER BY test_date ASC LIMIT 1) early
        ), 0) AS cd4_improvement,
        -- VL suppression rate (proportion of VL tests that were suppressed)
        COALESCE(ROUND(AVG(
            CASE
                WHEN lr.test_type = 'VL' AND lr.is_suppressed THEN 1.0
                WHEN lr.test_type = 'VL'                      THEN 0.0
                ELSE NULL
            END
        )::NUMERIC, 4), 0) AS vl_sup_rate,
        -- Latest VL suppression status (binary)
        COALESCE((
            SELECT CASE WHEN lr2.is_suppressed THEN 1 ELSE 0 END
            FROM lab_results lr2
            WHERE lr2.patient_id = lr.patient_id AND lr2.test_type = 'VL'
            ORDER BY lr2.test_date DESC LIMIT 1
        ), 0) AS latest_vl_suppressed,
        -- Best haemoglobin reading
        COALESCE((
            SELECT MAX(lr2.result_value) FROM lab_results lr2
            WHERE lr2.patient_id = lr.patient_id AND lr2.test_type = 'HB'
        ), 0) AS best_hb
    FROM lab_results lr
    WHERE lr.patient_id = ANY($1::int[])
    GROUP BY lr.patient_id
)

SELECT
    -- Patient identity
    pb.patient_id,
    pb.location,

    -- ── 11 features from patients ──────────────────────────────────────────
    pb.age,
    pb.gender_m,
    pb.has_supporter,
    pb.tb_flag,
    pb.pregnancy_flag,
    pb.marital_enc,
    pb.functional_enc,
    pb.chronic_score,
    pb.who_clinical_stage,
    pb.months_on_art,
    pb.regimen_changes,

    -- ── 11 features from medication_pickups ───────────────────────────────
    COALESCE(pa.missed_rate,        0) AS missed_rate,
    COALESCE(pa.avg_days_late,      0) AS avg_days_late,
    COALESCE(pa.pct_very_late,      0) AS pct_very_late,
    COALESCE(pa.mmd_rate,           0) AS mmd_rate,
    COALESCE(pa.avg_days_supply,   30) AS avg_days_supply,
    COALESCE(pa.stock_out_rate,     0) AS stock_out_rate,
    COALESCE(pa.side_effect_rate,   0) AS side_effect_rate,
    COALESCE(pa.counselling_rate,   0) AS counselling_rate,
    COALESCE(pa.pharm_reg_changes,  0) AS pharm_reg_changes,
    COALESCE(pa.latest_weight,      0) AS latest_weight,
    COALESCE(pa.latest_bmi,         0) AS latest_bmi,

    -- ── 6 features from lab_results ───────────────────────────────────────
    COALESCE(la.latest_cd4,            0) AS latest_cd4,
    COALESCE(la.first_cd4,             0) AS first_cd4,
    COALESCE(la.cd4_improvement,       0) AS cd4_improvement,
    COALESCE(la.vl_sup_rate,           0) AS vl_sup_rate,
    COALESCE(la.latest_vl_suppressed,  0) AS latest_vl_suppressed,
    COALESCE(la.best_hb,               0) AS best_hb

FROM patient_base pb
LEFT JOIN pickup_agg pa ON pa.patient_id = pb.patient_id
LEFT JOIN lab_agg    la ON la.patient_id = pb.patient_id;
`;


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — HELPERS
// ═════════════════════════════════════════════════════════════════════════════

// ── Encoding translation tables ───────────────────────────────────────────────
// Your DB stores integer codes; Flask's build_feature_vector() expects the
// original string labels so it can re-encode using its own maps (which were
// used during model training). We translate back to those strings here.
//
// MARITAL — DB: 0=Single 1=Married 2=Divorced 3=Widowed
//           Flask ms_map: single=0 divorced=1 cohabiting=2 married=3 widowed=4
const MARITAL_DB_TO_FLASK = { 0: 'single', 1: 'married', 2: 'divorced', 3: 'widowed' };

// FUNCTIONAL — DB: 0=Working 1=Ambulatory 2=Bedridden
//              Flask fn_map: bedridden=0 ambulatory=1 working=2
const FUNCTIONAL_DB_TO_FLASK = { 0: 'working', 1: 'ambulatory', 2: 'bedridden' };

/**
 * Converts a features row from the DB into the named dict Flask /predict
 * expects. Flask's build_feature_vector() reads keys by name (patient.get('age')
 * etc.), NOT by position — so we must send a dict, not an array.
 *
 * Also translates encoding integers back to the string labels Flask uses
 * for marital_status, functional_status, and gender.
 */
const buildFlaskPayload = (f) => ({
    // Demographics
    age                  : f.age,
    gender               : f.gender_m === 1 ? 'M' : 'F',   // Flask checks str == 'M'
    treatment_supporter  : f.has_supporter,                  // Flask key name
    tb_coinfection       : f.tb_flag,                        // Flask key name
    pregnancy_status     : f.pregnancy_flag,                 // Flask key name
    marital_status       : MARITAL_DB_TO_FLASK[f.marital_enc]      ?? 'single',
    functional_status    : FUNCTIONAL_DB_TO_FLASK[f.functional_enc] ?? 'working',
    chronic_conditions   : 'none',   // Flask maps string → score; we pass pre-computed score below
    chronic_score        : f.chronic_score, // also sent directly in case Flask reads it
    who_clinical_stage   : f.who_clinical_stage,
    months_on_art        : f.months_on_art,

    // Appointment behaviour
    regimen_changes      : f.regimen_changes,
    avg_days_late        : f.avg_days_late,
    pct_very_late        : f.pct_very_late,
    missed_rate          : f.missed_rate,
    side_effect_rate     : f.side_effect_rate,
    counselling_rate     : f.counselling_rate,

    // Pharmacy
    mmd_rate             : f.mmd_rate,
    avg_days_supply      : f.avg_days_supply,
    stock_out_rate       : f.stock_out_rate,
    pharm_reg_changes    : f.pharm_reg_changes,

    // Anthropometry
    latest_weight        : f.latest_weight,
    latest_bmi           : f.latest_bmi,
    best_hb              : f.best_hb,

    // Lab results
    latest_cd4           : f.latest_cd4,
    first_cd4            : f.first_cd4,
    cd4_improvement      : f.cd4_improvement,
    vl_sup_rate          : f.vl_sup_rate,
    latest_vl_suppressed : f.latest_vl_suppressed,
});

/** Convert 0–100 integer score to risk label */
const scoreToLabel = (score) => {
    if (score >= 75) return 'High';
    if (score >= 40) return 'Medium';
    return 'Low';
};

/**
 * Apply weather alert boost (+15) if patient's location matches an alert zone.
 * Preserved from original riskEngine.js.
 */
const applyWeatherBoost = (result, patientLocation, activeWeatherAlerts = []) => {
    if (!activeWeatherAlerts.length) return result;

    const location = (patientLocation || '').toLowerCase();
    const affected = activeWeatherAlerts.some(
        zone => location.includes(zone.toLowerCase())
    );

    if (affected) {
        const boostedScore = Math.min(100, result.score + 15);
        return {
            ...result,
            score   : boostedScore,
            label   : scoreToLabel(boostedScore),
            factors : [...(result.factors || []), 'Active Weather Alert in Area'],
        };
    }
    return result;
};

/**
 * Human-readable explanation of the key risk drivers.
 * Returned alongside score so the frontend can show "why" without
 * requiring the clinician to interpret raw numbers.
 */
const buildRiskFactors = (f, weatherBoosted = false) => {
    const factors = [];

    if (f.missed_rate >= 0.3)            factors.push(`High missed pickup rate (${Math.round(f.missed_rate * 100)}%)`);
    if (f.pct_very_late >= 0.2)          factors.push(`Frequently very late for pickups (${Math.round(f.pct_very_late * 100)}%)`);
    if (f.avg_days_late >= 7)            factors.push(`Average ${Math.round(f.avg_days_late)} days late per pickup`);
    if (f.latest_vl_suppressed === 0)    factors.push('Viral load not suppressed');
    if (f.vl_sup_rate < 0.5)             factors.push(`Low VL suppression history (${Math.round(f.vl_sup_rate * 100)}%)`);
    if (f.latest_cd4 < 200)             factors.push(`Low CD4 count (${f.latest_cd4} cells/μL)`);
    if (f.who_clinical_stage >= 3)       factors.push(`Advanced WHO stage (${f.who_clinical_stage})`);
    if (f.functional_enc === 2)          factors.push('Bedridden — limited mobility');
    if (f.tb_flag === 1)                 factors.push('Active TB co-infection');
    if (f.side_effect_rate >= 0.3)       factors.push(`Frequent side effects (${Math.round(f.side_effect_rate * 100)}% of visits)`);
    if (f.has_supporter === 0)           factors.push('No treatment supporter');
    if (f.chronic_score >= 2)            factors.push(`Multiple chronic conditions (score: ${f.chronic_score})`);
    if (f.stock_out_rate >= 0.2)         factors.push(`Stock-outs affected ${Math.round(f.stock_out_rate * 100)}% of visits`);
    if (weatherBoosted)                  factors.push('Active Weather Alert in Area');

    // Protective factors (show as positives)
    if (f.counselling_rate >= 0.7)       factors.push(`✓ High counselling rate (${Math.round(f.counselling_rate * 100)}%)`);
    if (f.mmd_rate >= 0.5)               factors.push('✓ On multi-month dispensing');
    if (f.has_supporter === 1)           factors.push('✓ Has treatment supporter');

    return factors.length ? factors : ['No significant risk flags identified'];
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — FALLBACK WEIGHTED SCORE ENGINE
// Used when Flask is down. Mirrors feature importance order of the XGBoost model.
// Returns 0–100 integer.
// ═════════════════════════════════════════════════════════════════════════════
const computeFallbackScore = (f) => {
    let score = 0;

    // Adherence signals — highest weight group
    score += f.missed_rate                          * 25;  // 0–25
    score += f.pct_very_late                        * 15;  // 0–15
    score += Math.min(f.avg_days_late / 30, 1)      * 10;  // 0–10

    // Virological / immunological status
    score += (1 - f.vl_sup_rate)                    * 12;  // 0–12
    score += (1 - f.latest_vl_suppressed)           *  8;  // 0–8
    score += Math.max(0, (500 - f.latest_cd4) / 500) * 8;  // 0–8

    // Clinical severity
    score += ((f.who_clinical_stage - 1) / 3)       *  7;  // 0–7
    score += (f.functional_enc / 2)                 *  5;  // 0–5

    // Comorbidities & co-infections
    score += Math.min(f.chronic_score * 2, 6);             // 0–6
    score += f.tb_flag                              *  3;  // 0–3
    score += f.side_effect_rate                     *  4;  // 0–4

    // Supply chain issues
    score += f.stock_out_rate                       *  3;  // 0–3

    // Protective factors — subtract
    score -= f.counselling_rate                     *  5;  // 0 to -5
    score -= f.mmd_rate                             *  3;  // 0 to -3
    score -= f.has_supporter                        *  3;  // 0 or -3

    return Math.min(100, Math.max(0, Math.round(score)));
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — AUDIT TRAIL
// Saves every prediction to risk_scores for clinical auditability.
// ═════════════════════════════════════════════════════════════════════════════
const saveToAuditTrail = async (client, patientId, score, label, source, features) => {
    try {
        await client.query(
            `INSERT INTO risk_scores
                (patient_id, risk_score, risk_label, prediction_source, feature_snapshot, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [patientId, score, label, source, JSON.stringify(features)]
        );
    } catch (auditErr) {
        // Audit failure must NEVER break the prediction response
        console.error(`[riskEngine] Audit trail write failed for patient ${patientId}:`, auditErr.message);
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — CORE SCORING LOGIC (shared by single + batch)
// Takes a features row, calls Flask, falls back if needed, applies weather.
// ═════════════════════════════════════════════════════════════════════════════
const scoreOnePatient = async (features, activeWeatherAlerts = []) => {
    // Build named dict — Flask reads keys by name, NOT by array position
    const flaskPayload = buildFlaskPayload(features);
    let score, flaskFactors, predictionSource;

    try {
        const mlResponse = await axios.post(
            `${ML_API_URL}/predict`,
            flaskPayload,   // ← named dict, not { features: [...] }
            { timeout: FLASK_TIMEOUT, headers: { 'Content-Type': 'application/json' } }
        );
        score        = mlResponse.data.score;        // Flask returns integer 0–100 directly
        flaskFactors = mlResponse.data.factors || []; // Flask also builds factors — use them
        predictionSource = 'ml_model';
    } catch (flaskErr) {
        console.warn(`[riskEngine] Flask unavailable (${flaskErr.message}). Using fallback engine.`);
        score            = computeFallbackScore(features);
        flaskFactors     = [];
        predictionSource = 'fallback_engine';
    }

    const weatherBoosted = activeWeatherAlerts.length > 0 &&
        activeWeatherAlerts.some(zone =>
            (features.location || '').toLowerCase().includes(zone.toLowerCase())
        );

    if (weatherBoosted) {
        score = Math.min(100, score + 15);
    }

    const label = scoreToLabel(score);

    // Merge Flask's factors (when available) with local risk factor analysis.
    // Flask factors use ↑/↓ arrows; local ones are plain text — both shown.
    const localFactors = buildRiskFactors(features, weatherBoosted);
    const factors = flaskFactors.length
        ? [...flaskFactors, ...localFactors.filter(f => f.startsWith('✓'))] // add protective positives
        : localFactors;

    return { score, label, factors, predictionSource };
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 — PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════

/**
 * calculateRiskScore
 * Single patient — called by the "Run AI Risk Predictor" button.
 *
 * @param {number}   patientId
 * @param {string[]} activeWeatherAlerts  e.g. ['Harare', 'Bulawayo']
 * @returns {Object} { patientId, score, label, factors, predictionSource, features }
 */
const calculateRiskScore = async (patientId, activeWeatherAlerts = []) => {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(FEATURE_QUERY, [[patientId]]);

        if (!rows.length) {
            throw new Error(`Patient ${patientId} not found or has no data.`);
        }

        const features = rows[0];
        const { score, label, factors, predictionSource } = await scoreOnePatient(features, activeWeatherAlerts);

        await saveToAuditTrail(client, patientId, score, label, predictionSource, features);

        return { patientId, score, label, factors, predictionSource, features };

    } finally {
        client.release();
    }
};


/**
 * batchCalculateRisk
 * Multiple patients — used by the dashboard to bulk-score a list.
 * Runs ONE database query for all patients (efficient), then scores each.
 *
 * @param {number[]} patientIds
 * @param {string[]} activeWeatherAlerts
 * @returns {Array}  [{ patientId, score, label, factors, predictionSource }]
 */
const batchCalculateRisk = async (patientIds, activeWeatherAlerts = []) => {
    if (!patientIds.length) return [];

    const client = await pool.connect();
    try {
        // One query fetches features for ALL patients in the list
        const { rows } = await client.query(FEATURE_QUERY, [patientIds]);

        if (!rows.length) return [];

        // Score all patients concurrently
        const results = await Promise.all(
            rows.map(async (features) => {
                const { score, label, factors, predictionSource } =
                    await scoreOnePatient(features, activeWeatherAlerts);

                await saveToAuditTrail(
                    client, features.patient_id, score, label, predictionSource, features
                );

                return {
                    patientId        : features.patient_id,
                    score,
                    label,
                    factors,
                    predictionSource,
                };
            })
        );

        // Return in same order as input patientIds
        const resultMap = Object.fromEntries(results.map(r => [r.patientId, r]));
        return patientIds.map(id => resultMap[id] || null).filter(Boolean);

    } finally {
        client.release();
    }
};


/**
 * checkMLHealth
 * Call on server startup to confirm Flask ML API is reachable.
 *
 * @returns {boolean}
 */
const checkMLHealth = async () => {
    try {
        const res = await axios.get(`${ML_API_URL}/health`, { timeout: 10000 });
        console.log(`✓ ML Risk Engine online — model: ${res.data.model || 'XGBoost'}`);
        return true;
    } catch (err) {
        console.warn('⚠  ML Risk Engine offline — fallback score engine will be used.');
        console.warn(`   Expected at: ${ML_API_URL}`);
        return false;
    }
};


module.exports = { calculateRiskScore, batchCalculateRisk, checkMLHealth };