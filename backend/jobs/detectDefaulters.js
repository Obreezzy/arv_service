const { query, getClient } = require('../config/db');

const detectDefaultersJob = async () => {
    const client = await getClient();
    
    try {
        console.log('\n========================================');
        console.log('AUTOMATED JOB: Defaulter Detection');
        console.log('Started:', new Date().toISOString());
        console.log('========================================\n');

        await client.query('BEGIN');
        
        const gracePeriod = 3; 

        const missedPickups = await client.query(
            `SELECT DISTINCT ON (mp.patient_id)
                mp.patient_id,
                p.patient_number,
                p.first_name,
                p.last_name,
                p.phone_number,
                p.distance_from_clinic,
                mp.next_pickup_date as missed_pickup_date,
                CURRENT_DATE - mp.next_pickup_date as days_overdue,
                COUNT(d.defaulter_id) FILTER (WHERE d.status = 'returned') as previous_defaults
             FROM medication_pickups mp
             JOIN patients p ON mp.patient_id = p.patient_id
             LEFT JOIN defaulters d ON p.patient_id = d.patient_id
             WHERE mp.next_pickup_date < CURRENT_DATE - INTERVAL '1 day' * $1
             AND p.is_active = true
             AND NOT EXISTS (
                 SELECT 1 FROM medication_pickups mp2
                 WHERE mp2.patient_id = mp.patient_id
                 AND mp2.actual_pickup_date > mp.next_pickup_date
             )
             AND NOT EXISTS (
                 SELECT 1 FROM defaulters d2
                 WHERE d2.patient_id = mp.patient_id
                 AND d2.status = 'pending'
             )
             GROUP BY mp.patient_id, p.patient_number, p.first_name, p.last_name, 
                      p.phone_number, p.distance_from_clinic, mp.next_pickup_date
             ORDER BY mp.patient_id, mp.next_pickup_date DESC`,
            [gracePeriod]
        );

        const newDefaulters = [];

        for (const patient of missedPickups.rows) {
            const riskLevel = calculateRiskLevel(
                patient.days_overdue,
                patient.previous_defaults,
                patient.distance_from_clinic
            );

           
            const result = await client.query(
                `INSERT INTO defaulters (
                    patient_id, missed_pickup_date, days_overdue, risk_level, status
                ) VALUES ($1, $2, $3, $4, 'pending')
                RETURNING *`,
                [patient.patient_id, patient.missed_pickup_date, patient.days_overdue, riskLevel]
            );

            newDefaulters.push({
                ...result.rows[0],
                patient_info: {
                    patient_number: patient.patient_number,
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    phone_number: patient.phone_number
                }
            });
        }

        await client.query('COMMIT');

        console.log(`Detected ${newDefaulters.length} new defaulters`);
        
        if (newDefaulters.length > 0) {
            console.log('\nNew Defaulters:');
            newDefaulters.forEach((d, i) => {
                console.log(`  ${i + 1}. ${d.patient_info.first_name} ${d.patient_info.last_name} (${d.patient_info.patient_number})`);
                console.log(`     Risk: ${d.risk_level.toUpperCase()} | Days overdue: ${d.days_overdue}`);
            });
        }

        console.log('\n========================================');
        console.log('Job completed successfully');
        console.log('Ended:', new Date().toISOString());
        console.log('========================================\n');

        return {
            success: true,
            detected: newDefaulters.length,
            defaulters: newDefaulters
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Job failed:', error.message);
        
        console.log('\n========================================');
        console.log('Job completed with errors');
        console.log('Ended:', new Date().toISOString());
        console.log('========================================\n');

        return {
            success: false,
            error: error.message
        };
    } finally {
        client.release();
    }
};

const calculateRiskLevel = (daysOverdue, previousDefaults, distanceFromClinic) => {
    let score = 0;

    if (daysOverdue >= 14) score += 3;
    else if (daysOverdue >= 7) score += 2;
    else score += 1;

    if (previousDefaults >= 3) score += 3;
    else if (previousDefaults >= 1) score += 2;

    if (distanceFromClinic > 15) score += 2;
    else if (distanceFromClinic > 5) score += 1;

    if (score >= 6) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
};

module.exports = detectDefaultersJob;