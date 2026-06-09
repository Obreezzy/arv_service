const { query } = require('../config/db');
const smsService = require('../services/sms');

const sendFollowUpsJob = async () => {
    try {
        console.log('\n========================================');
        console.log('AUTOMATED JOB: Follow-Up SMS to Defaulters');
        console.log('Started:', new Date().toISOString());
        console.log('========================================\n');

        const defaulters = await query(`
            SELECT 
                d.defaulter_id,
                d.patient_id,
                d.days_overdue,
                d.risk_level,
                d.status,
                p.first_name,
                p.last_name,
                p.phone_number,
                p.patient_number
            FROM defaulters d
            JOIN patients p ON d.patient_id = p.patient_id
            WHERE d.status = 'pending'
            AND p.is_active = true
            AND p.phone_number IS NOT NULL
            AND d.days_overdue IN (5, 7, 14)
            ORDER BY d.days_overdue DESC
        `);

        if (defaulters.rows.length === 0) {
            console.log('No defaulters at follow-up thresholds (day 5, 7, or 14) today.');
            console.log('\n========================================');
            console.log('Job completed');
            console.log('Ended:', new Date().toISOString());
            console.log('========================================\n');
            return { success: true, sent: 0 };
        }

        console.log(`Found ${defaulters.rows.length} defaulters to follow up\n`);

        // Log who will be contacted
        defaulters.rows.forEach((d, i) => {
            console.log(`  ${i + 1}. ${d.first_name} ${d.last_name} (${d.patient_number}) — ${d.days_overdue} days overdue → ${d.phone_number}`);
        });

        console.log('\n');

        // Escalates in urgency
        const getFollowUpMessage = (patient) => {
            const name = patient.first_name;
            const days = patient.days_overdue;

            if (days >= 14) {
                // Day 14 — Critical, most urgent
                return `CRITICAL ALERT: Dear ${name}, you have missed your ARV medication pickup for ${days} days. Missing ARV treatment for this long is very dangerous to your health. Please visit the clinic TODAY or call us immediately. Your health team is very concerned about you.`;
            }

            if (days >= 7) {
                // Day 7 — Urgent
                return `URGENT: Dear ${name}, it has been ${days} days since you missed your ARV medication pickup. Please visit the clinic as soon as possible. Missing medication puts your health at serious risk. We are here to help — please come in or contact us.`;
            }

            // Day 5 — First follow-up, gentle reminder
            return `Dear ${name}, we noticed you missed your ARV medication pickup ${days} days ago. Please visit the clinic at your earliest convenience to collect your medication. Your health is our priority. Stay well!`;
        };

        // ============================================
        // Prepare and send SMS to each defaulter
        // ============================================
        const results = { total: 0, successful: 0, failed: 0, details: [] };

        for (const defaulter of defaulters.rows) {
            const message = getFollowUpMessage(defaulter);
            const phone = defaulter.phone_number;

            console.log(`Sending day-${defaulter.days_overdue} follow-up to ${defaulter.first_name} ${defaulter.last_name}...`);

            const smsResult = await smsService.sendSMS(phone, message);

            results.total++;

            if (smsResult.success) {
                results.successful++;
                console.log(`Sent — SID: ${smsResult.messageSid}`);
                results.details.push({
                    patient_id: defaulter.patient_id,
                    patient_number: defaulter.patient_number,
                    name: `${defaulter.first_name} ${defaulter.last_name}`,
                    phone,
                    days_overdue: defaulter.days_overdue,
                    status: 'sent',
                    messageSid: smsResult.messageSid
                });
            } else {
                results.failed++;
                console.log(`Failed — ${smsResult.error}`);
                results.details.push({
                    patient_id: defaulter.patient_id,
                    patient_number: defaulter.patient_number,
                    name: `${defaulter.first_name} ${defaulter.last_name}`,
                    phone,
                    days_overdue: defaulter.days_overdue,
                    status: 'failed',
                    error: smsResult.error
                });
            }
        }

        console.log(`\nFollow-up SMS results:`);
        console.log(`  Total:      ${results.total}`);
        console.log(`  Successful: ${results.successful}`);
        console.log(`  Failed:     ${results.failed}`);

        console.log('\n========================================');
        console.log('Job completed successfully');
        console.log('Ended:', new Date().toISOString());
        console.log('========================================\n');

        return {
            success: true,
            total: results.total,
            sent: results.successful,
            failed: results.failed,
            details: results.details
        };

    } catch (error) {
        console.error('Follow-up job failed:', error.message);

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

module.exports = sendFollowUpsJob;