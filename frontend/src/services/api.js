import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Create a configured instance
const api = axios.create({
  baseURL: BASE_URL,
  headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache', // Prevent stale data
      'Pragma': 'no-cache'
  }
});

api.interceptors.request.use((config) => {
    const token = sessionStorage.getItem('token'); 
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // Add a timestamp to every request to force fresh data
    config.params = { ...config.params, t: new Date().getTime() };
    return config;
}, (error) => Promise.reject(error));

// ... (keep the rest of authAPI, usersAPI, etc. as they were)
export const authAPI = {
  login: async (credentials) => { const response = await api.post('/auth/login', credentials); return response.data; },
  getCurrentUser: async () => { const response = await api.get('/auth/me'); return response.data; },
  register: async (userData) => { const response = await api.post('/auth/register', userData); return response.data; }
};

export const patientsAPI = {
  getAllPatients: async () => { const response = await api.get('/patients'); return response.data; },
  getPatientById: async (id) => { const response = await api.get(`/patients/${id}`); return response.data; },
  createPatient: async (patientData) => { const response = await api.post('/patients', patientData); return response.data; },
  updatePatient: async (id, patientData) => { const response = await api.put(`/patients/${id}`, patientData); return response.data; }
};

export const defaultersAPI = {
  getAllDefaulters: async () => { const response = await api.get('/defaulters'); return response.data; },
  resolveDefaulter: async (id, resolutionData) => { const response = await api.put(`/defaulters/${id}/resolve`, resolutionData); return response.data; }
};

export const pickupsAPI = {
  recordPickup: async (pickupData) => { const response = await api.post('/pickups/record', pickupData); return response.data; },
  getPatientPickups: async (patientId) => { const response = await api.get(`/pickups/patient/${patientId}`); return response.data; }
};

export default api;