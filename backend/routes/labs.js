const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { recalculatePatientRisk } = require('../services/riskEngine'); // Reuse your existing engine logic

router.post('/record', async (req, res) => {
    const { patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date } = req.body;
    
    try {
        await db.query(
            `INSERT INTO lab_results (patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date]
        );

        // Immediately update the ML risk score for this patient
        await recalculatePatientRisk(patient_id); 
        
        res.json({ success: true, message: 'Lab results saved and risk recalculated.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;