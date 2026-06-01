import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
    const token = sessionStorage.getItem('token'); 
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
}, (error) => Promise.reject(error));

export const authAPI = {
  login: async (credentials) => { 
      const response = await api.post('/auth/login', credentials); 
      return response.data; 
  },
  getCurrentUser: async () => { 
      const response = await api.get('/auth/me'); 
      return response.data; 
  },
  register: async (userData) => { 
      const response = await api.post('/auth/register', userData); 
      return response.data; 
  }
};

export const usersAPI = {
  getAllUsers: async () => {
      const response = await api.get('/users');
      return response.data;
  },
  toggleStatus: async (id, is_active) => {
      const response = await api.put(`/users/${id}/status`, { is_active });
      return response.data;
  }
};

export const dashboardAPI = {
  getStats: async () => { 
      const response = await api.get('/dashboard/overview'); 
      return response.data; 
  }
};

export const patientsAPI = {
  getAllPatients: async () => { 
      const response = await api.get('/patients'); 
      return response.data; 
  },
  getPatientById: async (id) => { 
      const response = await api.get(`/patients/${id}`); 
      return response.data; 
  },
  createPatient: async (patientData) => { 
      const response = await api.post('/patients', patientData); 
      return response.data; 
  },
  updatePatient: async (id, patientData) => { 
      const response = await api.put(`/patients/${id}`, patientData); 
      return response.data; 
  },

  // kept for backward compat — internally delegates to predictionsAPI.batchPredict
  predictRisk: async (patientIds = [], weatherAlerts = []) => {
      const response = await api.post('/predictions/batch', { patientIds, weatherAlerts });
      return response.data;
  }
};

export const predictionsAPI = {
  // Single patient — "Run AI Risk Predictor" button on patient detail
  runForPatient: async (patientId, weatherAlerts = []) => {
      const response = await api.post(`/predictions/${patientId}`, { weatherAlerts });
      return response.data;
  },

  // Bulk — scores all patients at once for the dashboard/patient list
  batchPredict: async (patientIds = [], weatherAlerts = []) => {
      const response = await api.post('/predictions/batch', { patientIds, weatherAlerts });
      return response.data;
  },

  // Audit history — last 20 predictions for a patient
  getHistory: async (patientId) => {
      const response = await api.get(`/predictions/${patientId}/history`);
      return response.data;
  },
};

export const defaultersAPI = {
  getAllDefaulters: async () => { 
      const response = await api.get('/defaulters'); 
      return response.data; 
  },
  runDetection: async () => { 
      const response = await api.post('/defaulters/detect', { grace_period: 3 }); 
      return response.data; 
  },
  resolveDefaulter: async (id, resolutionData) => { 
      const response = await api.put(`/defaulters/${id}/resolve`, resolutionData); 
      return response.data; 
  }
};

export const pickupsAPI = {
  recordPickup: async (pickupData) => { 
      const response = await api.post('/pickups/record', pickupData); 
      return response.data; 
  },
  getPatientPickups: async (patientId) => { 
      const response = await api.get(`/pickups/patient/${patientId}`); 
      return response.data; 
  }
};

export const smsAPI = {
  sendReminder: async (defaulterId) => { 
      const response = await api.post('/sms/send-reminder', { defaulterId }); 
      return response.data; 
  }
};

export const clinicsAPI = {
  getClinics: async () => {
    const response = await api.get('/patients/clinics');
    return response.data;
  }
};

export const schedulerAPI = {
  sendReminders: async (days = 1) => {
      const response = await api.post('/scheduler/trigger/send-reminders', { days });
      return response.data;
  },
  triggerDetection: async () => {
      const response = await api.post('/scheduler/trigger/detect-defaulters');
      return response.data;
  },
  getStatus: async () => {
      const response = await api.get('/scheduler/status');
      return response.data;
  }
};

export default api;