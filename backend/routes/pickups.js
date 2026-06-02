const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

const calculateNextPickupDate = (pickupDate, frequencyDays) => {
  const date = new Date(pickupDate);
  date.setDate(date.getDate() + parseInt(frequencyDays));
  return date.toISOString().split('T')[0];
};

// HELPER: Recalculate and save risk using the modern 28-feature ML Risk Engine
const recalculatePatientRisk = async (patient_id) => {
  try {
    const { calculateRiskScore } = require('../services/riskEngine');
    const prediction = await calculateRiskScore(patient_id, []);
    
    await db.query(
      `UPDATE patients
       SET risk_score = $1, risk_level = $2, risk_factors = $3
       WHERE patient_id = $4`,
      [prediction.score, prediction.label, JSON.stringify(prediction.factors), patient_id]
    );
  } catch (err) {
    console.error('Risk recalculation failed via modern engine (non-fatal):', err.message);
  }
};

// POST /api/pickups/record
router.post('/record', async (req, res) => {
  try {
    const {
      patient_id, pickup_date, next_pickup_date,
      quantity_dispensed, clinic_number, nurse_number,
      dispensing_clinic, notes
    } = req.body;

    if (!patient_id) throw new Error('patient_id is required');
    if (!pickup_date) throw new Error('pickup_date is required');

    // Get patient metadata
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
    const computed_next_pickup = next_pickup_date || calculateNextPickupDate(pickup_date, frequency);
    
    const days_supply = Math.ceil(
      (new Date(computed_next_pickup) - new Date(pickup_date)) / (1000 * 60 * 60 * 24)
    );

    // Calculate if the patient was late for this specific collection visit
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
      if (diff > 0) {
        days_late = Math.floor(diff / (1000 * 60 * 60 * 24));
      }
    }

    // 1. Insert collection record
    const result = await db.query(
      `INSERT INTO medication_pickups (
          patient_id, pickup_date, next_expected_date, days_supply, days_late
       ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [patient_id, pickup_date, computed_next_pickup, days_supply, days_late]
    );

    const pickup_record = result.rows[0];

    // 2. Synchronize next schedule date to base patient record
    await db.query(
      'UPDATE patients SET next_pickup_date = $1 WHERE patient_id = $2',
      [computed_next_pickup, patient_id]
    );

    // 3. FULL RE-ACTIVATION LOGIC:
    // This resolves the defaulter status AND sets the patient back to active (is_active = true)
    try {
      // Resolve any pending defaulter status
      await db.query(
        `UPDATE defaulters SET status = 'resolved'
         WHERE patient_id = $1 AND status = 'pending'`,
        [patient_id]
      );
      
      // Force patient back to active
      await db.query(
        `UPDATE patients SET is_active = true 
         WHERE patient_id = $1`,
        [patient_id]
      );
    } catch (dbErr) {
      console.warn('System failed to reactivate patient:', dbErr.message);
    }

    // 4. Trigger modern predictive processing to refresh metrics
    await recalculatePatientRisk(patient_id);

    res.json({
      success: true,
      message: 'Medication pickup recorded successfully. Patient reactivated.',
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

// GET routes
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
       ORDER BY mp.pickup_date DESC, mp.pickup_id DESC LIMIT $1`, 
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
      `SELECT DISTINCT ON (p.patient_id) p.patient_id, p.patient_number, p.first_name, p.last_name, p.phone_number, mp.next_expected_date, mp.next_expected_date - CURRENT_DATE AS days_until 
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