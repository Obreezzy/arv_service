const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { calculateRiskScore } = require('../services/riskEngine');

router.use(verifyToken);

// PREDICT RISK FOR ALL PATIENTS
router.post('/predict', async (req, res) => {
    const weatherAlerts = req.body.weatherAlerts || req.body.activeWeatherAlerts || [];
    try {
        const patientsResult = await query(`SELECT patient_id FROM patients WHERE is_active = true`);
        const patientIds = patientsResult.rows.map(r => r.patient_id);

        if (patientIds.length === 0)
            return res.json({ success: true, message: 'No active patients to score.', data: [] });

        const { batchCalculateRisk } = require('../services/riskEngine');
        const results = await batchCalculateRisk(patientIds, weatherAlerts);

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

// GET ALL PATIENTS
router.get('/', async (req, res) => {
    try {
        const result = await query(`
            SELECT *,
                TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS display_name,
                COALESCE(
                    patient_number, 
                    CASE WHEN art_number LIKE 'P-%' THEN art_number ELSE 'P-' || LPAD(patient_id::text, 4, '0') END
                ) AS display_id
            FROM patients
            ORDER BY risk_score DESC NULLS LAST, last_name ASC
        `);
        const data = result.rows.map(p => ({ ...p, risk_factors: parseFactors(p.risk_factors) }));
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET CLINICS
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

// CREATE PATIENT
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
    const createdById = userId ? parseInt(userId) : null;

    try {
        const freq = parseInt(pickup_frequency) || 30;

        let finalPickupDate = next_pickup_date || null;
        if (!finalPickupDate && enrollment_date) {
            const calc = new Date(enrollment_date);
            calc.setDate(calc.getDate() + freq);
            finalPickupDate = calc.toISOString().split('T')[0];
        }

        const nokName  = nok_name  || emergency_contact_name  || null;
        const nokPhone = nok_phone || emergency_contact_phone || null;
        const isSupporter = treatment_supporter === true || treatment_supporter === 'true';

        const fullName = `${first_name || ''} ${last_name || ''}`.trim(); 
        const genderM = gender === 'M';
        const functionalEnc = 0; 
        
        let maritalEnc = 0; 
        if (marital_status === 'Married') maritalEnc = 1;
        else if (marital_status === 'Divorced') maritalEnc = 2;
        else if (marital_status === 'Widowed') maritalEnc = 3;

        // --- DYNAMIC ART NUMBER COLLISION RESOLUTION ---
        let finalArtNumber = art_number ? art_number.trim() : null;
        if (!finalArtNumber) {
            const currentYear = new Date().getFullYear().toString().slice(-2);
            const facilityCode = clinic_number || 'UNKNOWN';
            const randomSeq = Math.floor(1000 + Math.random() * 9000);
            finalArtNumber = `CHP/${facilityCode}/${currentYear}/${randomSeq}`;
        }

        let isOccupied = true;
        let protectionAttempts = 0;
        while (isOccupied && protectionAttempts < 15) {
            const checkRes = await query(`SELECT 1 FROM patients WHERE art_number = $1`, [finalArtNumber]);
            if (checkRes.rows.length === 0) {
                isOccupied = false;
            } else {
                protectionAttempts++;
                const parts = finalArtNumber.split('/');
                if (parts.length === 4) {
                    const newSeq = Math.floor(1000 + Math.random() * 9000);
                    finalArtNumber = `${parts[0]}/${parts[1]}/${parts[2]}/${newSeq}`;
                } else {
                    finalArtNumber = `${finalArtNumber}-${Math.floor(10 + Math.random() * 90)}`;
                }
            }
        }

        const result = await query(
            `INSERT INTO patients (
                art_number, first_name, last_name, full_name, date_of_birth, gender,
                phone_number, alternative_phone,
                province, district, ward, village, headman,
                enrollment_date, arv_regimen,
                pickup_frequency, next_pickup_date,
                emergency_contact_name, emergency_contact_phone,
                created_by, clinic_name, clinic_number, nurse_number,
                marital_status, treatment_supporter,
                who_clinical_stage, art_start_date,
                chronic_score, tb_flag, pregnancy_flag,
                gender_m, marital_enc, functional_enc, has_supporter
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,
                $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
                $31,$32,$33,$34
            ) RETURNING *`,
            [
                finalArtNumber,
                first_name, 
                last_name, 
                fullName, 
                date_of_birth, 
                gender,
                phone_number, 
                alternative_phone || null,
                province || null, 
                district || null, 
                ward || null,
                village  || null, 
                headman   || null,
                enrollment_date, 
                arv_regimen || null,
                freq, 
                finalPickupDate,
                nokName, 
                nokPhone,
                createdById, 
                clinic_name   || null,
                clinic_number || null,
                nurse_number  || null,
                marital_status   || null,
                isSupporter,
                parseInt(who_clinical_stage) || 2,
                art_start_date || null,
                parseInt(chronic_score) || 0,
                tb_flag        === true || tb_flag        === 'true' ? true : false,
                pregnancy_flag === true || pregnancy_flag === 'true' ? true : false,
                genderM,       
                maritalEnc,    
                functionalEnc, 
                isSupporter    
            ]
        );

        const newPatient = result.rows[0];

        const generatedPatientNumber = `P-${String(newPatient.patient_id).padStart(4, '0')}`;
        await query(
            `UPDATE patients SET patient_number = $1 WHERE patient_id = $2`,
            [generatedPatientNumber, newPatient.patient_id]
        );
        newPatient.patient_number = generatedPatientNumber;
        newPatient.display_id = generatedPatientNumber;

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

// UPDATE PATIENT
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
    const isSupporter = treatment_supporter === true || treatment_supporter === 'true';
    
    const fullName = `${first_name || ''} ${last_name || ''}`.trim();
    const genderM = gender === 'M';
    const functionalEnc = 0; 
    
    let maritalEnc = 0;
    if (marital_status === 'Married') maritalEnc = 1;
    else if (marital_status === 'Divorced') maritalEnc = 2;
    else if (marital_status === 'Widowed') maritalEnc = 3;

    try {
        const result = await query(
            `UPDATE patients SET
                first_name=$1, last_name=$2, full_name=$3, date_of_birth=$4, gender=$5,
                phone_number=$6, alternative_phone=$7,
                province=$8, district=$9, ward=$10, village=$11, headman=$12,
                arv_regimen=$13,
                emergency_contact_name=$14, emergency_contact_phone=$15,
                next_pickup_date=$16, pickup_frequency=$17,
                clinic_name=$18, clinic_number=$19, nurse_number=$20,
                marital_status=$21, treatment_supporter=$22,
                who_clinical_stage=$23, art_start_date=$24,
                chronic_score=$25, tb_flag=$26, pregnancy_flag=$27,
                gender_m=$28, marital_enc=$29, functional_enc=$30, has_supporter=$31
             WHERE patient_id=$32 RETURNING *`,
            [
                first_name, last_name, fullName, date_of_birth, gender,
                phone_number, alternative_phone || null,
                province || null, district || null, ward || null,
                village  || null, headman   || null,
                arv_regimen || null, nokName, nokPhone,
                next_pickup_date || null, parseInt(pickup_frequency) || 30,
                clinic_name   || null, clinic_number || null, nurse_number  || null,
                marital_status || null, isSupporter,
                parseInt(who_clinical_stage) || 2, art_start_date || null,
                parseInt(chronic_score) || 0,
                tb_flag === true || tb_flag === 'true' ? true : false,
                pregnancy_flag === true || pregnancy_flag === 'true' ? true : false,
                genderM, maritalEnc, functionalEnc, isSupporter,   
                req.params.id, 
            ]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Patient not found' });

        const updatedPatient = result.rows[0];

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

// DELETE PATIENT (Hard delete including all history)
router.delete('/:id', async (req, res) => {
    const patientId = req.params.id;
    try {
        // 1. Safely delete child records first to prevent Foreign Key constraint crashes
        await query('DELETE FROM risk_scores WHERE patient_id = $1', [patientId]);
        await query('DELETE FROM medication_pickups WHERE patient_id = $1', [patientId]);
        await query('DELETE FROM lab_results WHERE patient_id = $1', [patientId]);
        await query('DELETE FROM patient_treatments WHERE patient_id = $1', [patientId]);
        await query('DELETE FROM defaulters WHERE patient_id = $1', [patientId]);

        // 2. Delete the master patient record
        const result = await query('DELETE FROM patients WHERE patient_id = $1 RETURNING *', [patientId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        res.json({ success: true, message: 'Patient entirely deleted from the system' });
    } catch (err) {
        console.error('Delete patient error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

const parseFactors = (factors) => {
    try {
        if (!factors) return [];
        return typeof factors === 'string' ? JSON.parse(factors) : factors;
    } catch (e) { return []; }
};

module.exports = router;