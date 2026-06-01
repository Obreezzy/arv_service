
const axios = require('axios');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:5000';


// MAIN: calculateRiskScore

/**
 * Calculates ARV default risk score for a single patient.
 *
 * @param {Object}   patient             
 * @param {number}   daysOverdue        
 * @param {number}   pastDefaults        
 * @param {string[]} activeWeatherAlerts 
 * @returns {Object} { score, label, factors }
 */
const calculateRiskScore = async (
    patient,
    daysOverdue,
    pastDefaults = 0,
    activeWeatherAlerts = []
) => {
    const payload = buildMLPayload(patient, daysOverdue, pastDefaults);

    const response = await axios.post(`${ML_API_URL}/predict`, payload, {
        timeout : 60000,
        headers : { 'Content-Type': 'application/json' }
    });

    const result = response.data;

    //Weather alert logic
    const patientLocation = (
        patient.location || patient.address || ''
    ).toLowerCase();

    const isAffectedByWeather = activeWeatherAlerts.some(
        alertLocation => patientLocation.includes(alertLocation.toLowerCase())
    );

    if (isAffectedByWeather) {
        result.score   = Math.min(100, result.score + 15);
        result.factors = [...result.factors, 'Active Weather Alert in Area'];
        if      (result.score >= 75) result.label = 'High';
        else if (result.score >= 40) result.label = 'Medium';
        else                         result.label = 'Low';
    }

    return {
        score   : result.score,
        label   : result.label,
        factors : result.factors
    };
};


// BATCH: Score multiple patients at once — for dashboard

/**
 * Batch risk calculation for multiple patients.
 * More efficient than calling calculateRiskScore() in a loop.
 *
 * @param {Array} patients 
 * @returns {Array} [{ patient_id, score, label, factors }]
 */
const batchCalculateRisk = async (patients) => {
    const payload = {
        patients: patients.map(p => buildMLPayload(
            p, p.days_overdue || 0, p.past_defaults || 0
        ))
    };

    const response = await axios.post(`${ML_API_URL}/batch`, payload, {
        timeout: 30000
    });

    return response.data.predictions;
};


// HEALTH CHECK — call on server startup

const checkMLHealth = async () => {
    try {
        const res = await axios.get(`${ML_API_URL}/health`, { timeout: 60000 });
        console.log(`ML Risk Engine online — ${res.data.model}`);
        return true;
    } catch (err) {
        console.error(' ML Risk Engine offline. Please start the Flask API.');
        console.error(`   Expected at: ${ML_API_URL}`);
        console.error(`   Run: cd ml_api && python app.py`);
        return false;
    }
};


// HELPER: Build ML API payload from patient object
// Maps your exact DB field names to ML API fields

const buildMLPayload = (patient, daysOverdue, pastDefaults) => ({
    age                      : getAge(patient.date_of_birth),
    gender                   : patient.gender || 'F',
    marital_status           : patient.marital_status || 'Married',
    distance_from_clinic_km  : parseFloat(patient.distance_from_clinic || 0),
    who_clinical_stage       : patient.who_clinical_stage || 2,
    regimen                  : patient.regimen || 'TLD',
    chronic_conditions       : patient.chronic_diseases || '',
    past_defaults            : pastDefaults,
    total_appointments       : patient.total_appointments || 1,
    days_overdue             : daysOverdue,
    treatment_supporter      : patient.treatment_supporter ? 1 : 0,
    years_on_art             : getYearsOnART(patient.art_start_date),
});


// HELPERS

// Calculate age from date of birth
const getAge = (dobString) => {
    if (!dobString) return 0;
    const today     = new Date();
    const birthDate = new Date(dobString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
};

// Calculate years on ART from start date
const getYearsOnART = (artStartDate) => {
    if (!artStartDate) return 2.0;
    const start = new Date(artStartDate);
    const now   = new Date();
    return Math.max(0, (now - start) / (365.25 * 24 * 60 * 60 * 1000));
};


module.exports = { calculateRiskScore, batchCalculateRisk, checkMLHealth };
