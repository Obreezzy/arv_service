const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { calculateRiskScore } = require('../services/riskEngine');

router.use(verifyToken);

//PREDICT RISK FOR ALL PATIENTS 
router.post('/predict', async (req, res) => {
    const activeWeatherAlerts = req.body.activeWeatherAlerts || [];

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const result = await client.query(`
            SELECT 
                patient_id, date_of_birth, distance_from_clinic, gender,
                district, ward, village, headman, chronic_diseases,
                next_pickup_date, arv_regimen, marital_status,
                treatment_supporter, who_clinical_stage, art_start_date
            FROM patients WHERE is_active = true
        `);

        let updatedCount = 0;

        for (const patient of result.rows) {
            try {
                // Get past defaults count for this patient
                const historyResult = await client.query(`
                    SELECT COUNT(*) AS past_defaults
                    FROM defaulters
                    WHERE patient_id = $1
                `, [patient.patient_id]);

                const pickupResult = await client.query(`
                    SELECT COUNT(*) AS total_pickups
                    FROM medication_pickups
                    WHERE patient_id = $1
                `, [patient.patient_id]);

                const pastDefaults      = parseInt(historyResult.rows[0].past_defaults) || 0;
                const totalAppointments = parseInt(pickupResult.rows[0].total_pickups) || 1;

                // Calculate days overdue
                const daysOverdue = patient.next_pickup_date
                    ? Math.max(0, Math.floor(
                        (new Date() - new Date(patient.next_pickup_date)) / (1000 * 60 * 60 * 24)
                      ))
                    : 0;

                // Build patient object matching riskEngine field names
                const patientForML = {
                    ...patient,
                    chronic_diseases       : patient.chronic_diseases || '',
                    total_appointments     : totalAppointments,
                    treatment_supporter    : patient.treatment_supporter || false,
                    who_clinical_stage     : patient.who_clinical_stage || 2,
                    art_start_date         : patient.art_start_date || null,
                    regimen                : patient.arv_regimen || 'TLD',
                    marital_status         : patient.marital_status || 'Married',
                };

                // Call ML API
                const prediction = await calculateRiskScore(
                    patientForML,
                    daysOverdue,
                    pastDefaults,
                    activeWeatherAlerts
                );

                // Update patient with ML prediction
                await client.query(`
                    UPDATE patients
                    SET risk_score  = $1,
                        risk_level  = $2,
                        risk_factors= $3
                    WHERE patient_id = $4
                `, [
                    prediction.score,
                    prediction.label,
                    JSON.stringify(prediction.factors),
                    patient.patient_id
                ]);

                updatedCount++;

            } catch (patientErr) {
                console.error(`Risk prediction failed for patient ${patient.patient_id}:`, patientErr.message);
            }
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `ML risk analysis completed for ${updatedCount} patients`,
            model: 'LR + RF Ensemble '
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Prediction error:', err);
        res.status(500).json({ success: false, message: 'ML Prediction failed: ' + err.message });
    } finally {
        client.release();
    }
});

//GET ALL PATIENTS
router.get('/', async (req, res) => {
    try {
        const result = await query(`
            SELECT *, (first_name || ' ' || last_name) AS full_name
            FROM patients
            WHERE patient_id NOT IN (
                SELECT patient_id FROM defaulters WHERE status = 'pending'
            )
            ORDER BY risk_score DESC, last_name ASC
        `);
        const data = result.rows.map(p => ({ ...p, risk_factors: parseFactors(p.risk_factors) }));
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

//CREATE PATIENT
router.post('/', async (req, res) => {
    const {
        patient_number, first_name, last_name, date_of_birth, gender,
        phone_number, alternative_phone, email, district, ward, village, headman,
        distance_from_clinic, enrollment_date, arv_regimen,
        pickup_frequency, next_pickup_date, is_new_patient,
        emergency_contact_name, emergency_contact_phone,
        clinic_number, nurse_number, dispensing_clinic, chronic_diseases,
        marital_status, treatment_supporter, who_clinical_stage, art_start_date
    } = req.body;

    const userId = req.user?.id || req.user?.user_id || req.user?.userId || req.user?.sub || req.user?.ID || null;
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
        let finalPickupDate = null;

        if (is_new_patient === true || is_new_patient === 'true') {
            finalPickupDate = next_pickup_date || null;
        } else {
            const enrollDate = enrollment_date ? new Date(enrollment_date) : new Date();
            const calc = new Date(enrollDate);
            calc.setDate(calc.getDate() + freq);
            finalPickupDate = calc.toISOString().split('T')[0];
        }

        const result = await query(
            `INSERT INTO patients (
                patient_number, first_name, last_name, date_of_birth, gender,
                phone_number, alternative_phone, email, district, ward, village, headman,
                distance_from_clinic, enrollment_date, arv_regimen,
                pickup_frequency, next_pickup_date,
                emergency_contact_name, emergency_contact_phone,
                created_by, clinic_number, nurse_number, dispensing_clinic, chronic_diseases,
                marital_status, treatment_supporter, who_clinical_stage, art_start_date
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28
            ) RETURNING *`,
            [
                patient_number || `P-${Date.now()}`, first_name, last_name, date_of_birth, gender,
                phone_number, alternative_phone || null, email || null, district || null, ward || null,
                village || null, headman || null, distance_from_clinic || 0, enrollment_date, arv_regimen || null,
                freq, finalPickupDate, emergency_contact_name || null, emergency_contact_phone || null,
                createdByName,
                clinic_number || null, nurse_number || null, dispensing_clinic || null, chronic_diseases || null,
                marital_status || null, treatment_supporter || false,
                who_clinical_stage || 2, art_start_date || null
            ]
        );

        const newPatient = result.rows[0];

        
        try {
            const initialPrediction = await calculateRiskScore(
                { ...newPatient, chronic_diseases: chronic_diseases || '' },
                0,   
                0,   
                []
            );

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
        alternative_phone, email, district, ward, village, headman, distance_from_clinic,
        arv_regimen, emergency_contact_name, emergency_contact_phone,
        next_pickup_date, pickup_frequency, clinic_number, nurse_number, dispensing_clinic,
        chronic_diseases, marital_status, treatment_supporter, who_clinical_stage, art_start_date
    } = req.body;

    try {
        const result = await query(
            `UPDATE patients SET
                first_name=$1, last_name=$2, date_of_birth=$3, gender=$4,
                phone_number=$5, alternative_phone=$6, email=$7,
                district=$8, ward=$9, village=$10, headman=$11,
                distance_from_clinic=$12, arv_regimen=$13,
                emergency_contact_name=$14, emergency_contact_phone=$15,
                next_pickup_date=$16, pickup_frequency=$17,
                clinic_number=$18, nurse_number=$19, dispensing_clinic=$20,
                chronic_diseases=$21, marital_status=$22,
                treatment_supporter=$23, who_clinical_stage=$24, art_start_date=$25
             WHERE patient_id=$26 RETURNING *`,
            [
                first_name, last_name, date_of_birth, gender, phone_number,
                alternative_phone || null, email || null, district || null,
                ward || null, village || null, headman || null, distance_from_clinic,
                arv_regimen || null, emergency_contact_name || null,
                emergency_contact_phone || null, next_pickup_date || null,
                pickup_frequency || 30, clinic_number || null, nurse_number || null,
                dispensing_clinic || null, chronic_diseases || null,
                marital_status || null, treatment_supporter || false,
                who_clinical_stage || 2, art_start_date || null,
                req.params.id
            ]
        );

        const updatedPatient = result.rows[0];

        // Re-run ML prediction after patient update
        try {
            const historyResult = await query(`
                SELECT COUNT(*) AS past_defaults FROM defaulters WHERE patient_id = $1
            `, [req.params.id]);

            const pastDefaults = parseInt(historyResult.rows[0].past_defaults) || 0;
            const daysOverdue  = next_pickup_date
                ? Math.max(0, Math.floor(
                    (new Date() - new Date(next_pickup_date)) / (1000 * 60 * 60 * 24)
                  ))
                : 0;

            const prediction = await calculateRiskScore(
                { ...updatedPatient, chronic_diseases: chronic_diseases || '' },
                daysOverdue,
                pastDefaults,
                []
            );

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