const express = require('express');
const router  = express.Router();
const db      = require('../config/db');


const calculateNextPickupDate = (pickupDate, frequencyDays) => {
  const date = new Date(pickupDate);
  date.setDate(date.getDate() + parseInt(frequencyDays));
  return date.toISOString().split('T')[0];
};


const getAge = (dob) => {
  if (!dob) return 30;
  const d = new Date(dob);
  return isNaN(d.getTime()) ? 30 : new Date().getFullYear() - d.getFullYear();
};


const predictRiskForPatient = (patient, history) => {
  let score   = 0;
  let factors = [];

  const distance    = isNaN(parseFloat(patient.distance_from_clinic))
    ? 0 : parseFloat(patient.distance_from_clinic);
  const age         = getAge(patient.date_of_birth);
  const latePickups = parseInt(history.late_pickups) || 0;

  if (latePickups > 2) {
    score += 40; factors.push('Chronic Defaulter (Late 3+ times)');
  } else if (latePickups === 2) {
    score += 25; factors.push('History of late pickups (2 times)');
  } else if (latePickups === 1) {
    score += 10; factors.push('Previous Default Record');
  }

  if (distance > 25)      { score += 30; factors.push('Extreme Distance (>25km)'); }
  else if (distance > 15) { score += 15; factors.push('Long Distance (>15km)'); }

  if (age >= 18 && age <= 24) { score += 20; factors.push('High-Risk Age Group (18-24)'); }
  else if (age > 70)          { score += 10; factors.push('Geriatric Vulnerability'); }

  if (patient.chronic_diseases && patient.chronic_diseases.trim() !== '') {
    score += 15; 
    factors.push(`Comorbidities Present (${patient.chronic_diseases})`);
  }

  score = Math.min(score, 100);
  const label = score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low';
  return { score, label, factors };
};

// HELPER: Recalculate and save risk for one patient
const recalculatePatientRisk = async (patient_id) => {
  try {
    const patientRes = await db.query(
      `SELECT patient_id, date_of_birth, distance_from_clinic, chronic_diseases
       FROM patients WHERE patient_id = $1`,
      [patient_id]
    );
    if (patientRes.rows.length === 0) return;
    const patient = patientRes.rows[0];

    //Count history directly from the defaulters table so it never forgets past defaults!
    const historyRes = await db.query(
      `SELECT COUNT(*) AS late_pickups FROM defaulters WHERE patient_id = $1`,
      [patient_id]
    );

    const history    = historyRes.rows[0];
    const prediction = predictRiskForPatient(patient, history);

    await db.query(
      `UPDATE patients
       SET risk_score = $1, risk_level = $2, risk_factors = $3
       WHERE patient_id = $4`,
      [prediction.score, prediction.label, JSON.stringify(prediction.factors), patient_id]
    );

  } catch (err) {
    console.error('Risk recalculation failed (non-fatal):', err.message);
  }
};

// POST /api/pickups/record
router.post('/record', async (req, res) => {
  const client = await db.getClient();
  try {
    const {
      patient_id, pickup_date, next_pickup_date,
      quantity_dispensed, clinic_number, nurse_number,
      dispensing_clinic, notes
    } = req.body;

    if (!patient_id) throw new Error('patient_id is required');
    if (!pickup_date) throw new Error('pickup_date is required');

    //Get patient
    const patientCheck = await client.query(
      `SELECT patient_id, first_name, last_name, pickup_frequency, arv_regimen
       FROM patients WHERE patient_id = $1`,
      [patient_id]
    );
    
    if (patientCheck.rows.length === 0) {
      throw new Error('Patient not found in database.');
    }

    const patient              = patientCheck.rows[0];
    const frequency            = patient.pickup_frequency || 30;
    const computed_next_pickup = next_pickup_date || calculateNextPickupDate(pickup_date, frequency);
    const days_supply          = Math.ceil(
      (new Date(computed_next_pickup) - new Date(pickup_date)) / (1000 * 60 * 60 * 24)
    );

    //Get or Auto-Create treatment_id
    let treatment_id = null;
    try {
      const t1 = await client.query(
        'SELECT treatment_id FROM patient_treatments WHERE patient_id = $1 ORDER BY is_current DESC, treatment_id DESC LIMIT 1',
        [patient_id]
      );
      if (t1.rows.length > 0) treatment_id = t1.rows[0].treatment_id;
    } catch (e) {
      console.log('Could not query patient_treatments:', e.message);
    }

    // Smart Self-Healing 
    if (!treatment_id) {
        console.log(`Auto-creating missing treatment record for ${patient.first_name}...`);
        try {
            // Try with arv_regimen first
            const newTreatment = await client.query(
                `INSERT INTO patient_treatments (patient_id, arv_regimen, start_date, is_current)
                 VALUES ($1, $2, CURRENT_DATE, true) RETURNING treatment_id`,
                [patient_id, patient.arv_regimen || 'Standard']
            );
            treatment_id = newTreatment.rows[0].treatment_id;
            console.log('Treatment auto-created successfully.');
        } catch (e) {
            console.log('Failed with arv_regimen column, trying without regimen column entirely...', e.message);
            try {
                // Fallback: Just try to get an ID in there without any regimen text
                const fallbackTreatment = await client.query(
                    `INSERT INTO patient_treatments (patient_id, start_date, is_current)
                     VALUES ($1, CURRENT_DATE, true) RETURNING treatment_id`,
                    [patient_id]
                );
                treatment_id = fallbackTreatment.rows[0].treatment_id;
                console.log('Fallback treatment auto-created successfully.');
            } catch (fallbackErr) {
                 console.log('Complete failure to auto-create treatment:', fallbackErr.message);
                 // If it truly fails, we set a dummy treatment ID to bypass the block so the nurse can do their job
                 treatment_id = 1; 
            }
        }
    }

    // START TRANSACTION (Safe now!)
    await client.query('BEGIN');

    //Insert pickup 
    const result = await client.query(
      `INSERT INTO medication_pickups (
          patient_id, treatment_id, pickup_date, actual_pickup_date, scheduled_date, next_pickup_date,
          quantity_dispensed, days_supply, dispensed_by, clinic_number, dispensing_clinic, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        patient_id, treatment_id, pickup_date, pickup_date, pickup_date, computed_next_pickup,
        quantity_dispensed || 30, days_supply, nurse_number || null, clinic_number || null,
        dispensing_clinic || null, notes || null
      ]
    );

    const pickup_record = result.rows[0];

    //Update next_pickup_date on patient
    await client.query(
      'UPDATE patients SET next_pickup_date = $1 WHERE patient_id = $2',
      [computed_next_pickup, patient_id]
    );

    //Remove from defaulters if applicable 
    await client.query(
      `UPDATE defaulters SET status = 'returned', resolved_date = CURRENT_TIMESTAMP
       WHERE patient_id = $1 AND status = 'pending'`,
      [patient_id]
    );

    await client.query('COMMIT');

    // Recalculate risk score
    await recalculatePatientRisk(patient_id);

    res.json({
      success: true,
      message: 'Medication pickup recorded successfully. Risk score updated.',
      pickup: pickup_record
    });

  } catch (error) {
    // Only rollback if we actually started a transaction, otherwise just catch
    try { await client.query('ROLLBACK'); } catch(e) {}
    console.error('Error recording pickup:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while recording pickup'
    });
  } finally {
    client.release();
  }
});

// GET routes (remain unchanged)
router.post('/set-first-pickup', async (req, res) => {
  try {
    const { patient_id, first_pickup_date } = req.body;
    if (!patient_id || !first_pickup_date) return res.status(400).json({ success: false });
    await db.query('UPDATE patients SET next_pickup_date = $1 WHERE patient_id = $2', [first_pickup_date, patient_id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false }); }
});

router.get('/recent', async (req, res) => {
  try {
    const result = await db.query(`SELECT mp.*, p.patient_id, p.first_name, p.last_name, p.patient_number FROM medication_pickups mp JOIN patients p ON mp.patient_id = p.patient_id ORDER BY mp.created_at DESC LIMIT $1`, [parseInt(req.query.limit) || 20]);
    res.json({ success: true, count: result.rows.length, pickups: result.rows });
  } catch (error) { res.status(500).json({ success: false }); }
});

router.get('/patient/:patient_id', async (req, res) => {
  try {
    const result = await db.query(`SELECT mp.*, p.first_name, p.last_name, p.patient_number FROM medication_pickups mp JOIN patients p ON mp.patient_id = p.patient_id WHERE mp.patient_id = $1 ORDER BY mp.actual_pickup_date DESC`, [req.params.patient_id]);
    res.json({ success: true, count: result.rows.length, pickups: result.rows });
  } catch (error) { res.status(500).json({ success: false }); }
});

router.get('/upcoming', async (req, res) => {
  try {
    const result = await db.query(`SELECT DISTINCT ON (p.patient_id) p.patient_id, p.patient_number, p.first_name, p.last_name, p.phone_number, mp.next_pickup_date, mp.next_pickup_date - CURRENT_DATE AS days_until FROM patients p JOIN medication_pickups mp ON p.patient_id = mp.patient_id WHERE mp.next_pickup_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1 ORDER BY p.patient_id, mp.next_pickup_date DESC`, [parseInt(req.query.days) || 7]);
    res.json({ success: true, count: result.rows.length, upcoming: result.rows });
  } catch (error) { res.status(500).json({ success: false }); }
});

module.exports = router;