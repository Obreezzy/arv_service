const { query } = require('../config/db');
const smsService = require('../services/sms');

const sendRemindersJob = async (daysAhead = 3) => {
    try {
        console.log('\n========================================');
        console.log(`AUTOMATED JOB: Send ${daysAhead}-Day Reminders`);
        console.log('Started:', new Date().toISOString());
        console.log('========================================\n');

        const patients = await query(
            `SELECT DISTINCT ON (patient_id)
                patient_id, patient_number, first_name, last_name,
                phone_number, next_pickup_date
             FROM (

                -- SOURCE 1: patients table (covers new patients)
                SELECT
                    p.patient_id,
                    p.patient_number,
                    p.first_name,
                    p.last_name,
                    p.phone_number,
                    p.next_pickup_date
                FROM patients p
                WHERE p.next_pickup_date = CURRENT_DATE + INTERVAL '1 day' * $1
                AND p.is_active = true
                AND p.phone_number IS NOT NULL

                UNION

                -- SOURCE 2: medication_pickups table (covers returning patients)
                SELECT
                    p.patient_id,
                    p.patient_number,
                    p.first_name,
                    p.last_name,
                    p.phone_number,
                    mp.next_pickup_date
                FROM patients p
                JOIN medication_pickups mp ON p.patient_id = mp.patient_id
                WHERE mp.next_pickup_date = CURRENT_DATE + INTERVAL '1 day' * $1
                AND p.is_active = true
                AND p.phone_number IS NOT NULL

             ) combined_results
             ORDER BY patient_id, next_pickup_date DESC`,
            [daysAhead]
        );

        if (patients.rows.length === 0) {
            console.log(`No patients with pickups in ${daysAhead} days`);
            console.log('\n========================================');
            console.log('Job completed');
            console.log('Ended:', new Date().toISOString());
            console.log('========================================\n');
            return { success: true, sent: 0 };
        }

        console.log(`Found ${patients.rows.length} patients to remind\n`);

        patients.rows.forEach((p, i) => {
            console.log(`  ${i + 1}. ${p.first_name} ${p.last_name} (${p.patient_number}) → ${p.phone_number} | Pickup: ${p.next_pickup_date}`);
        });

        console.log('\n');


        const recipients = patients.rows.map(patient => {
            const pickupDate = convertToDisplayDate(patient.next_pickup_date);
            return {
                phoneNumber: patient.phone_number,
                message: `Hello ${patient.first_name}, reminder: Your medication pickup is due on ${pickupDate}. Please collect on time. Stay healthy!`,
                messageType: `reminder_${daysAhead}days`,
                patientId: patient.patient_id
            };
        });

  
        const result = await smsService.sendBulkSMS(recipients);

        console.log(`\nReminders sent: ${result.successful}/${result.total}`);
        console.log(`Failed: ${result.failed}`);

        if (result.results) {
            result.results.forEach(r => {
                if (r.success) {
                    console.log(`Sent to patient ${r.patientId} → SID: ${r.messageSid}`);
                } else {
                    console.log(`Failed for patient ${r.patientId} → ${r.error}`);
                }
            });
        }

        console.log('\n========================================');
        console.log('Job completed successfully');
        console.log('Ended:', new Date().toISOString());
        console.log('========================================\n');

        return {
            success: true,
            total: result.total,
            sent: result.successful,
            failed: result.failed
        };

    } catch (error) {
        console.error('Job failed:', error.message);

        console.log('\n========================================');
        console.log('Job completed with errors');
        console.log('Ended:', new Date().toISOString());
        console.log('========================================\n');

        return {
            success: false,
            error: error.message
        };
    }
};

// ============================================
// Convert YYYY-MM-DD to DD-MM-YYYY for SMS
// ============================================
const convertToDisplayDate = (yyyymmdd) => {
    if (!yyyymmdd) return '';
    const date = new Date(yyyymmdd);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
};

module.exports = sendRemindersJob;