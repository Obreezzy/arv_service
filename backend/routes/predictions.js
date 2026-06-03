const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { batchCalculateRisk, calculateRiskScore } = require('../services/riskEngine');

router.use(verifyToken);

const authorizePrediction = (req, res, next) => {
    
    const userRole = (req.user?.role || req.user?.user_role || req.user?.userRole || '').toLowerCase().trim();
    

    if (userRole === 'data_entry') {
        return res.status(403).json({ 
            success: false, 
            message: 'Forbidden: Data entry operators are restricted from running mass predictive analysis.' 
        });
    }
    
    next();
};

router.post('/batch', authorizePrediction, async (req, res) => {
    const { patientIds, weatherAlerts } = req.body;
    const activeWeather = weatherAlerts || [];

    try {
        if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
            const activePatients = await query('SELECT patient_id FROM patients WHERE is_active = true');
            const ids = activePatients.rows.map(r => r.patient_id);
            
            if (ids.length === 0) {
                return res.json({ success: true, predictions: [] });
            }
            const results = await batchCalculateRisk(ids, activeWeather);
            return res.json({ success: true, predictions: results });
        }

        const results = await batchCalculateRisk(patientIds, activeWeather);
        res.json({ success: true, predictions: results });
    } catch (err) {
        console.error('Batch processing error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/:patientId', authorizePrediction, async (req, res) => {
    const patientId = parseInt(req.params.patientId, 10);
    const weatherAlerts = req.body.weatherAlerts || [];

    try {
        if (isNaN(patientId)) {
            return res.status(400).json({ success: false, message: 'Invalid patient identification parameter' });
        }
        const result = await calculateRiskScore(patientId, weatherAlerts);
        res.json({ success: true, prediction: result });
    } catch (err) {
        console.error('Single calculation error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/:patientId/history', async (req, res) => {
    const patientId = parseInt(req.params.patientId, 10);
    try {
        if (isNaN(patientId)) {
            return res.status(400).json({ success: false, message: 'Invalid patient identification parameter' });
        }
        const result = await query(
            `SELECT risk_score AS score, risk_label AS label, prediction_source, feature_snapshot, created_at
             FROM risk_scores 
             WHERE patient_id = $1 
             ORDER BY created_at DESC LIMIT 20`,
            [patientId]
        );
        res.json({ success: true, history: result.rows });
    } catch (err) {
        console.error('History fetch error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;