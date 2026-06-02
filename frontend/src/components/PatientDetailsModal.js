import React, { useState, useEffect } from 'react';
import { X, Pencil, AlertTriangle, CheckCircle, Clock, Brain, Loader } from 'lucide-react';
import './PatientDetailsModal.css';
import { pickupsAPI, predictionsAPI } from '../services/api';

function PatientDetailsModal({ patient, onClose, onEdit }) {
  const [activeTab, setActiveTab]         = useState('overview');
  const [pickups, setPickups]             = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [predicting, setPredicting]       = useState(false);
  const [prediction, setPrediction]       = useState(null);   
  const [predError, setPredError]         = useState(null);

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab]);

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const res = await pickupsAPI.getPatientPickups(patient.patient_id);
      setPickups(res.pickups || res.data || []);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const runPrediction = async () => {
    try {
      setPredicting(true);
      setPredError(null);
      const res = await predictionsAPI.runForPatient(patient.patient_id, []);
      setPrediction(res.prediction || res);
    } catch (err) {
      console.error('Prediction failed', err);
      setPredError('Failed to run prediction. Please try again.');
    } finally {
      setPredicting(false);
    }
  };

  if (!patient) return null;

  const activeScore  = prediction ? prediction.score      : (patient.risk_score  || 0);
  const activeLabel  = prediction ? prediction.label      : (patient.risk_level  || 'Unknown');
  const activeSource = prediction ? prediction.prediction_source : null;

  const getFactors = () => {
    if (prediction && prediction.factors) return prediction.factors;
    if (!patient.risk_factors) return [];
    if (Array.isArray(patient.risk_factors)) return patient.risk_factors;
    try { return JSON.parse(patient.risk_factors); } catch (e) { return []; }
  };
  const activeFactors = getFactors();

  const getRiskColor = (score) => {
    if (score >= 75) return '#ef4444';  
    if (score >= 40) return '#f59e0b';  
    return '#10b981';                   
  };
  const riskColor = getRiskColor(activeScore);

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header" style={{ paddingBottom: '1rem', borderBottom: 'none' }}>
          <div>
            <h2 className="modal-title">Patient Profile</h2>
            <p className="modal-subtitle">
              ID: {patient.patient_number || 'Not Set'} | {patient.full_name || `${patient.first_name} ${patient.last_name}`}
            </p>
          </div>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-tabs">
          <button
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            AI Overview
          </button>
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            Pickup History
          </button>
        </div>

        <div className="modal-body custom-scrollbar">

          {activeTab === 'overview' && (
            <>
              <div className="info-grid">
                <div className="info-item">
                  <label>Phone Contact</label>
                  <p>{patient.phone_number || 'N/A'}</p>
                </div>
                <div className="info-item">
                  <label>Months on ART</label>
                  <p>{patient.months_on_art || '0'}</p>
                </div>
                <div className="info-item">
                  <label>WHO Clinical Stage</label>
                  <p>Stage {patient.who_clinical_stage || 'N/A'}</p>
                </div>
                <div className="info-item">
                  <label>Regimen</label>
                  <p>{patient.arv_regimen || 'Standard'}</p>
                </div>
                <div className="info-item">
                  <label>Marital Status</label>
                  <p>{patient.marital_status || 'N/A'}</p>
                </div>
                <div className="info-item">
                  <label>Treatment Supporter</label>
                  <p>{patient.treatment_supporter ? 'Yes' : 'No'}</p>
                </div>
                <div className="info-item">
                  <label>Chronic Score</label>
                  <p>{patient.chronic_score || '0'}</p>
                </div>
                <div className="info-item">
                  <label>TB Co-infection</label>
                  <p>{patient.tb_flag ? 'Yes' : 'No'}</p>
                </div>
                {patient.gender === 'F' && (
                  <div className="info-item">
                    <label>Pregnancy Status</label>
                    <p>{patient.pregnancy_flag ? 'Pregnant' : 'Not Pregnant'}</p>
                  </div>
                )}
                <div className="info-item">
                  <label>Status</label>
                  <p>{patient.is_active ? 'Active' : 'Inactive'}</p>
                </div>
              </div>

              <hr className="divider" />

              <div className="risk-section">
                <div className="risk-header">
                  <h3>Smart Risk Analysis</h3>
                  <span className="risk-badge" style={{ backgroundColor: riskColor }}>
                    {activeLabel.toUpperCase()} RISK
                  </span>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <button
                    className="btn-primary"
                    onClick={runPrediction}
                    disabled={predicting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                  >
                    {predicting
                      ? <><Loader size={14} className="spin" /> Running XGBoost Model...</>
                      : <><Brain size={14} /> Run AI Risk Predictor</>
                    }
                  </button>

                  {activeSource && (
                    <span style={{
                      marginTop: '0.4rem',
                      display: 'inline-block',
                      fontSize: '0.72rem',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: activeSource === 'ml_model' ? '#d1fae5' : '#fef3c7',
                      color: activeSource === 'ml_model' ? '#065f46' : '#92400e',
                    }}>
                      {activeSource === 'ml_model' ? 'Verified: XGBoost Model' : 'Warning: Fallback Engine'}
                    </span>
                  )}

                  {predError && (
                    <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '0.4rem' }}>{predError}</p>
                  )}
                </div>

                <div className="risk-meter-container">
                  <div className="risk-score-label">
                    <span>Predicted Default Probability</span>
                    <span style={{ color: riskColor, fontWeight: 'bold' }}>{activeScore}%</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${activeScore}%`, backgroundColor: riskColor }}
                    ></div>
                  </div>
                  <div style={{ position: 'relative', height: '16px' }}>
                    <div style={{
                      position: 'absolute',
                      left: '40%',
                      borderLeft: '2px dashed #6b7280',
                      height: '12px',
                      top: 0,
                    }} />
                    <span style={{ position: 'absolute', left: '41%', fontSize: '0.65rem', color: '#6b7280' }}>
                      threshold 40
                    </span>
                  </div>
                </div>

                <div className="risk-factors-box">
                  <h4>Why is this patient at risk?</h4>
                  {activeFactors.length > 0 ? (
                    <ul className="factors-list">
                      {activeFactors.map((factor, i) => (
                        <li key={i}>{factor}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="no-risk">
                      {prediction
                        ? 'No significant risk factors detected.'
                        : 'Click Run AI Risk Predictor to analyse this patient.'}
                    </p>
                  )}
                </div>

                {prediction && (
                  <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                    Probability: {(prediction.probability * 100).toFixed(1)}% |
                    Prediction: {prediction.prediction === 1 ? 'High Risk Vector' : 'Low Risk Vector'} |
                    Model: {prediction.model}
                  </p>
                )}
              </div>
            </>
          )}

          {activeTab === 'history' && (
            <div className="history-section">
              {loadingHistory ? (
                <p style={{ textAlign: 'center', color: '#6b7280', padding: '2rem' }}>Loading medical history...</p>
              ) : pickups.length === 0 ? (
                <div className="empty-history">
                  <p>No pickups recorded for this patient yet.</p>
                </div>
              ) : (
                <div className="timeline">
                  {pickups.map((pickup, index) => {
                    const actualDate    = new Date(pickup.pickup_date || pickup.actual_pickup_date);
                    const scheduledDate = new Date(pickup.next_expected_date || pickup.next_pickup_date);
                    const isRecent      = index === 0;

                    const prevRecord           = pickups[index + 1];
                    const scheduledForThisVisit = prevRecord ? new Date(prevRecord.next_expected_date || prevRecord.next_pickup_date) : null;
                    const isLate               = scheduledForThisVisit ? actualDate > scheduledForThisVisit : false;
                    const daysLate             = scheduledForThisVisit && isLate
                      ? Math.floor((actualDate - scheduledForThisVisit) / (1000 * 60 * 60 * 24))
                      : 0;

                    return (
                      <div className="timeline-item" key={pickup.pickup_id || index}>
                        <div className={`timeline-marker ${isLate ? 'late' : 'on-time'}`}></div>
                        <div className="timeline-content">
                          <div className="timeline-header">
                            <strong>{actualDate.toLocaleDateString('en-GB')}</strong>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              {isLate && <span className="badge-late"><AlertTriangle size={12} /> {daysLate}d Late</span>}
                              {!isLate && scheduledForThisVisit && <span className="badge-ontime"><CheckCircle size={12} /> On Time</span>}
                              {isRecent && <span className="badge-new"><Clock size={12} /> Latest Record</span>}
                            </div>
                          </div>
                          {scheduledForThisVisit && (
                            <p>
                              <strong>Scheduled for:</strong> {scheduledForThisVisit.toLocaleDateString('en-GB')}{' '}
                              {isLate
                                ? <span style={{ color: '#ef4444' }}>({daysLate} days late)</span>
                                : <span style={{ color: '#10b981' }}>(on time)</span>}
                            </p>
                          )}
                          <p><strong>Next appointment:</strong> {scheduledDate.toLocaleDateString('en-GB')}</p>
                          {pickup.days_supply && <p><strong>Days Supply Dispensed:</strong> {pickup.days_supply}</p>}
                          {pickup.notes && <p className="timeline-notes">Notes: "{pickup.notes}"</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => onEdit(patient)}><Pencil size={15} /> Edit Details</button>
        </div>
      </div>
    </div>
  );
}

export default PatientDetailsModal;