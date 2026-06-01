const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);


router.get('/', async (req, res) => {
    try {
        const missedPatients = await query(`
            SELECT p.patient_id, p.next_pickup_date, p.risk_level,
                   (CURRENT_DATE - p.next_pickup_date) AS days_overdue
            FROM patients p
            WHERE p.next_pickup_date <= CURRENT_DATE - 3
            AND p.is_active = true
            AND p.patient_id NOT IN (
                SELECT patient_id FROM defaulters
            )
        `);

        for (const patient of missedPatients.rows) {
            const daysOverdue = parseInt(patient.days_overdue) || 3;
            let riskLevel = patient.risk_level || 'Low';
            if (!patient.risk_level || patient.risk_level === 'Low') {
                if (daysOverdue > 14) riskLevel = 'High';
                else if (daysOverdue > 7) riskLevel = 'Medium';
                else riskLevel = 'Low';
            }

            await query(`
                INSERT INTO defaulters (patient_id, days_overdue, risk_level, status, detected_date)
                VALUES ($1, $2, $3, 'pending', CURRENT_DATE)
            `, [patient.patient_id, daysOverdue, riskLevel]);
        }

        
        await query(`
            UPDATE defaulters d
            SET days_overdue = (CURRENT_DATE - p.next_pickup_date)
            FROM patients p
            WHERE d.patient_id = p.patient_id
            AND d.status = 'pending'
            AND p.next_pickup_date IS NOT NULL
        `);

        
        await query(`
            DELETE FROM defaulters 
            WHERE status = 'pending' AND days_overdue < 3
        `);

        const result = await query(`
            SELECT 
                d.defaulter_id, d.patient_id, d.days_overdue, d.status, d.detected_date,
                p.first_name, p.last_name, p.phone_number, p.patient_number,
                COALESCE(d.risk_level, 
                    CASE 
                        WHEN d.days_overdue > 14 THEN 'High'
                        WHEN d.days_overdue > 7 THEN 'Medium'
                        ELSE 'Low'
                    END
                ) AS risk_level
            FROM defaulters d
            JOIN patients p ON d.patient_id = p.patient_id
            WHERE d.status = 'pending'
            ORDER BY d.days_overdue DESC
        `);

        res.json({ success: true, defaulters: result.rows });
    } catch (err) {
        console.error("Error fetching defaulters:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// RESOLVE DEFAULTER STATUS
router.put('/:id/resolve', async (req, res) => {
    const { status } = req.body;
    const defaulterId = req.params.id;

    try {
        const result = await query(
            `UPDATE defaulters 
             SET status = $1 
             WHERE defaulter_id = $2 
             RETURNING *`,
            [status, defaulterId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Defaulter record not found' });
        }

        res.json({ success: true, message: 'Status updated successfully', data: result.rows[0] });
    } catch (err) {
        console.error("Error resolving defaulter:", err);
        res.status(500).json({ success: false, message: 'Server error while resolving' });
    }
});

module.exports = router;