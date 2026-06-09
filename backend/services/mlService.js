const axios = require('axios');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:5000';

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

const getYearsOnART = (artStartDate) => {
    if (!artStartDate) return 2.0;
    const start = new Date(artStartDate);
    const now   = new Date();
    return Math.max(0, (now - start) / (365.25 * 24 * 60 * 60 * 1000));
};

/**
 * same signature as riskEngine.js calculateRiskScore()
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
    try {
        const payload = {
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
        };

        const response = await axios.post(`${ML_API_URL}/predict`, payload, {
            timeout : 8000,
            headers : { 'Content-Type': 'application/json' }
        });

        const result = response.data;

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

    } catch (error) {
        console.warn(' ML API unavailable — using weighted fallback:', error.message);
        return fallbackWeightedScore(patient, daysOverdue, pastDefaults, activeWeatherAlerts);
    }
};


/**
 * Batch predict — get risk scores for all patients at once.
 * @param {Array} patients - Array of patient objects with days_overdue attached
 * @returns {Array} [{ patient_id, score, label, factors }]
 */
const batchCalculateRisk = async (patients) => {
    try {
        const payload = {
            patients: patients.map(p => ({
                patient_id              : p._id || p.id,
                age                     : getAge(p.date_of_birth),
                gender                  : p.gender || 'F',
                marital_status          : p.marital_status || 'Married',
                distance_from_clinic_km : parseFloat(p.distance_from_clinic || 0),
                who_clinical_stage      : p.who_clinical_stage || 2,
                regimen                 : p.regimen || 'TLD',
                chronic_conditions      : p.chronic_diseases || '',
                past_defaults           : p.past_defaults || 0,
                total_appointments      : p.total_appointments || 1,
                days_overdue            : p.days_overdue || 0,
                treatment_supporter     : p.treatment_supporter ? 1 : 0,
                years_on_art            : getYearsOnART(p.art_start_date),
            }))
        };

        const response = await axios.post(`${ML_API_URL}/batch`, payload, {
            timeout: 30000
        });

        return response.data.predictions;

    } catch (error) {
        console.warn('Batch ML API error — using fallback:', error.message);
        return patients.map(p =>
            fallbackWeightedScore(p, p.days_overdue || 0, p.past_defaults || 0)
        );
    }
};


const checkMLHealth = async () => {
    try {
        const res = await axios.get(`${ML_API_URL}/health`, { timeout: 5000 });
        console.log(' ML API is online:', res.data.model);
        return true;
    } catch (err) {
        console.warn(' ML API offline. Weighted fallback is active.');
        return false;
    }
};


const fallbackWeightedScore = (patient, daysOverdue, pastDefaults = 0, activeWeatherAlerts = []) => {
    let riskScore   = 0;
    let riskFactors = [];

    if (daysOverdue > 30) {
        riskScore += 40;
        riskFactors.push("Critically Overdue (>30 days)");
    } else if (daysOverdue > 14) {
        riskScore += 30;
        riskFactors.push("Significantly Overdue (>2 weeks)");
    } else if (daysOverdue > 7) {
        riskScore += 20;
        riskFactors.push("Missed Appointment (>1 week)");
    } else if (daysOverdue > 0) {
        riskScore += 10;
        riskFactors.push("Slightly Delayed");
    }

    const age = getAge(patient.date_of_birth);
    if (age >= 18 && age <= 24) {
        riskScore += 20;
        riskFactors.push("High-Risk Age Group (18-24)");
    } else if (age > 65) {
        riskScore += 10;
        riskFactors.push("Geriatric Vulnerability");
    }

    const distance = parseFloat(patient.distance_from_clinic || 0);
    if (distance > 20) {
        riskScore += 20;
        riskFactors.push(`Long Distance Commuter (${distance}km)`);
    } else if (distance > 10) {
        riskScore += 10;
        riskFactors.push("Moderate Distance Barrier");
    }

    if (pastDefaults > 2) {
        riskScore += 20;
        riskFactors.push("Chronic History of Defaulting");
    } else if (pastDefaults > 0) {
        riskScore += 10;
        riskFactors.push("Previous Default Record");
    }

    if (patient.chronic_diseases && patient.chronic_diseases.trim() !== '') {
        riskScore += 15;
        riskFactors.push(`Comorbidities Present (${patient.chronic_diseases})`);
    }

    const patientLocation = (patient.location || patient.address || "").toLowerCase();
    const isAffectedByWeather = activeWeatherAlerts.some(
        alertLocation => patientLocation.includes(alertLocation.toLowerCase())
    );
    if (isAffectedByWeather) {
        riskScore += 15;
        riskFactors.push("Active Weather Alert in Area");
    }

    riskScore = Math.min(riskScore, 100);
    let riskLabel = 'Low';
    if      (riskScore >= 75) riskLabel = 'High';
    else if (riskScore >= 40) riskLabel = 'Medium';

    return { score: riskScore, label: riskLabel, factors: riskFactors };
};


module.exports = { calculateRiskScore, batchCalculateRisk, checkMLHealth };
