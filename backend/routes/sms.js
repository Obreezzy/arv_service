const express = require('express');
const router = express.Router();
const SMS_SERVICE = require('../services/sms');
const db = require('../config/db');


router.get('/test', (req, res) => {
  console.log('Test route hit!');
  res.json({
    success: true,
    message: 'SMS routes are working!',
    devMode: process.env.SMS_DEV_MODE === 'true'
  });
});


// Send SMS to ONE defaulter

router.post('/send-reminder', async (req, res) => {
  try {
    console.log(' SMS send-reminder route hit!');
    console.log('Request body:', req.body);
    
    const { defaulterId } = req.body;

    if (!defaulterId) {
      console.log('No defaulterId in request');
      return res.status(400).json({ 
        error: 'Defaulter ID is required' 
      });
    }

    console.log(`Looking for defaulter with ID: ${defaulterId}`);

    // FIXED QUERY: Use patient_id instead of id
    const query = `
      SELECT 
        d.defaulter_id,
        d.patient_id,
        d.days_overdue,
        d.risk_level,
        p.first_name,
        p.last_name,
        p.phone_number
      FROM defaulters d
      JOIN patients p ON d.patient_id = p.patient_id
      WHERE d.defaulter_id = $1
    `;

    console.log('Running query with defaulter_id:', defaulterId);

    const result = await db.query(query, [defaulterId]);
    const defaulters = result.rows;

    console.log('Query result:', result.rows);

    if (!defaulters || defaulters.length === 0) {
      console.log('Defaulter not found in database');
      return res.status(404).json({ 
        error: 'Defaulter not found' 
      });
    }

    const defaulter = defaulters[0];

    // ADD THESE DEBUG LOGS
    console.log('Full defaulter object:', defaulter);
    console.log('All keys:', Object.keys(defaulter));
    console.log('Phone number field:', defaulter.phone_number);

    // Create patient object for SMS service
    const patientForSMS = {
      name: `${defaulter.first_name} ${defaulter.last_name}`,
      phone: defaulter.phone_number
    };

    console.log(`Found patient: ${patientForSMS.name}`);
    console.log(`Phone: ${patientForSMS.phone}`);

    // Validate phone
    if (!patientForSMS.phone) {
      console.log('No phone number found');
      return res.status(400).json({ 
        error: 'Patient has no phone number' 
      });
    }

    if (!SMS_SERVICE.validatePhoneNumber(patientForSMS.phone)) {
      console.log('Invalid phone number format:', patientForSMS.phone);
      return res.status(400).json({ 
        error: 'Invalid phone number format. Must start with + and include country code' 
      });
    }

    console.log('Phone validated');

    // Send SMS
    let smsResult;
    if (defaulter.risk_level === 'high' || defaulter.days_overdue > 7) {
      console.log('Sending URGENT SMS');
      smsResult = await SMS_SERVICE.sendUrgentSMS(patientForSMS, defaulter.days_overdue);
    } else {
      console.log('Sending regular reminder');
      smsResult = await SMS_SERVICE.sendReminderSMS(patientForSMS, defaulter.days_overdue);
    }

    if (smsResult.success) {
      console.log('SMS sent successfully!');
      
      res.json({
        success: true,
        message: 'SMS sent successfully',
        data: {
          phone: patientForSMS.phone,
          name: patientForSMS.name,
          messageSid: smsResult.messageSid,
          devMode: smsResult.devMode || false
        }
      });
    } else {
      console.log('SMS failed:', smsResult.error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        details: smsResult.error
      });
    }

  } catch (error) {
    console.error('ERROR in send-reminder:', error);
    console.error('Error message:', error.message);
    
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  }
});

// CRITICAL: Export the router!
module.exports = router;