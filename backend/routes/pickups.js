const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

const calculateNextPickupDate = (pickupDate, frequencyDays) => {
  const date = new Date(pickupDate);
  date.setDate(date.getDate() + parseInt(frequencyDays));
  return date.toISOString().split('T')[0];
};

// HELPER: Recalculate and save risk for one patient using the new ML Risk Engine
const recalculatePatientRisk = async (patient_id) => {
  try {
    const { calculateRiskScore } = require('../services/riskEngine');
    const prediction = await calculateRiskScore(patient_id, []);
    
    await db.query(`
        UPDATE patients
        SET risk_score = $1, risk_level = $2, risk_factors = $3
        WHERE patient_id = $4
    `, [prediction.score, prediction.label, JSON.stringify(prediction.factors), patient_id]);
  } catch (err) {
    console.warn('ML risk recalculation skipped after pickup (non-fatal):', err.message);
  }
};

// POST /api/pickups/record
router.post('/record', async (req, res) => {
  try {
    const {
      patient_id, pickup_date, next_pickup_date
    } = req.body;

    if (!patient_id) throw new Error('patient_id is required');
    if (!pickup_date) throw new Error('pickup_date is required');

    // 1. Get patient and calculate correct dates
    const patientCheck = await db.query(
      `SELECT patient_id, first_name, last_name, pickup_frequency, arv_regimen
       FROM patients WHERE patient_id = $1`,
      [patient_id]
    );
    
    if (patientCheck.rows.length === 0) {
      throw new Error('Patient not found in database.');
    }

    const patient = patientCheck.rows[0];
    const frequency = patient.pickup_frequency || 30;
    
    // Fallback if frontend didn't supply the next date
    const computed_next_pickup = next_pickup_date || calculateNextPickupDate(pickup_date, frequency);
    
    // Calculate how many days of pills they were given
    const days_supply = Math.ceil(
      (new Date(computed_next_pickup) - new Date(pickup_date)) / (1000 * 60 * 60 * 24)
    );

    // 2. Calculate if they were late for THIS pickup
    const prevPickupRes = await db.query(
      `SELECT next_expected_date FROM medication_pickups 
       WHERE patient_id = $1 ORDER BY pickup_date DESC LIMIT 1`,
      [patient_id]
    );

    let days_late = 0;
    if (prevPickupRes.rows.length > 0 && prevPickupRes.rows[0].next_expected_date) {
      const expected = new Date(prevPickupRes.rows[0].next_expected_date);
      const actual = new Date(pickup_date);
      const diff = actual - expected;
      
      // If the difference is positive, they were late
      if (diff > 0) {
        days_late = Math.floor(diff / (1000 * 60 * 60 * 24));
      }
    }

    // 3. Bulletproof INSERT into medication_pickups 
    const result = await db.query(
      `INSERT INTO medication_pickups (
          patient_id, 
          pickup_date, 
          next_expected_date, 
          days_supply, 
          days_late
       ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        patient_id, 
        pickup_date, 
        computed_next_pickup, 
        days_supply, 
        days_late
      ]
    );

    const pickup_record = result.rows[0];

    // 4. Update the next_pickup_date on the main patient record
    await db.query(
      'UPDATE patients SET next_pickup_date = $1 WHERE patient_id = $2',
      [computed_next_pickup, patient_id]
    );

    // 5. If they were marked as a defaulter, mark them as returned
    // Wrapped in a try/catch so schema issues here NEVER block the pickup process
    try {
        await db.query(
          `UPDATE defaulters SET status = 'returned'
           WHERE patient_id = $1 AND status = 'pending'`,
          [patient_id]
        );
    } catch (defaulterErr) {
        console.warn('Could not update defaulters status (non-fatal):', defaulterErr.message);
    }

    // 6. Recalculate AI Risk Score based on this new behavior
    await recalculatePatientRisk(patient_id);

    res.json({
      success: true,
      message: 'Medication pickup recorded successfully. Risk score updated.',
      pickup: pickup_record
    });

  } catch (error) {
    console.error('Error recording pickup:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while recording pickup'
    });
  }
});


// GET routes mapped to correct column names

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
    const result = await db.query(
        `SELECT mp.*, p.patient_id, p.first_name, p.last_name, p.patient_number 
         FROM medication_pickups mp 
         JOIN patients p ON mp.patient_id = p.patient_id 
         ORDER BY mp.pickup_date DESC, mp.pickup_id DESC 
         LIMIT $1`, 
         [parseInt(req.query.limit) || 20]
    );
    res.json({ success: true, count: result.rows.length, pickups: result.rows });
  } catch (error) { res.status(500).json({ success: false }); }
});

router.get('/patient/:patient_id', async (req, res) => {
  try {
    const result = await db.query(
        `SELECT mp.*, p.first_name, p.last_name, p.patient_number 
         FROM medication_pickups mp 
         JOIN patients p ON mp.patient_id = p.patient_id 
         WHERE mp.patient_id = $1 
         ORDER BY mp.pickup_date DESC`, 
         [req.params.patient_id]
    );
    res.json({ success: true, count: result.rows.length, pickups: result.rows });
  } catch (error) { res.status(500).json({ success: false }); }
});

router.get('/upcoming', async (req, res) => {
  try {
    const result = await db.query(
        `SELECT DISTINCT ON (p.patient_id) 
            p.patient_id, p.patient_number, p.first_name, p.last_name, p.phone_number, 
            mp.next_expected_date, mp.next_expected_date - CURRENT_DATE AS days_until 
         FROM patients p 
         JOIN medication_pickups mp ON p.patient_id = mp.patient_id 
         WHERE mp.next_expected_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1 
         ORDER BY p.patient_id, mp.next_expected_date DESC`, 
         [parseInt(req.query.days) || 7]
    );
    res.json({ success: true, count: result.rows.length, upcoming: result.rows });
  } catch (error) { res.status(500).json({ success: false }); }
});

module.exports = router;