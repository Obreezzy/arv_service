// backend/routes/predictions.js
// Endpoints:
//   POST /api/predictions/:patientId        ← "Run AI Risk Predictor" button
//   POST /api/predictions/batch             ← dashboard bulk scoring
//   GET  /api/predictions/:patientId/history ← past predictions for a patient

'use strict';

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');
const { calculateRiskScore, batchCalculateRisk } = require('../services/riskEngine');

const pool = new Pool({
    host     : process.env.DB_HOST,
    port     : process.env.DB_PORT,
    database : process.env.DB_NAME,
    user     : process.env.DB_USER,
    password : process.env.DB_PASSWORD,
    ssl      : { rejectUnauthorized: false },
});

// ── Role guard ────────────────────────────────────────────────────────────────
// Only admin and healthcare_worker can trigger predictions.
// data_entry staff cannot.
function requireClinicalRole(req, res, next) {
    const role = req.user?.role;
    if (!role || !['admin', 'healthcare_worker'].includes(role)) {
        return res.status(403).json({
            success : false,
            message : 'Only admins and healthcare workers can run risk predictions.',
        });
    }
    next();
}


// ── POST /api/predictions/batch ───────────────────────────────────────────────
// Must be declared BEFORE /:patientId so Express doesn't treat "batch" as an ID.
// Called by the dashboard to score multiple patients at once.
//
// Body: { patientIds: [1, 2, 3, ...], weatherAlerts: ['Harare'] }
router.post('/batch', requireClinicalRole, async (req, res) => {
    const { patientIds = [], weatherAlerts = [] } = req.body;

    if (!Array.isArray(patientIds) || patientIds.length === 0) {
        return res.status(400).json({ success: false, message: 'patientIds array is required.' });
    }

    if (patientIds.length > 200) {
        return res.status(400).json({ success: false, message: 'Maximum 200 patients per batch.' });
    }

    try {
        const results = await batchCalculateRisk(patientIds, weatherAlerts);
        return res.json({ success: true, data: results, count: results.length });
    } catch (err) {
        console.error('[predictions/batch]', err.message);
        return res.status(500).json({ success: false, message: 'Batch prediction failed.' });
    }
});


// ── POST /api/predictions/:patientId ─────────────────────────────────────────
// Called when the "Run AI Risk Predictor" button is clicked on a patient page.
//
// Body (optional): { weatherAlerts: ['Harare', 'Bulawayo'] }
router.post('/:patientId', requireClinicalRole, async (req, res) => {
    const patientId    = parseInt(req.params.patientId, 10);
    const weatherAlerts = req.body?.weatherAlerts || [];

    if (isNaN(patientId)) {
        return res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    }

    try {
        const result = await calculateRiskScore(patientId, weatherAlerts);
        return res.json({
            success : true,
            data    : {
                patientId        : result.patientId,
                score            : result.score,            // 0–100
                label            : result.label,            // Low / Medium / High
                factors          : result.factors,          // human-readable drivers
                predictionSource : result.predictionSource, // ml_model or fallback_engine
                features         : result.features,         // full 28-feature snapshot
            },
        });
    } catch (err) {
        console.error(`[predictions/${patientId}]`, err.message);

        if (err.message.includes('not found')) {
            return res.status(404).json({ success: false, message: err.message });
        }
        return res.status(500).json({ success: false, message: 'Prediction failed. Please try again.' });
    }
});


// ── GET /api/predictions/:patientId/history ───────────────────────────────────
// Returns the last 20 predictions ever run for this patient.
// Used for the audit trail / history panel on the patient detail page.
router.get('/:patientId/history', requireClinicalRole, async (req, res) => {
    const patientId = parseInt(req.params.patientId, 10);

    if (isNaN(patientId)) {
        return res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT id, risk_score, risk_label, prediction_source, feature_snapshot, created_at
             FROM risk_scores
             WHERE patient_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [patientId]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error(`[predictions/${patientId}/history]`, err.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch prediction history.' });
    }
});


module.exports = router;