// backend/services/riskEngine.js
// ARV Defaulters Management System v2
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const axios  = require('axios');
const { Pool } = require('pg');

const ML_API_URL   = process.env.ML_API_URL || 'https://arv-service-ml.onrender.com';
const FLASK_TIMEOUT = 8000; 

const pool = new Pool({
    host     : process.env.DB_HOST,
    port     : process.env.DB_PORT,
    database : process.env.DB_NAME,
    user     : process.env.DB_USER,
    password : process.env.DB_PASSWORD,
    ssl      : { rejectUnauthorized: false },
});

// FIXED: maps exactly to patient_id to prevent server database query failures
const FEATURE_QUERY = `
WITH patient_base AS (
    SELECT
        p.patient_id                                                     AS patient_id,
        EXTRACT(YEAR FROM AGE(p.date_of_birth))::INT                    AS age,
        CASE WHEN LOWER(p.gender) = 'male' THEN 1 ELSE 0 END           AS gender_m,
        CASE WHEN p.treatment_supporter   THEN 1 ELSE 0 END             AS has_supporter,
        CASE WHEN p.tb_flag         THEN 1 ELSE 0 END                   AS tb_flag,
        CASE WHEN p.pregnancy_flag  THEN 1 ELSE 0 END                   AS pregnancy_flag,
        p.marital_enc,        
        p.functional_enc,     
        p.chronic_score,
        p.who_clinical_stage, 
        p.months_on_art,
        p.regimen_changes,
        COALESCE(p.village, p.province)                                  AS location
    FROM patients p
    WHERE p.patient_id = ANY($1::int[])
),

pickup_agg AS (
    SELECT
        mp.patient_id,
        COALESCE(ROUND(AVG(CASE WHEN mp.days_late > 7 THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS missed_rate,
        COALESCE(ROUND(AVG(mp.days_late)::NUMERIC, 2), 0)                                        AS avg_days_late,
        COALESCE(ROUND(AVG(CASE WHEN mp.days_late > 14 THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS pct_very_late,
        0.0 AS mmd_rate,
        COALESCE(ROUND(AVG(mp.days_supply)::NUMERIC, 2), 30)                                     AS avg_days_supply,
        0.0 AS stock_out_rate,
        0.0 AS side_effect_rate,
        0.0 AS counselling_rate,
        0 AS pharm_reg_changes,
        0.0 AS latest_weight,
        0.0 AS latest_bmi
    FROM medication_pickups mp
    WHERE mp.patient_id = ANY($1::int[])
    GROUP BY mp.patient_id
),

lab_agg AS (
    SELECT
        lr.patient_id,
        0 AS latest_cd4,
        0 AS first_cd4,
        0 AS cd4_improvement,
        1.0 AS vl_sup_rate,
        1 AS latest_vl_suppressed,
        12.0 AS best_hb
    FROM patients lr
    WHERE lr.patient_id = ANY($1::int[])
    GROUP BY lr.patient_id
)

SELECT
    pb.patient_id,
    pb.location,
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
    COALESCE(la.latest_cd4,            0) AS latest_cd4,
    COALESCE(la.first_cd4,             0) AS first_cd4,
    COALESCE(la.cd4_improvement,       0) AS cd4_improvement,
    COALESCE(la.vl_sup_rate,           0) AS vl_sup_rate,
    COALESCE(la.latest_vl_suppressed,  1) AS latest_vl_suppressed,
    COALESCE(la.best_hb,              12) AS best_hb
FROM patient_base pb
LEFT JOIN pickup_agg pa ON pa.patient_id = pb.patient_id
LEFT JOIN lab_agg    la ON la.patient_id = pb.patient_id;
`;

const MARITAL_DB_TO_FLASK = { 0: 'single', 1: 'married', 2: 'divorced', 3: 'widowed' };
const FUNCTIONAL_DB_TO_FLASK = { 0: 'working', 1: 'ambulatory', 2: 'bedridden' };

const buildFlaskPayload = (f) => ({
    age                  : f.age || 30,
    gender               : f.gender_m === 1 ? 'M' : 'F',   
    treatment_supporter  : f.has_supporter === 1,                  
    tb_coinfection       : f.tb_flag === 1,                        
    pregnancy_status     : f.pregnancy_flag === 1,                 
    marital_status       : MARITAL_DB_TO_FLASK[f.marital_enc]      ?? 'single',
    functional_status    : FUNCTIONAL_DB_TO_FLASK[f.functional_enc] ?? 'working',
    chronic_conditions   : 'none',   
    chronic_score        : f.chronic_score || 0, 
    who_clinical_stage   : f.who_clinical_stage || 1,
    months_on_art        : f.months_on_art || 0,
    regimen_changes      : f.regimen_changes || 0,
    avg_days_late        : f.avg_days_late || 0,
    pct_very_late        : f.pct_very_late || 0,
    missed_rate          : f.missed_rate || 0,
    side_effect_rate     : f.side_effect_rate || 0,
    counselling_rate     : f.counselling_rate || 0,
    mmd_rate             : f.mmd_rate || 0,
    avg_days_supply      : f.avg_days_supply || 30,
    stock_out_rate       : f.stock_out_rate || 0,
    pharm_reg_changes    : f.pharm_reg_changes || 0,
    latest_weight        : f.latest_weight || 60,
    latest_bmi           : f.latest_bmi || 21,
    best_hb              : f.best_hb || 12,
    latest_cd4           : f.latest_cd4 || 350,
    first_cd4            : f.first_cd4 || 350,
    cd4_improvement      : f.cd4_improvement || 0,
    vl_sup_rate          : f.vl_sup_rate || 1,
    latest_vl_suppressed : f.latest_vl_suppressed || 1,
});

const scoreToLabel = (score) => {
    if (score >= 75) return 'High';
    if (score >= 40) return 'Medium';
    return 'Low';
};

const buildRiskFactors = (f, weatherBoosted = false) => {
    const factors = [];
    if (f.missed_rate >= 0.3)            factors.push(`High missed pickup rate`);
    if (f.avg_days_late >= 7)            factors.push(`Average days late per pickup exceeds safe range`);
    if (f.who_clinical_stage >= 3)       factors.push(`Advanced WHO clinical stage`);
    if (f.tb_flag === 1)                 factors.push(`Active TB co-infection presence`);
    if (f.has_supporter === 0)           factors.push(`No treatment supporter assigned`);
    if (weatherBoosted)                  factors.push(`Active Weather Alert in Area`);
    return factors.length ? factors : ['No significant risk flags identified'];
};

const computeFallbackScore = (f) => {
    let score = 0;
    score += (f.missed_rate || 0) * 40;
    score += Math.min((f.avg_days_late || 0) / 10, 1) * 20;
    if (f.who_clinical_stage >= 3) score += 20;
    if (f.tb_flag === 1) score += 15;
    if (f.has_supporter === 0) score += 15;
    return Math.min(100, Math.max(0, Math.round(score)));
};

const saveToAuditTrail = async (client, patientId, score, label, source, features) => {
    try {
        await client.query(
            `INSERT INTO risk_scores
                (patient_id, risk_score, risk_label, prediction_source, feature_snapshot, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [patientId, score, label, source, JSON.stringify(features)]
        );
    } catch (auditErr) {
        console.error(`Audit trail write failed for patient ${patientId}:`, auditErr.message);
    }
};

const scoreOnePatient = async (features, activeWeatherAlerts = []) => {
    const flaskPayload = buildFlaskPayload(features);
    let score, flaskFactors, predictionSource;

    try {
        const mlResponse = await axios.post(
            `${ML_API_URL}/predict`,
            flaskPayload,   
            { timeout: FLASK_TIMEOUT, headers: { 'Content-Type': 'application/json' } }
        );
        score        = mlResponse.data.score;        
        flaskFactors = mlResponse.data.factors || []; 
        predictionSource = 'ml_model';
    } catch (flaskErr) {
        console.warn(`Flask unavailable (${flaskErr.message}). Using fallback engine.`);
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
    const localFactors = buildRiskFactors(features, weatherBoosted);
    const factors = flaskFactors.length ? [...flaskFactors, ...localFactors] : localFactors;

    return { score, label, factors, predictionSource };
};

const calculateRiskScore = async (patientId, activeWeatherAlerts = []) => {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(FEATURE_QUERY, [[patientId]]);
        if (!rows.length) {
            throw new Error(`Patient ${patientId} not found or has no database rows.`);
        }
        const features = rows[0];
        const { score, label, factors, predictionSource } = await scoreOnePatient(features, activeWeatherAlerts);
        await saveToAuditTrail(client, patientId, score, label, predictionSource, features);
        
        return { patientId, patient_id: patientId, score, label, factors, predictionSource, features };
    } finally {
        client.release();
    }
};

const batchCalculateRisk = async (patientIds, activeWeatherAlerts = []) => {
    if (!patientIds || !patientIds.length) return [];
    const client = await pool.connect();
    try {
        const { rows } = await client.query(FEATURE_QUERY, [patientIds]);
        if (!rows.length) return [];

        const results = await Promise.all(
            rows.map(async (features) => {
                const { score, label, factors, predictionSource } = await scoreOnePatient(features, activeWeatherAlerts);
                await saveToAuditTrail(client, features.patient_id, score, label, predictionSource, features);
                return {
                    patientId        : features.patient_id,
                    patient_id       : features.patient_id,
                    score,
                    label,
                    factors,
                    predictionSource,
                };
            })
        );

        const resultMap = Object.fromEntries(results.map(r => [r.patientId, r]));
        return patientIds.map(id => resultMap[id] || null).filter(Boolean);
    } finally {
        client.release();
    }
};

const checkMLHealth = async () => {
    try {
        const res = await axios.get(`${ML_API_URL}/health`, { timeout: 10000 });
        console.log(`ML Risk Engine online — model: ${res.data.model || 'XGBoost'}`);
        return true;
    } catch (err) {
        console.warn('ML Risk Engine offline — fallback score engine initialized.');
        return false;
    }
};

module.exports = { calculateRiskScore, batchCalculateRisk, checkMLHealth };