/**
 * SMART ML RISK ENGINE
 * Drop-in replacement for riskEngine.js
 * Calls the Python Flask ML API (LR + RF Ensemble)
 * Falls back to original weighted score if API is unreachable.
 *
 * USAGE — replace this in your code:
 *   const { calculateRiskScore } = require('./riskEngine');
 *   const risk = calculateRiskScore(patient, daysOverdue, pastDefaults);
 *
 * WITH this:
 *   const { calculateRiskScore } = require('./mlService');
 *   const risk = await calculateRiskScore(patient, daysOverdue, pastDefaults, activeWeatherAlerts);
 *
 * Author: Obriel Makamanzi | University of Zimbabwe
 */

const axios = require('axios');

// ── Flask API URL ─────────────────────────────────────────────────
// Local : http://localhost:5000
// Deploy: set ML_API_URL in your .env file
const ML_API_URL = process.env.ML_API_URL || 'http://localhost:5000';

// ── Helper: Calculate Age (same as riskEngine.js) ─────────────────
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

// ── Helper: Years on ART ──────────────────────────────────────────
const getYearsOnART = (artStartDate) => {
    if (!artStartDate) return 2.0;
    const start = new Date(artStartDate);
    const now   = new Date();
    return Math.max(0, (now - start) / (365.25 * 24 * 60 * 60 * 1000));
};

/**
 * Main function — same signature as riskEngine.js calculateRiskScore()
 * Now ASYNC — add await when calling it.
 *
 * @param {Object}   patient             - Patient object from your DB
 * @param {number}   daysOverdue         - Days since scheduled pickup
 * @param {number}   pastDefaults        - Number of past missed pickups
 * @param {string[]} activeWeatherAlerts - Active weather alert locations
 * @returns {Object} { score, label, factors }
 */
const calculateRiskScore = async (
    patient,
    daysOverdue,
    pastDefaults = 0,
    activeWeatherAlerts = []
) => {
    try {
        // ── Build payload using your exact patient field names ─────
        const payload = {
            // Demographics — matches your patient object fields
            age                      : getAge(patient.date_of_birth),
            gender                   : patient.gender || 'F',
            marital_status           : patient.marital_status || 'Married',

            // Location — matches distance_from_clinic in your riskEngine
            distance_from_clinic_km  : parseFloat(patient.distance_from_clinic || 0),

            // Clinical fields
            who_clinical_stage       : patient.who_clinical_stage || 2,
            regimen                  : patient.regimen || 'TLD',

            // Chronic diseases — matches your exact field name
            chronic_conditions       : patient.chronic_diseases || '',

            // Adherence history
            past_defaults            : pastDefaults,
            total_appointments       : patient.total_appointments || 1,
            days_overdue             : daysOverdue,

            // Social support
            treatment_supporter      : patient.treatment_supporter ? 1 : 0,

            // Time on ART
            years_on_art             : getYearsOnART(patient.art_start_date),
        };

        // ── Call Flask ML API ─────────────────────────────────────
        const response = await axios.post(`${ML_API_URL}/predict`, payload, {
            timeout : 8000,
            headers : { 'Content-Type': 'application/json' }
        });

        const result = response.data;

        // ── Weather alert logic — kept exactly from riskEngine.js ──
        const patientLocation = (
            patient.location || patient.address || ''
        ).toLowerCase();

        const isAffectedByWeather = activeWeatherAlerts.some(
            alertLocation => patientLocation.includes(alertLocation.toLowerCase())
        );

        if (isAffectedByWeather) {
            result.score   = Math.min(100, result.score + 15);
            result.factors = [...result.factors, 'Active Weather Alert in Area'];
            // Recalculate label after weather bump
            if      (result.score >= 75) result.label = 'High';
            else if (result.score >= 40) result.label = 'Medium';
            else                         result.label = 'Low';
        }

        // ── Return same shape as riskEngine.js ────────────────────
        return {
            score   : result.score,
            label   : result.label,
            factors : result.factors
        };

    } catch (error) {
        // ── Fallback to original weighted score engine ─────────────
        // This runs if Flask API is down, cold starting, or unreachable
        // Your system NEVER crashes — seamless fallback
        console.warn(' ML API unavailable — using weighted fallback:', error.message);
        return fallbackWeightedScore(patient, daysOverdue, pastDefaults, activeWeatherAlerts);
    }
};


/**
 * Batch predict — get risk scores for all patients at once.
 * Use this for your dashboard to avoid calling /predict 60 times.
 *
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


/**
 * Check ML API health — call this on server startup.
 */
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


// ── FALLBACK: Original weighted score from riskEngine.js ──────────
// Exact copy of your original logic — runs when Flask API is down
const fallbackWeightedScore = (patient, daysOverdue, pastDefaults = 0, activeWeatherAlerts = []) => {
    let riskScore   = 0;
    let riskFactors = [];

    // 1. LATENESS FACTOR
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

    // 2. DEMOGRAPHIC VULNERABILITY
    const age = getAge(patient.date_of_birth);
    if (age >= 18 && age <= 24) {
        riskScore += 20;
        riskFactors.push("High-Risk Age Group (18-24)");
    } else if (age > 65) {
        riskScore += 10;
        riskFactors.push("Geriatric Vulnerability");
    }

    // 3. GEOGRAPHIC BARRIER
    const distance = parseFloat(patient.distance_from_clinic || 0);
    if (distance > 20) {
        riskScore += 20;
        riskFactors.push(`Long Distance Commuter (${distance}km)`);
    } else if (distance > 10) {
        riskScore += 10;
        riskFactors.push("Moderate Distance Barrier");
    }

    // 4. HISTORICAL ADHERENCE
    if (pastDefaults > 2) {
        riskScore += 20;
        riskFactors.push("Chronic History of Defaulting");
    } else if (pastDefaults > 0) {
        riskScore += 10;
        riskFactors.push("Previous Default Record");
    }

    // 5. CHRONIC DISEASES
    if (patient.chronic_diseases && patient.chronic_diseases.trim() !== '') {
        riskScore += 15;
        riskFactors.push(`Comorbidities Present (${patient.chronic_diseases})`);
    }

    // 6. WEATHER & LOCATION BARRIER
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
