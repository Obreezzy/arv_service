// backend/routes/predictions.js
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { calculateRiskScore, batchCalculateRisk } = require('../services/mlService');

function requireClinicalRole(req, res, next) {
    const role = req.user?.role;
    if (!role || !['admin', 'healthcare_worker'].includes(role)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    next();
}

// ── POST /api/predictions/batch ───────────────────────────────────
router.post('/batch', requireClinicalRole, async (req, res) => {
    const { patientIds = [], weatherAlerts = [] } = req.body;

    if (!Array.isArray(patientIds) || patientIds.length === 0) {
        return res.status(400).json({ success: false, message: 'patientIds array is required.' });
    }

    try {
        // Fetch full patient objects first
        const { rows: patients } = await db.query(
            `SELECT * FROM patients WHERE patient_id = ANY($1::int[]) AND is_active = true`,
            [patientIds]
        );

        if (patients.length === 0) {
            return res.json({ success: true, predictions: [], count: 0 });
        }

        // For each patient get days overdue and past defaults
        const enriched = await Promise.all(patients.map(async (p) => {
            const daysOverdue = p.next_pickup_date
                ? Math.max(0, Math.floor((new Date() - new Date(p.next_pickup_date)) / (1000 * 60 * 60 * 24)))
                : 0;
            const { rows: def } = await db.query(
                `SELECT COUNT(*) as count FROM defaulters WHERE patient_id = $1`, [p.patient_id]
            );
            return { ...p, days_overdue: daysOverdue, past_defaults: parseInt(def[0]?.count || 0) };
        }));

        // Run predictions
        const predictions = await Promise.all(enriched.map(async (p) => {
            const result = await calculateRiskScore(p, p.days_overdue, p.past_defaults, weatherAlerts);

            // Save back to patients table
            await db.query(
                `UPDATE patients SET risk_score=$1, risk_level=$2, risk_factors=$3 WHERE patient_id=$4`,
                [result.score, result.label, JSON.stringify(result.factors), p.patient_id]
            );

            return { patient_id: p.patient_id, score: result.score, label: result.label, factors: result.factors };
        }));

        return res.json({ success: true, predictions, count: predictions.length });

    } catch (err) {
        console.error('[predictions/batch]', err.message);
        return res.status(500).json({ success: false, message: 'Batch prediction failed.' });
    }
});
// ── POST /api/predictions/:patientId ─────────────────────────────
router.post('/:patientId', requireClinicalRole, async (req, res) => {
    const patientId     = parseInt(req.params.patientId, 10);
    const weatherAlerts = req.body?.weatherAlerts || [];

    if (isNaN(patientId)) {
        return res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    }

    try {
        // 1. Fetch patient from DB
        const { rows } = await db.query(
            `SELECT * FROM patients WHERE patient_id = $1 AND is_active = true`,
            [patientId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Patient not found.' });
        }

        const patient = rows[0];

        // 2. Calculate days overdue from next_pickup_date
        const daysOverdue = patient.next_pickup_date
            ? Math.max(0, Math.floor((new Date() - new Date(patient.next_pickup_date)) / (1000 * 60 * 60 * 24)))
            : 0;

        // 3. Get past defaults count
        const { rows: defaultRows } = await db.query(
            `SELECT COUNT(*) as count FROM defaulters WHERE patient_id = $1`,
            [patientId]
        );
        const pastDefaults = parseInt(defaultRows[0]?.count || 0);

        // 4. Run ML prediction
        const result = await calculateRiskScore(patient, daysOverdue, pastDefaults, weatherAlerts);

        // 5. Save score back to patients table
        await db.query(
            `UPDATE patients 
             SET risk_score = $1, risk_level = $2, risk_factors = $3, updated_at = NOW()
             WHERE patient_id = $4`,
            [result.score, result.label, JSON.stringify(result.factors), patientId]
        );

        // 6. Save to risk_scores audit table
        await db.query(
            `INSERT INTO risk_scores 
             (patient_id, risk_probability, risk_score, risk_label, model_version, scored_by, feature_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                patientId,
                result.score / 100,
                result.score,
                result.label,
                '2.0.0',
                req.user?.id || null,
                JSON.stringify(result.factors)
            ]
        );

        return res.json({
            success : true,
            data    : {
                patientId : patientId,
                score     : result.score,
                label     : result.label,
                factors   : result.factors,
            }
        });

    } catch (err) {
        console.error(`[predictions/${patientId}]`, err.message);
        return res.status(500).json({ success: false, message: 'Prediction failed. Please try again.' });
    }
});

// ── GET /api/predictions/:patientId/history ───────────────────────
router.get('/:patientId/history', requireClinicalRole, async (req, res) => {
    const patientId = parseInt(req.params.patientId, 10);

    if (isNaN(patientId)) {
        return res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    }

    try {
        const { rows } = await db.query(
            `SELECT score_id, risk_score, risk_label, model_version, feature_snapshot, created_at
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