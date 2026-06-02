const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.post('/record', async (req, res) => {
    const { patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date } = req.body;
    
    try {
        await db.query(
            `INSERT INTO lab_results (patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date]
        );

        try {
            const { recalculatePatientRisk } = require('../services/riskEngine'); 
            if (recalculatePatientRisk && typeof recalculatePatientRisk === 'function') {
                await recalculatePatientRisk(patient_id); 
            }
        } catch (mlSandboxError) {
            console.error('System Notice: ML engine integration deferred, error logs:', mlSandboxError.message);
        }
        
        return res.json({ 
            success: true, 
            message: 'Lab results saved successfully.' 
        });

    } catch (err) {
        console.error('Fatal Database Engine Error:', err.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to persist records inside database context.' 
        });
    }
});

module.exports = router;