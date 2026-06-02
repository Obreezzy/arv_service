const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { batchCalculateRisk, calculateRiskScore } = require('../services/riskEngine');

router.use(verifyToken);

// Flexible middleware to safely check authorization roles without false-positives
const authorizePrediction = (req, res, next) => {
    // Looks up properties dynamically across common token property variants
    const userRole = (req.user?.role || req.user?.user_role || req.user?.userRole || '').toLowerCase().trim();
    
    // Explicitly isolate data entry blocks while letting valid health operators handle operations safely
    if (userRole === 'data_entry') {
        return res.status(403).json({ 
            success: false, 
            message: 'Forbidden: Data entry operators are restricted from running mass predictive analysis.' 
        });
    }
    
    // Fallback safe assumption: If they have passed verifyToken and aren't explicitly data_entry, allow processing
    next();
};

// 1. POST /api/predictions/batch - Bulk Dashboard Scoring
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

// 2. POST /api/predictions/:patientId - Single Patient Button
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

// 3. GET /api/predictions/:patientId/history - Logs Trail
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