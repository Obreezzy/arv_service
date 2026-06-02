const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { recalculatePatientRisk } = require('../services/riskEngine'); 

router.post('/record', async (req, res) => {
    const { patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date } = req.body;
    
    try {
        await db.query(
            `INSERT INTO lab_results (patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [patient_id, cd4_count, vl_value, vl_suppressed, weight_kg, side_effects, test_date]
        );

        try {
            await recalculatePatientRisk(patient_id); 
        } catch (mlError) {
            console.error('System Alert: ML Risk Engine calculation deferred. Error details:', mlError.message);
        }
        
        return res.json({ 
            success: true, 
            message: 'Lab results saved successfully.' 
        });

    } catch (err) {
        console.error('Database Operation Failure:', err.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server database error during persistence.' 
        });
    }
});

module.exports = router;