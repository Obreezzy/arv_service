
const express = require('express');
const scheduler = require('../services/scheduler');
const { verifyToken, verifyRole } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);


router.get('/jobs', verifyRole(['admin']), (req, res) => {
    try {
        const jobs = scheduler.getScheduledJobs();

        res.json({
            success: true,
            message: 'Scheduled jobs retrieved successfully',
            count: jobs.length,
            jobs: jobs
        });

    } catch (error) {
        console.error('Error fetching scheduled jobs:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching scheduled jobs',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


router.post('/trigger/detect-defaulters', async (req, res) => {
    try {
        console.log('Manual trigger: Defaulter Detection');
        const username = req.user?.username || 'Authorized Staff';
        console.log('Triggered by:', username);

        const result = await scheduler.triggerDefaulterDetection();

        res.json({
            success: true,
            message: 'Defaulter detection completed',
            result: result
        });

    } catch (error) {
        console.error('Error triggering defaulter detection:', error);
        res.status(500).json({
            success: false,
            message: 'Error triggering defaulter detection',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


router.post('/trigger/send-reminders', async (req, res) => {
    try {
        const { days } = req.body;
        const reminderDays = days || 3;

        console.log(`Manual trigger: Send ${reminderDays}-day reminders`);
        const username = req.user?.username || 'Authorized Staff';
        console.log('Triggered by:', username);

        const result = await scheduler.triggerReminders(reminderDays);

        res.json({
            success: true,
            message: `${reminderDays}-day reminders sent`,
            result: result
        });

    } catch (error) {
        console.error('Error triggering reminders:', error);
        res.status(500).json({
            success: false,
            message: 'Error triggering reminders',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


router.get('/status', verifyRole(['admin']), (req, res) => {
    try {
        const jobs = scheduler.getScheduledJobs();
        const runningJobs = jobs.filter(job => job.running).length;

        res.json({
            success: true,
            message: 'Scheduler status retrieved',
            status: {
                active: runningJobs > 0,
                total_jobs: jobs.length,
                running_jobs: runningJobs,
                timestamp: new Date().toISOString()
            },
            jobs: jobs
        });

    } catch (error) {
        console.error('Error fetching scheduler status:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching scheduler status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;