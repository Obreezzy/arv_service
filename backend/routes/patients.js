const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { calculateRiskScore } = require('../services/riskEngine');

router.use(verifyToken);

//PREDICT RISK FOR ALL PATIENTS — delegates to riskEngine which queries DB itself
router.post('/predict', async (req, res) => {
    const weatherAlerts = req.body.weatherAlerts || req.body.activeWeatherAlerts || [];
    try {
        const patientsResult = await query(`SELECT patient_id FROM patients WHERE is_active = true`);
        const patientIds = patientsResult.rows.map(r => r.patient_id);

        if (patientIds.length === 0)
            return res.json({ success: true, message: 'No active patients to score.', data: [] });

        const { batchCalculateRisk } = require('../services/riskEngine');
        const results = await batchCalculateRisk(patientIds, weatherAlerts);

        // Write scores back to patients table
        for (const r of results) {
            await query(
                `UPDATE patients SET risk_score=$1, risk_level=$2, risk_factors=$3 WHERE patient_id=$4`,
                [r.score, r.label, JSON.stringify(r.factors), r.patientId]
            );
        }

        res.json({ success: true, message: `Scored ${results.length} patients`, data: results });
    } catch (err) {
        console.error('Batch predict error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

//GET ALL PATIENTS
router.get('/', async (req, res) => {
    try {
        const result = await query(`
            SELECT *,
                TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS display_name
            FROM patients
            ORDER BY risk_score DESC NULLS LAST, last_name ASC
        `);
        const data = result.rows.map(p => ({ ...p, risk_factors: parseFactors(p.risk_factors) }));
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/clinics — returns distinct clinics from registered users
router.get('/clinics', async (req, res) => {
  try {
    const result = await query(`
      SELECT DISTINCT clinic_name, clinic_number
      FROM users
      WHERE clinic_name IS NOT NULL 
        AND clinic_number IS NOT NULL
        AND is_active = true
      ORDER BY clinic_name ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

//CREATE PATIENT
router.post('/', async (req, res) => {
    const {
        art_number, first_name, last_name, date_of_birth, gender,
        phone_number, alternative_phone, district, ward, village, headman,
        province, enrollment_date, arv_regimen,
        pickup_frequency, next_pickup_date,
        emergency_contact_name, emergency_contact_phone,
        nok_name, nok_relationship, nok_phone,
        clinic_name, clinic_number, nurse_number,
        marital_status, treatment_supporter, who_clinical_stage, art_start_date,
        chronic_score, tb_flag, pregnancy_flag,
    } = req.body;

    const userId = req.user?.id || req.user?.user_id || req.user?.userId || req.user?.sub || null;
    let createdByName = 'Unknown';

    if (userId) {
        try {
            const userResult = await query(`SELECT username, first_name, last_name FROM users WHERE user_id = $1`, [userId]);
            if (userResult.rows.length > 0) {
                const u = userResult.rows[0];
                createdByName = (u.first_name && u.last_name) ? `${u.first_name} ${u.last_name}` : u.username;
            }
        } catch (e) {
            console.error('User lookup failed:', e.message);
        }
    }

    try {
        const freq = parseInt(pickup_frequency) || 30;

        // next_pickup_date comes pre-calculated from PatientForm
        // but recalculate as fallback if not provided
        let finalPickupDate = next_pickup_date || null;
        if (!finalPickupDate && enrollment_date) {
            const calc = new Date(enrollment_date);
            calc.setDate(calc.getDate() + freq);
            finalPickupDate = calc.toISOString().split('T')[0];
        }

        // NOK fields — form sends nok_name/nok_phone, map to emergency_contact columns
        const nokName  = nok_name  || emergency_contact_name  || null;
        const nokPhone = nok_phone || emergency_contact_phone || null;

        const result = await query(
            `INSERT INTO patients (
                art_number, first_name, last_name, date_of_birth, gender,
                phone_number, alternative_phone,
                province, district, ward, village, headman,
                enrollment_date, arv_regimen,
                pickup_frequency, next_pickup_date,
                emergency_contact_name, emergency_contact_phone,
                created_by, clinic_name, clinic_number, nurse_number,
                marital_status, treatment_supporter,
                who_clinical_stage, art_start_date,
                chronic_score, tb_flag, pregnancy_flag
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,
                $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
            ) RETURNING *`,
            [
                art_number   || `CHP/UNKNOWN/${new Date().getFullYear().toString().slice(-2)}/${Date.now()}`,
                first_name, last_name, date_of_birth, gender,
                phone_number, alternative_phone || null,
                province || null, district || null, ward || null,
                village  || null, headman   || null,
                enrollment_date, arv_regimen || null,
                freq, finalPickupDate,
                nokName, nokPhone,
                createdByName,
                clinic_name   || null,
                clinic_number || null,
                nurse_number  || null,
                marital_status   || null,
                treatment_supporter === true || treatment_supporter === 'true' ? true : false,
                parseInt(who_clinical_stage) || 2,
                art_start_date || null,
                parseInt(chronic_score) || 0,
                tb_flag        === true || tb_flag        === 'true' ? true : false,
                pregnancy_flag === true || pregnancy_flag === 'true' ? true : false,
            ]
        );

        const newPatient = result.rows[0];

        // Run initial risk prediction using the new riskEngine
        try {
            const { calculateRiskScore: scoreById } = require('../services/riskEngine');
            const initialPrediction = await scoreById(newPatient.patient_id, []);

            await query(`
                UPDATE patients
                SET risk_score   = $1,
                    risk_level   = $2,
                    risk_factors = $3
                WHERE patient_id = $4
            `, [
                initialPrediction.score,
                initialPrediction.label,
                JSON.stringify(initialPrediction.factors),
                newPatient.patient_id
            ]);

            newPatient.risk_score   = initialPrediction.score;
            newPatient.risk_level   = initialPrediction.label;
            newPatient.risk_factors = initialPrediction.factors;

        } catch (mlErr) {
            console.warn('Initial ML prediction skipped:', mlErr.message);
        }

        // Create treatment record
        if (arv_regimen) {
            try {
                await query(
                    `INSERT INTO patient_treatments (patient_id, arv_regimen, start_date, is_current)
                     VALUES ($1, $2, CURRENT_DATE, true)`,
                    [newPatient.patient_id, arv_regimen]
                );
            } catch (treatmentErr) {
                try {
                    await query(
                        `INSERT INTO patient_treatments (patient_id, start_date, is_current)
                         VALUES ($1, CURRENT_DATE, true)`,
                        [newPatient.patient_id]
                    );
                } catch(e) {
                    console.error('Could not auto-create treatment record:', e.message);
                }
            }
        }

        res.json({ success: true, patient: newPatient });
    } catch (err) {
        console.error('Create patient error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET SINGLE PATIENT
router.get('/:id', async (req, res) => {
    try {
        const result = await query('SELECT * FROM patients WHERE patient_id = $1', [req.params.id]);
        if (result.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Patient not found' });
        res.json({ success: true, patient: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


//UPDATE PATIENT
router.put('/:id', async (req, res) => {
    const {
        first_name, last_name, date_of_birth, gender, phone_number,
        alternative_phone, district, ward, village, headman, province,
        arv_regimen, emergency_contact_name, emergency_contact_phone,
        nok_name, nok_phone,
        next_pickup_date, pickup_frequency, clinic_name, clinic_number, nurse_number,
        marital_status, treatment_supporter, who_clinical_stage, art_start_date,
        chronic_score, tb_flag, pregnancy_flag,
    } = req.body;

    const nokName  = nok_name  || emergency_contact_name  || null;
    const nokPhone = nok_phone || emergency_contact_phone || null;

    try {
        const result = await query(
            `UPDATE patients SET
                first_name=$1, last_name=$2, date_of_birth=$3, gender=$4,
                phone_number=$5, alternative_phone=$6,
                province=$7, district=$8, ward=$9, village=$10, headman=$11,
                arv_regimen=$12,
                emergency_contact_name=$13, emergency_contact_phone=$14,
                next_pickup_date=$15, pickup_frequency=$16,
                clinic_name=$17, clinic_number=$18, nurse_number=$19,
                marital_status=$20, treatment_supporter=$21,
                who_clinical_stage=$22, art_start_date=$23,
                chronic_score=$24, tb_flag=$25, pregnancy_flag=$26
             WHERE patient_id=$27 RETURNING *`,
            [
                first_name, last_name, date_of_birth, gender,
                phone_number, alternative_phone || null,
                province || null, district || null, ward || null,
                village  || null, headman   || null,
                arv_regimen || null,
                nokName, nokPhone,
                next_pickup_date || null,
                parseInt(pickup_frequency) || 30,
                clinic_name   || null,
                clinic_number || null,
                nurse_number  || null,
                marital_status || null,
                treatment_supporter === true || treatment_supporter === 'true' ? true : false,
                parseInt(who_clinical_stage) || 2,
                art_start_date || null,
                parseInt(chronic_score) || 0,
                tb_flag        === true || tb_flag        === 'true' ? true : false,
                pregnancy_flag === true || pregnancy_flag === 'true' ? true : false,
                req.params.id,
            ]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Patient not found' });

        const updatedPatient = result.rows[0];

        // Re-run ML prediction after update using riskEngine
        try {
            const { calculateRiskScore: scoreById } = require('../services/riskEngine');
            const prediction = await scoreById(parseInt(req.params.id), []);

            await query(`
                UPDATE patients
                SET risk_score   = $1,
                    risk_level   = $2,
                    risk_factors = $3
                WHERE patient_id = $4
            `, [prediction.score, prediction.label, JSON.stringify(prediction.factors), req.params.id]);

            updatedPatient.risk_score   = prediction.score;
            updatedPatient.risk_level   = prediction.label;
            updatedPatient.risk_factors = prediction.factors;

        } catch (mlErr) {
            console.warn('ML re-prediction skipped after update:', mlErr.message);
        }

        res.json({ success: true, patient: updatedPatient });
    } catch (err) {
        console.error('Update patient error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// HELPER
const parseFactors = (factors) => {
    try {
        if (!factors) return [];
        return typeof factors === 'string' ? JSON.parse(factors) : factors;
    } catch (e) { return []; }
};

module.exports = router;