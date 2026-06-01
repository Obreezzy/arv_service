const express = require('express');
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();


router.use(verifyToken);

// ROUTE 1: GET DASHBOARD OVERVIEW

router.get('/overview', async (req, res) => {
    try {
        console.log('Fetching dashboard overview');

        const [
            patientStats,
            pickupStats,
            defaulterStats,
            upcomingPickups,
            recentActivity
        ] = await Promise.all([
            getPatientStatistics(),
            getPickupStatistics(),
            getDefaulterStatistics(),
            getUpcomingPickups(7),
            getRecentActivity(10)
        ]);

 
        const adherenceRate = calculateAdherenceRate(
            patientStats.active_patients,
            defaulterStats.active_defaulters
        );

        res.json({
            success: true,
            message: 'Dashboard overview retrieved successfully',
            data: {
                summary: {
                    total_patients: patientStats.total_patients,
                    active_patients: patientStats.active_patients,
                    active_defaulters: defaulterStats.active_defaulters,
                    adherence_rate: adherenceRate,
                    upcoming_pickups_7days: upcomingPickups.length,
                    
                    high_risk_total: (parseInt(patientStats.high_risk_patients) || 0) + 
                                   (parseInt(defaulterStats.high_risk) || 0)
                },
                patients: patientStats,
                pickups: pickupStats,
                defaulters: defaulterStats,
                upcoming: upcomingPickups,
                recent_activity: recentActivity,
                alerts: generateAlerts(defaulterStats, upcomingPickups)
            }
        });

    } catch (error) {
        console.error('Error fetching dashboard overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard overview',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


router.get('/patients', async (req, res) => {
    try {
        const stats = await getPatientStatistics();
        res.json({
            success: true,
            message: 'Patient statistics retrieved successfully',
            stats: stats
        });
    } catch (error) {
        console.error('Error fetching patient statistics:', error);
        res.status(500).json({ success: false, message: 'Error fetching patient statistics' });
    }
});



router.get('/defaulter-trends', async (req, res) => {
    try {
        const months = parseInt(req.query.months) || 6;
        const trends = await query(
            `SELECT 
                TO_CHAR(flagged_date, 'YYYY-MM') as month,
                COUNT(*) as total_defaulters,
                COUNT(*) FILTER (WHERE risk_level ILIKE 'high') as high_risk,
                COUNT(*) FILTER (WHERE risk_level ILIKE 'medium') as medium_risk,
                COUNT(*) FILTER (WHERE risk_level ILIKE 'low') as low_risk,
                COUNT(*) FILTER (WHERE status = 'returned') as returned,
                AVG(days_overdue) as avg_days_overdue
             FROM defaulters
             WHERE flagged_date >= CURRENT_DATE - INTERVAL '1 month' * $1
             GROUP BY TO_CHAR(flagged_date, 'YYYY-MM')
             ORDER BY month DESC`,
            [months]
        );

        res.json({
            success: true,
            message: 'Defaulter trends retrieved successfully',
            trends: trends.rows.map(row => ({
                ...row,
                avg_days_overdue: Math.round(parseFloat(row.avg_days_overdue) || 0)
            }))
        });
    } catch (error) {
        console.error('Error fetching defaulter trends:', error);
        res.status(500).json({ success: false, message: 'Error fetching trends' });
    }
});


router.get('/urgent-actions', async (req, res) => {
    try {
        const highRiskDefaulters = await query(
            `SELECT d.defaulter_id, d.days_overdue, p.patient_id, p.patient_number, 
             p.first_name, p.last_name, p.phone_number
             FROM defaulters d JOIN patients p ON d.patient_id = p.patient_id
             WHERE d.status = 'pending' AND d.risk_level ILIKE 'high'
             ORDER BY d.days_overdue DESC LIMIT 20`
        );

        const pickupsToday = await query(
            `SELECT p.patient_id, p.patient_number, p.first_name, p.last_name, p.phone_number, mp.next_pickup_date
             FROM patients p JOIN medication_pickups mp ON p.patient_id = mp.patient_id
             WHERE mp.next_pickup_date = CURRENT_DATE AND p.is_active = true
             AND NOT EXISTS (SELECT 1 FROM medication_pickups mp2 WHERE mp2.patient_id = p.patient_id AND mp2.actual_pickup_date = CURRENT_DATE)`
        );

        const neverPickedUp = await query(
            `SELECT p.patient_id, p.patient_number, p.first_name, p.last_name, p.phone_number, p.enrollment_date
             FROM patients p WHERE NOT EXISTS (SELECT 1 FROM medication_pickups mp WHERE mp.patient_id = p.patient_id)
             AND p.enrollment_date < CURRENT_DATE - 7 AND p.is_active = true
             ORDER BY p.enrollment_date ASC LIMIT 10`
        );

        res.json({
            success: true,
            urgent_actions: {
                high_risk_defaulters: highRiskDefaulters.rows,
                pickups_today: pickupsToday.rows,
                never_picked_up: neverPickedUp.rows
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching urgent actions' });
    }
});



const getPatientStatistics = async () => {
    const result = await query(`
        SELECT
            COUNT(*) as total_patients,
            COUNT(*) FILTER (WHERE is_active = true) as active_patients,
            COUNT(*) FILTER (WHERE risk_level ILIKE 'high') as high_risk_patients,
            COUNT(*) FILTER (WHERE risk_level ILIKE 'medium') as medium_risk_patients,
            COUNT(*) FILTER (WHERE gender = 'Male') as male_patients,
            COUNT(*) FILTER (WHERE gender = 'Female') as female_patients
        FROM patients
    `);
    return result.rows[0];
};

const getPickupStatistics = async () => {
    const result = await query(`
        SELECT
            COUNT(*) as total_pickups,
            COUNT(*) FILTER (WHERE actual_pickup_date = CURRENT_DATE) as pickups_today,
            AVG(days_supply) as avg_days_supply
        FROM medication_pickups
    `);
    return {
        ...result.rows[0],
        avg_days_supply: Math.round(parseFloat(result.rows[0].avg_days_supply) || 30)
    };
};

const getDefaulterStatistics = async () => {
    const result = await query(`
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') as active_defaulters,
            COUNT(*) FILTER (WHERE risk_level ILIKE 'high') as high_risk,
            COUNT(*) FILTER (WHERE risk_level ILIKE 'medium') as medium_risk,
            COUNT(*) FILTER (WHERE risk_level ILIKE 'low') as low_risk,
            AVG(days_overdue) FILTER (WHERE status = 'pending') as avg_days_overdue
        FROM defaulters
    `);
    return {
        ...result.rows[0],
        avg_days_overdue: Math.round(parseFloat(result.rows[0].avg_days_overdue) || 0)
    };
};

const getUpcomingPickups = async (days) => {
    const result = await query(
        `SELECT COUNT(*) as count
         FROM (
             SELECT DISTINCT ON (p.patient_id) p.patient_id
             FROM patients p
             JOIN medication_pickups mp ON p.patient_id = mp.patient_id
             WHERE mp.next_pickup_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day' * $1
             AND p.is_active = true
             ORDER BY p.patient_id, mp.next_pickup_date DESC
         ) subquery`,
        [days]
    );
    return Array(parseInt(result.rows[0].count) || 0).fill({});
};

const getRecentActivity = async (limit) => {
    const pickups = await query(
        `SELECT 'pickup' as type, mp.created_at, p.first_name || ' ' || p.last_name as patient_name,
         p.patient_number, 'Medication collected' as description
         FROM medication_pickups mp JOIN patients p ON mp.patient_id = p.patient_id
         ORDER BY mp.created_at DESC LIMIT $1`,
        [limit]
    );
    return pickups.rows;
};

const calculateAdherenceRate = (activePatients, activeDefaulters) => {
    const total = parseInt(activePatients) || 0;
    const defaulting = parseInt(activeDefaulters) || 0;
    if (total === 0) return 0;
    
    const adherent = Math.max(0, total - defaulting);
    return Math.round((adherent / total) * 100);
};

const generateAlerts = (defaulterStats, upcomingPickups) => {
    const alerts = [];
    if (defaulterStats.high_risk > 0) {
        alerts.push({
            type: 'critical',
            message: `${defaulterStats.high_risk} high-risk defaulters need immediate follow-up`,
            action: 'Review high-risk defaulters',
            link: '/defaulters?risk=high'
        });
    }
    return alerts;
};

module.exports = router;