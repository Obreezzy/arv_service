import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

export const smsAPI = {
  
  /**
   * Send reminder SMS to ONE defaulter
   * 
   * @param {number} defaulterId - ID of the defaulter
   * @returns {Promise} - Response from backend
   */
  sendReminder: async (defaulterId) => {
    try {
      console.log(` Sending SMS request for defaulter ${defaulterId}`);
      
      // Make POST request to backend
      const response = await axios.post(`${API_URL}/sms/send-reminder`, {
        defaulterId: defaulterId
      });
      
      console.log(' SMS request successful:', response.data);
      return response.data;
      
    } catch (error) {
      console.error(' SMS request failed:', error);
      throw error;
    }
  },

  /**
   * Send SMS to MULTIPLE defaulters
   * 
   * @param {array} defaulterIds - Array of defaulter IDs
   * @returns {Promise} - Response from backend
   */
  sendBulk: async (defaulterIds) => {
    try {
      console.log(` Sending bulk SMS to ${defaulterIds.length} patients`);
      
      const response = await axios.post(`${API_URL}/sms/send-bulk`, {
        defaulterIds: defaulterIds
      });
      
      console.log(' Bulk SMS request successful:', response.data);
      return response.data;
      
    } catch (error) {
      console.error(' Bulk SMS request failed:', error);
      throw error;
    }
  },

  /**
   * Get SMS sending history
   * 
   * @returns {Promise} - List of sent SMS
   */
  getLogs: async () => {
    try {
      const response = await axios.get(`${API_URL}/sms/logs`);
      return response.data;
    } catch (error) {
      console.error('Error fetching SMS logs:', error);
      throw error;
    }
  }
};

// Export as default
export default smsAPI;