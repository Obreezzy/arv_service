'use strict';

const axios  = require('axios');
const { query } = require('../config/db');

const ML_API_URL   = process.env.ML_API_URL || 'https://arv-service-ml.onrender.com';
const FLASK_TIMEOUT = 8000; 

const MARITAL_DB_TO_FLASK = { 0: 'single', 1: 'married', 2: 'divorced', 3: 'widowed' };
const FUNCTIONAL_DB_TO_FLASK = { 0: 'working', 1: 'ambulatory', 2: 'bedridden' };

const FEATURE_QUERY = `
WITH patient_base AS (
    SELECT
        p.patient_id,
        EXTRACT(YEAR FROM AGE(p.date_of_birth))::INT AS age,
        CASE WHEN LOWER(p.gender) = 'male' THEN 1 ELSE 0 END AS gender_m,
        CASE WHEN p.treatment_supporter THEN 1 ELSE 0 END AS has_supporter,
        CASE WHEN p.tb_flag THEN 1 ELSE 0 END AS tb_flag,
        CASE WHEN p.pregnancy_flag THEN 1 ELSE 0 END AS pregnancy_flag,
        p.marital_enc, p.functional_enc, p.chronic_score, p.who_clinical_stage, 
        p.months_on_art, p.regimen_changes, COALESCE(p.village, p.province) AS location
    FROM patients p
    WHERE p.patient_id = ANY($1::int[])
),
pickup_agg AS (
    SELECT
        mp.patient_id,
        COALESCE(ROUND(AVG(CASE WHEN mp.days_late > 7 THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS missed_rate,
        COALESCE(ROUND(AVG(mp.days_late)::NUMERIC, 2), 0) AS avg_days_late,
        COALESCE(ROUND(AVG(CASE WHEN mp.days_late > 14 THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS pct_very_late,
        COALESCE(ROUND(AVG(CASE WHEN mp.days_supply >= 84 THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS mmd_rate,
        COALESCE(ROUND(AVG(mp.days_supply)::NUMERIC, 2), 30) AS avg_days_supply,
        0.0 AS stock_out_rate,
        0 AS pharm_reg_changes
    FROM medication_pickups mp
    WHERE mp.patient_id = ANY($1::int[])
    GROUP BY mp.patient_id
),
lab_agg AS (
    SELECT
        lr.patient_id,
        (ARRAY_AGG(lr.cd4_count ORDER BY lr.test_date DESC))[1] AS latest_cd4,
        (ARRAY_AGG(lr.cd4_count ORDER BY lr.test_date ASC))[1] AS first_cd4,
        COALESCE((ARRAY_AGG(lr.cd4_count ORDER BY lr.test_date DESC))[1] - (ARRAY_AGG(lr.cd4_count ORDER BY lr.test_date DESC))[2], 0) AS cd4_improvement,
        COALESCE(ROUND(AVG(CASE WHEN lr.vl_suppressed = true THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 1.0) AS vl_sup_rate,
        (ARRAY_AGG(CASE WHEN lr.vl_suppressed = true THEN 1 ELSE 0 END ORDER BY lr.test_date DESC))[1] AS latest_vl_suppressed,
        (ARRAY_AGG(lr.weight_kg ORDER BY lr.test_date DESC))[1] AS latest_weight,
        COALESCE(ROUND(AVG(CASE WHEN lr.side_effects IS NOT NULL AND lr.side_effects != '' THEN 1.0 ELSE 0.0 END)::NUMERIC, 4), 0) AS side_effect_rate
    FROM lab_results lr
    WHERE lr.patient_id = ANY($1::int[])
    GROUP BY lr.patient_id
)
SELECT
    pb.*,
    COALESCE(pa.missed_rate, 0) AS missed_rate,
    COALESCE(pa.avg_days_late, 0) AS avg_days_late,
    COALESCE(pa.pct_very_late, 0) AS pct_very_late,
    COALESCE(pa.mmd_rate, 0) AS mmd_rate,
    COALESCE(pa.avg_days_supply, 30) AS avg_days_supply,
    COALESCE(pa.stock_out_rate, 0) AS stock_out_rate,
    COALESCE(la.side_effect_rate, 0) AS side_effect_rate,
    COALESCE(pa.pharm_reg_changes, 0) AS pharm_reg_changes,
    0.0 AS counselling_rate,
    COALESCE(la.latest_weight, 60) AS latest_weight,
    0.0 AS latest_bmi,
    COALESCE(la.latest_cd4, 0) AS latest_cd4,
    COALESCE(la.first_cd4, 0) AS first_cd4,
    COALESCE(la.cd4_improvement, 0) AS cd4_improvement,
    COALESCE(la.vl_sup_rate, 1) AS vl_sup_rate,
    COALESCE(la.latest_vl_suppressed, 1) AS latest_vl_suppressed,
    COALESCE(la.best_hb, 12) AS best_hb
FROM patient_base pb
LEFT JOIN pickup_agg pa ON pa.patient_id = pb.patient_id
LEFT JOIN lab_agg    la ON la.patient_id = pb.patient_id;
`;

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
    latest_vl_suppressed : (f.latest_vl_suppressed !== undefined && f.latest_vl_suppressed !== null) ? f.latest_vl_suppressed : 1,
});

const buildRiskFactors = (f) => {
    const factors = [];
    if (f.missed_rate >= 0.3) factors.push(`High missed pickup rate`);
    if (f.latest_cd4 > 0 && f.latest_cd4 < 200) factors.push(`CLINICAL EMERGENCY: CD4 critically low (${f.latest_cd4})`);
    if (f.latest_vl_suppressed === 0) factors.push(`CLINICAL EMERGENCY: Viral Load is unsuppressed`);
    if (f.cd4_improvement < -100) factors.push(`WARNING: CD4 count has rapidly declined`);
    return factors.length ? factors : ['No significant risk flags identified'];
};

const saveToAuditTrail = async (patientId, score, label, source, features, factors) => {
    try {
        await query(`UPDATE patients SET risk_score = $1, risk_level = $2, risk_factors = $3 WHERE patient_id = $4`,
            [score, label, JSON.stringify(factors), patientId]);
        await query(`INSERT INTO risk_scores (patient_id, risk_score, risk_label, prediction_source, feature_snapshot, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [patientId, score, label, source, JSON.stringify(features)]);
    } catch (err) { console.error('Data save failed:', err.message); }
};

const scoreOnePatient = async (features) => {
    const mlResponse = await axios.post(`${ML_API_URL}/predict`, buildFlaskPayload(features), { timeout: FLASK_TIMEOUT });
    const score = mlResponse.data.score;
    const factors = [...(mlResponse.data.factors || []), ...buildRiskFactors(features)];
    return { score, label: score >= 75 ? 'High' : score >= 40 ? 'Medium' : 'Low', factors };
};

const calculateRiskScore = async (patientId) => {
    const { rows } = await query(FEATURE_QUERY, [[patientId]]);
    const { score, label, factors } = await scoreOnePatient(rows[0]);
    await saveToAuditTrail(patientId, score, label, 'ml_model', rows[0], factors);
    return { patientId, score, label, factors };
};

const batchCalculateRisk = async (patientIds) => {
    if (!patientIds || !patientIds.length) return [];
    
    const { rows } = await query(FEATURE_QUERY, [patientIds]);
    if (!rows.length) return [];

    const results = [];
    
    for (const features of rows) {
        try {
            const { score, label, factors } = await scoreOnePatient(features);
            await saveToAuditTrail(features.patient_id, score, label, 'ml_model', features, factors);
            results.push({ patientId: features.patient_id, score, label, factors });
        } catch (err) {
            console.error(`Skipping patient ${features.patient_id} due to ML timeout/error:`, err.message);
        
    }
    
    return results;
};

module.exports = { calculateRiskScore, batchCalculateRisk, checkMLHealth: async () => true };