const twilio = require('twilio');
require('dotenv').config();

const DEVELOPMENT_MODE = process.env.SMS_DEV_MODE === 'true';

let client = null;
if (!DEVELOPMENT_MODE) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (accountSid && authToken) {
    client = twilio(accountSid, authToken);
  }
}

const SMS_SERVICE = {
  async sendSMS(phoneNumber, message) {
    try {
      console.log(`Sending SMS to ${phoneNumber}`);

      if (DEVELOPMENT_MODE) {
        console.log('DEV MODE: Simulating SMS send');
        console.log(`To: ${phoneNumber}`);
        console.log(`Message: ${message}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return {
          success: true,
          messageSid: 'DEV_' + Date.now(),
          status: 'sent_dev_mode',
          to: phoneNumber,
          devMode: true
        };
      }

      if (!client) {
        throw new Error('Twilio client not initialized. Check your credentials.');
      }

      const response = await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber
      });

      console.log(`SMS sent! SID: ${response.sid}`);
      return {
        success: true,
        messageSid: response.sid,
        status: response.status,
        to: phoneNumber
      };

    } catch (error) {
      console.error('SMS failed:', error.message);
      return { success: false, error: error.message };
    }
  },

  // Used by sendReminders.js
  async sendBulkSMS(recipients) {
    const results = { total: recipients.length, successful: 0, failed: 0, results: [] };

    for (const recipient of recipients) {
      const result = await this.sendSMS(recipient.phoneNumber, recipient.message);
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
      }
      results.results.push({ ...result, patientId: recipient.patientId });
    }

    return results;
  },

  async sendReminderSMS(patient, daysMissed) {
    const message = `Hello ${patient.name}, this is a reminder from your healthcare center. You have missed your medication pickup by ${daysMissed} days. Please visit the clinic as soon as possible. Your health is important to us.`;
    return await this.sendSMS(patient.phone, message);
  },

  async sendFollowUpSMS(patient) {
    const message = `Hello ${patient.name}, thank you for responding to our call. Please remember to collect your medication at your earliest convenience. Stay healthy!`;
    return await this.sendSMS(patient.phone, message);
  },

  async sendUrgentSMS(patient, daysMissed) {
    const message = `URGENT: ${patient.name}, you have missed your medication for ${daysMissed} days. This is critical for your health. Please contact the clinic immediately or visit us today. Your health team is concerned.`;
    return await this.sendSMS(patient.phone, message);
  },

  validatePhoneNumber(phoneNumber) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }
};

module.exports = SMS_SERVICE;