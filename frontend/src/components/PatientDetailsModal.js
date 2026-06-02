import React, { useState, useEffect } from 'react';
import { X, Pencil, AlertTriangle, CheckCircle, Clock, Brain, Loader } from 'lucide-react';
import './PatientDetailsModal.css';
import { pickupsAPI, predictionsAPI } from '../services/api';
import LabEntryForm from './LabEntryForm';

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
    setLoadingHistory(true);
    try {
      const res = await pickupsAPI.getPatientPickups(patient.patient_id);
      setPickups(res.pickups || res.data || []);
    } catch (err) { console.error('Failed to load history', err); }
    finally { setLoadingHistory(false); }
  };

  const runPrediction = async () => {
    setPredicting(true);
    setPredError(null);
    try {
      const res = await predictionsAPI.runForPatient(patient.patient_id, []);
      setPrediction(res.prediction || res);
    } catch (err) { setPredError('Failed to run prediction.'); }
    finally { setPredicting(false); }
  };

  if (!patient) return null;

  const activeScore  = prediction ? prediction.score      : (patient.risk_score  || 0);
  const activeLabel  = prediction ? prediction.label      : (patient.risk_level  || 'Unknown');
  const activeSource = prediction ? (prediction.predictionSource || prediction.prediction_source) : null;
  const riskColor    = activeScore >= 75 ? '#ef4444' : activeScore >= 40 ? '#f59e0b' : '#10b981';

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Patient Profile</h2>
            <p className="modal-subtitle">ID: {patient.patient_number} | {patient.first_name} {patient.last_name}</p>
          </div>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* UPDATED TABS */}
        <div className="modal-tabs">
          <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>AI Overview</button>
          <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Pickup History</button>
          <button className={`tab-btn ${activeTab === 'labs' ? 'active' : ''}`} onClick={() => setActiveTab('labs')}>Add Lab Results</button>
        </div>

        <div className="modal-body custom-scrollbar">
          {activeTab === 'overview' && (
            <>
               {/* ... Your Existing Overview Content ... */}
               <div className="info-grid">
                  <div className="info-item"><label>Phone</label><p>{patient.phone_number || 'N/A'}</p></div>
                  <div className="info-item"><label>Regimen</label><p>{patient.arv_regimen || 'Standard'}</p></div>
               </div>
               {/* (Rest of your overview code) */}
               <div className="risk-section">
                  <button className="btn-primary" onClick={runPrediction} disabled={predicting}>
                    {predicting ? <Loader className="spin" size={14}/> : <Brain size={14}/>} Run AI Risk Predictor
                  </button>
                  {/* (Risk meter and factors code) */}
               </div>
            </>
          )}

          {activeTab === 'history' && (
            <div className="history-section">
               {/* (Your existing timeline mapping code) */}
            </div>
          )}

          {/* NEW LABS TAB */}
          {activeTab === 'labs' && (
            <div className="labs-tab-content" style={{ padding: '1rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>Enter Clinical Data</h3>
              <LabEntryForm 
                patientId={patient.patient_id} 
                onSuccess={() => setActiveTab('overview')} 
              />
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