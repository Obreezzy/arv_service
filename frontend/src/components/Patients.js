import React, { useState, useEffect, useCallback, Component } from 'react';
import { Search, Eye, Pencil, UserPlus, Trash2 } from 'lucide-react';
import './Patients.css';
import { patientsAPI, predictionsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';
import PatientFormModal from './PatientForm';
import PatientDetailsModal from './PatientDetailsModal';
import PatientEditForm from './PatientEditForm';

class PatientsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Patients Component Crash:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', margin: '2rem', background: '#fee2e2', border: '2px solid #ef4444', borderRadius: '8px', color: '#991b1b' }}>
          <h2 style={{ marginTop: 0 }}>System Error: React Render Crash Detected</h2>
          <p>The Patients page crashed. Please check the error below to find the exact cause:</p>
          <pre style={{ background: '#f87171', color: 'white', padding: '1rem', borderRadius: '4px', overflowX: 'auto', fontSize: '14px' }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          <details style={{ marginTop: '1rem', cursor: 'pointer' }}>
            <summary style={{ fontWeight: 'bold' }}>View Component Stack Trace</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', marginTop: '0.5rem', opacity: 0.8 }}>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

function PatientsContent({ initialRiskFilter = 'All', currentUser }) {
  const { showToast } = useNotifications();

  const [patients, setPatients]               = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [analyzing, setAnalyzing]             = useState(false);
  const [showModal, setShowModal]             = useState(false);
  const [riskFilter, setRiskFilter]           = useState(initialRiskFilter || 'All');
  const [searchQuery, setSearchQuery]         = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [editingPatient, setEditingPatient]   = useState(null);
  const [activeAlerts, setActiveAlerts]       = useState([]);

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true);
      const res = await patientsAPI.getAllPatients();
      
      let dataArr = [];
      if (Array.isArray(res)) dataArr = res;
      else if (res && Array.isArray(res.data)) dataArr = res.data;
      else if (res && Array.isArray(res.patients)) dataArr = res.patients;
      
      setPatients(dataArr);
    } catch (err) {
      console.error('Error loading patients:', err);
      setPatients([]); 
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenModal    = useCallback(() => setShowModal(true),  []);
  const handleCloseModal   = useCallback(() => setShowModal(false), []);
  const handlePatientSaved = useCallback(() => {
    setShowModal(false);
    loadPatients();
  }, [loadPatients]);

  const handleCloseDetails = useCallback(() => setSelectedPatient(null), []);
  const handleEditFromDetails = useCallback((p) => {
    setSelectedPatient(null);
    setEditingPatient(p);
  }, []);
  const handleCloseEdit    = useCallback(() => setEditingPatient(null), []);
  const handleSearchChange = useCallback((e) => setSearchQuery(e.target.value || ''), []);
  const handleEditSaved = useCallback(() => {
    setEditingPatient(null);
    loadPatients();
  }, [loadPatients]);

  // NEW: Delete Patient Logic
  const handleDeletePatient = async (patient) => {
    if (!window.confirm(`CRITICAL WARNING: Are you sure you want to permanently delete ${patient.first_name} ${patient.last_name}? This will erase their entire clinical history, lab results, and pickup logs. This cannot be undone.`)) {
      return;
    }
    try {
      setLoading(true);
      await patientsAPI.deletePatient(patient.patient_id);
      showToast({ type: 'success', message: 'Patient completely deleted from the database.' });
      loadPatients();
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: 'Error deleting patient.' });
      setLoading(false);
    }
  };

  useEffect(() => { 
    setRiskFilter(initialRiskFilter || 'All'); 
  }, [initialRiskFilter]);
  
  useEffect(() => { 
    loadPatients(); 
  }, [loadPatients]);

  const runPrediction = async () => {
    if (!patients || patients.length === 0) {
      showToast({ type: 'warning', message: 'No patients to analyse.' });
      return;
    }
    try {
      setAnalyzing(true);
      showToast({ type: 'info', message: 'Running Predictive Analysis...' });

      const patientIds   = patients.map(p => p.patient_id).filter(Boolean);
      const weatherZones = (activeAlerts || []).map(a => a?.affectedArea).filter(Boolean);
      const res          = await predictionsAPI.batchPredict(patientIds, weatherZones);
      
      let predictions = [];
      if (res && Array.isArray(res.predictions)) predictions = res.predictions;
      else if (res && Array.isArray(res.data)) predictions = res.data;
      else if (res && res.data && Array.isArray(res.data.data)) predictions = res.data.data;
      else if (res && res.data && Array.isArray(res.data.predictions)) predictions = res.data.predictions;

      if (predictions.length) {
        const scoreMap = {};
        predictions.forEach(r => { 
            const id = r?.patient_id || r?.patientId;
            if (id) scoreMap[id] = r; 
        });

        setPatients(prev => prev.map(p => {
          const pred = scoreMap[p.patient_id];
          if (!pred) return p;
          return { ...p, risk_score: pred.score, risk_label: pred.label };
        }));

        showToast({ type: 'success', message: `Prediction complete — ${predictions.length} patients scored.` });
      } else {
        showToast({ type: 'warning', message: 'Prediction ran but returned no results.' });
      }
    } catch (err) {
      console.error('[runPrediction]', err);
      showToast({ type: 'error', message: 'Analysis failed. Please try again.' });
    } finally {
      setAnalyzing(false);
    }
  };

  const stripLocationKeywords = (str) =>
    (str || '').toLowerCase()
      .replace(/\bward\b|\bvillage\b|\bdistrict\b|\bchieftaincy\b|\bsabhuku\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  const getPatientAlerts = (patient) => {
    if (!activeAlerts || !activeAlerts.length || !patient) return [];
    
    const pWard     = stripLocationKeywords(String(patient.ward     || ''));
    const pVillage  = stripLocationKeywords(String(patient.village  || ''));
    const pDistrict = stripLocationKeywords(String(patient.district || ''));
    const pHeadman  = stripLocationKeywords(String(patient.headman  || ''));

    return activeAlerts.filter(alert => {
      const a = stripLocationKeywords(alert?.affectedArea);
      if (!a) return false;
      return (pWard     && (pWard === a || a === pWard)) ||
             (pVillage  && (pVillage.includes(a)  || a.includes(pVillage)))  ||
             (pDistrict && (pDistrict.includes(a) || a.includes(pDistrict))) ||
             (pHeadman  && (pHeadman.includes(a)  || a.includes(pHeadman)));
    });
  };

  const getEffectiveRisk = (patient) => {
    if (!patient) return { score: 0, label: 'Low', boosted: false, boost: 0 };
    
    const base    = parseFloat(patient.risk_score) || 0;
    const alerts  = getPatientAlerts(patient);
    const boost   = alerts.reduce((sum, a) => sum + (a?.riskBoost || 0), 0);
    const effective = Math.min(base + boost, 100);
    const label   = effective >= 75 ? 'High' : effective >= 40 ? 'Medium' : 'Low';
    
    return { score: effective, label, boosted: boost > 0, boost };
  };

  const getRiskClass = (label) => {
    switch ((label || '').toLowerCase()) {
      case 'high':   return 'risk-high';
      case 'medium': return 'risk-medium';
      default:       return 'risk-low';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Not Set';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return String(d.getDate()).padStart(2, '0') + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           d.getFullYear();
  };

  const getPickupStatus = (dateStr) => {
    if (!dateStr) return null;
    const pickup = new Date(dateStr);
    if (isNaN(pickup.getTime())) return null;
    
    const today  = new Date(); 
    today.setHours(0, 0, 0, 0);
    pickup.setHours(0, 0, 0, 0);
    
    const diff = Math.ceil((pickup - today) / (1000 * 60 * 60 * 24));
    if (diff < 0)  return 'overdue';
    if (diff <= 3) return 'soon';
    return 'normal';
  };

  const filteredPatients = patients.filter(p => {
    if (!p) return false;
    
    const effective = getEffectiveRisk(p);
    const safeRiskFilter = riskFilter || 'All';
    const matchesRisk = safeRiskFilter === 'All' || 
                        (effective.label || '').toLowerCase() === safeRiskFilter.toLowerCase();
                        
    const s = (searchQuery || '').toLowerCase();
    const fullName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
    
    const matchesSearch =
      (p.display_id || '').toLowerCase().includes(s) ||
      (p.patient_number || '').toLowerCase().includes(s) ||
      (p.phone_number || '').toLowerCase().includes(s) ||
      (p.first_name || '').toLowerCase().includes(s) ||
      (p.last_name || '').toLowerCase().includes(s) ||
      fullName.includes(s);
      
    return matchesRisk && matchesSearch;
  });

  return (
    <div className="patients-page">

      {activeAlerts.length > 0 && (
        <div className="patients-weather-notice">
          <strong>{activeAlerts.length} weather alert(s) active.</strong> Affected patients show boosted risk scores below.
        </div>
      )}

      <div className="page-header">
        <div className="header-content">
          <h2 className="page-title">Patient Registry</h2>
          <p className="page-subtitle">
            Showing: {filteredPatients.length} {riskFilter !== 'All' ? riskFilter + ' Risk ' : ''}Patients
          </p>
        </div>
        <div className="header-actions">
          <div className="search-container">
            <Search size={16} />
            <input
              type="text"
              className="search-input"
              placeholder="Search ID, Name, Phone..."
              value={searchQuery}
              onChange={handleSearchChange}
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>

          <select
            className="filter-dropdown"
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
          >
            <option value="All">All Patients</option>
            <option value="High">High Risk Only</option>
            <option value="Medium">Medium Risk Only</option>
            <option value="Low">Low Risk Only</option>
          </select>

          <button
            className={'btn-predict' + (analyzing || patients.length === 0 ? ' disabled' : '')}
            onClick={runPrediction}
            disabled={analyzing || patients.length === 0}
          >
            <span className="icon">{analyzing ? 'Wait' : 'Run'}</span>
            {analyzing ? 'Analyzing...' : 'Predict Risks'}
          </button>

          <button className="btn-add-patient" onClick={handleOpenModal}>
            <UserPlus size={16} /> New Patient
          </button>
        </div>
      </div>

      <div className="table-container">
        <div className="table-scroll">
          {filteredPatients.length === 0 && !loading ? (
            <div className="empty-state">
              <h3>No patients found</h3>
              <p>
                {searchQuery ? `No results match "${searchQuery}".` : `No patients matching "${riskFilter}" risk filter.`}
              </p>
              <button
                className="btn-show-all"
                onClick={() => { setRiskFilter('All'); setSearchQuery(''); }}
              >
                Clear Filters and Show All
              </button>
            </div>
          ) : (
            <table className="patients-table">
              <thead>
                <tr>
                  <th>Patient No</th>
                  <th>Age</th>
                  <th>Next Pickup</th>
                  <th>Predicted Risk</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map(p => {
                  if (!p) return null;
                  
                  let age = 'N/A';
                  if (p.date_of_birth) {
                      const dob = new Date(p.date_of_birth);
                      if (!isNaN(dob.getTime())) {
                          age = new Date().getFullYear() - dob.getFullYear();
                      }
                  }
                  
                  const effective     = getEffectiveRisk(p);
                  const riskClass     = getRiskClass(effective.label);
                  const pickupStatus  = getPickupStatus(p.next_pickup_date);
                  const patientAlerts = getPatientAlerts(p);

                  return (
                    <tr key={p.patient_id} className={effective.boosted ? 'weather-affected-row' : ''}>
                      <td className="fw-bold">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {p.display_id || 'UNKNOWN'}
                          {effective.boosted && (
                            <span
                              className="weather-warning-icon"
                              title={'Weather alert: ' + patientAlerts.map(a => a?.label || 'Alert').join(', ') + ' (+' + effective.boost + '% risk)'}
                            >[!]</span>
                          )}
                        </div>
                      </td>

                      <td>{age}</td>

                      <td>
                        {p.next_pickup_date ? (
                          <span className={'pickup-badge pickup-' + pickupStatus}>
                            {pickupStatus === 'overdue' && 'Overdue: '}
                            {pickupStatus === 'soon'    && 'Due Soon: '}
                            {formatDate(p.next_pickup_date)}
                          </span>
                        ) : (
                          <span className="pickup-badge pickup-none">Not Set</span>
                        )}
                      </td>

                      <td>
                        <div className="risk-meter-wrapper">
                          <div className="risk-track">
                            <div className={'risk-fill ' + riskClass} style={{ width: effective.score + '%' }} />
                          </div>
                          <span className={'risk-score-text ' + riskClass}>{effective.score}%</span>
                        </div>
                        {effective.boosted && (
                          <div className="weather-boost-tag">+{effective.boost}% weather</div>
                        )}
                      </td>

                      <td>
                        <span className={'status-badge ' + (p.is_active ? 'active' : 'inactive')}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td>
                        <div className="action-buttons">
                          <button className="btn-icon view" title="View Details" onClick={() => setSelectedPatient(p)}><Eye size={15} /></button>
                          <button className="btn-icon edit" title="Edit Patient" onClick={() => setEditingPatient(p)}><Pencil size={15} /></button>
                          <button className="btn-icon delete" title="Delete Patient" style={{ color: '#ef4444' }} onClick={() => handleDeletePatient(p)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <PatientFormModal onClose={handleCloseModal} onSuccess={handlePatientSaved} currentUser={currentUser} />
      )}
      {selectedPatient && (
        <PatientDetailsModal patient={selectedPatient} onClose={handleCloseDetails} onEdit={handleEditFromDetails} />
      )}
      {editingPatient && (
        <PatientEditForm patient={editingPatient} onClose={handleCloseEdit} onSuccess={handleEditSaved} />
      )}
    </div>
  );
}

export default function Patients(props) {
  return (
    <PatientsErrorBoundary>
      <PatientsContent {...props} />
    </PatientsErrorBoundary>
  );
}