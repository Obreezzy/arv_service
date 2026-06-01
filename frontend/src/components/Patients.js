import React, { useState, useEffect } from 'react';
import { Search, Eye, Pencil, TrendingUp, UserPlus, Loader2 } from 'lucide-react';
import './Patients.css';
import { patientsAPI, predictionsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';
import PatientFormModal from './PatientForm';
import PatientDetailsModal from './PatientDetailsModal';
import PatientEditForm from './PatientEditForm';

function Patients({ initialRiskFilter = 'All', currentUser }) {
 const { showToast } = useNotifications();

 const [patients, setPatients] = useState([]);
 const [loading, setLoading] = useState(true);
 const [analyzing, setAnalyzing] = useState(false);
 const [showModal, setShowModal] = useState(false);
 const [riskFilter, setRiskFilter] = useState(initialRiskFilter);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedPatient, setSelectedPatient] = useState(null);
 const [editingPatient, setEditingPatient] = useState(null);
 const [activeAlerts, setActiveAlerts] = useState([]);

 useEffect(() => {
 setRiskFilter(initialRiskFilter);
 }, [initialRiskFilter]);

 useEffect(() => {
 loadPatients();
 }, []);

 const loadPatients = async () => {
 try {
 setLoading(true);
 const res = await patientsAPI.getAllPatients();
 setPatients(res.data || []);
 setLoading(false);
 } catch (err) {
 console.error(err);
 setLoading(false);
 }
 };

const runPrediction = async () => {
  if (patients.length === 0) {
    showToast({ type: 'warning', message: 'No patients to analyse. Register patients first.' });
    return;
  }
  try {
    setAnalyzing(true);
    showToast({ type: 'info', message: '🤖 Running Predictive Analysis...' });

    const patientIds   = patients.map(p => p.patient_id);
    const weatherZones = activeAlerts.map(a => a.affectedArea);

    const res = await predictionsAPI.batchPredict(patientIds, weatherZones);

    // Backend returns { success, predictions: [...] }
    const predictions = res.predictions || res.data || [];

    if (predictions.length) {
      const scoreMap = {};
      predictions.forEach(r => { scoreMap[r.patient_id] = r; }); // fix: patient_id not patientId

      setPatients(prev => prev.map(p => {
        const pred = scoreMap[p.patient_id];
        if (!pred) return p;
        return {
          ...p,
          risk_score : pred.score,
          risk_label : pred.label,
        };
      }));

      showToast({ type: 'success', message: ` Prediction complete — ${predictions.length} patients scored.` });
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

 // Strip location keywords to get the raw value 
 // "Ward 14" → "14", "Chigodora Village" → "chigodora"
 const stripLocationKeywords = (str) => {
 return (str || '')
 .toLowerCase()
 .replace(/\bward\b/gi, '')
 .replace(/\bvillage\b/gi, '')
 .replace(/\bdistrict\b/gi, '')
 .replace(/\bchieftaincy\b/gi, '')
 .replace(/\bsabhuku\b/gi, '')
 .replace(/[^a-z0-9\s]/g, '')
 .replace(/\s+/g, ' ')
 .trim();
 };

 // Match alert against ONLY the patient's specific location fields 
 // Each field is checked individually — not combined into one string
 // This prevents "14" in "Ward 14" matching patient number "P84955014"
 const getPatientAlerts = (patient) => {
 if (!activeAlerts.length) return [];

 // Patient's individual location fields, normalised
 const patientWard = stripLocationKeywords(String(patient.ward || ''));
 const patientVillage = stripLocationKeywords(String(patient.village || ''));
 const patientDistrict = stripLocationKeywords(String(patient.district || ''));
 const patientHeadman = stripLocationKeywords(String(patient.headman || ''));

 return activeAlerts.filter(alert => {
 const alertNorm = stripLocationKeywords(alert.affectedArea);

 if (!alertNorm) return false;

 // Check each location field independently with exact or contained match
 const matchesWard = patientWard && (patientWard === alertNorm || alertNorm === patientWard);
 const matchesVillage = patientVillage && (patientVillage.includes(alertNorm) || alertNorm.includes(patientVillage));
 const matchesDistrict = patientDistrict && (patientDistrict.includes(alertNorm) || alertNorm.includes(patientDistrict));
 const matchesHeadman = patientHeadman && (patientHeadman.includes(alertNorm) || alertNorm.includes(patientHeadman));

 return matchesWard || matchesVillage || matchesDistrict || matchesHeadman;
 });
 };

 const getEffectiveRisk = (patient) => {
 const base = parseFloat(patient.risk_score) || 0;
 const alerts = getPatientAlerts(patient);
 const boost = alerts.reduce((sum, a) => sum + a.riskBoost, 0);
 const effective = Math.min(base + boost, 100);
 // Thresholds must match the XGBoost model: High>=75, Medium>=40, Low<40
 const label = effective >= 75 ? 'High' : effective >= 40 ? 'Medium' : 'Low';
 return { score: effective, label, boosted: boost > 0, boost };
 };

 const getRiskClass = (label) => {
 switch (label?.toLowerCase()) {
 case 'high': return 'risk-high';
 case 'medium': return 'risk-medium';
 default: return 'risk-low';
 }
 };

 const formatDate = (dateStr) => {
 if (!dateStr) return 'Not Set';
 const d = new Date(dateStr);
 return (
 String(d.getDate()).padStart(2, '0') + '-' +
 String(d.getMonth() + 1).padStart(2, '0') + '-' +
 d.getFullYear()
 );
 };

 const getPickupStatus = (dateStr) => {
 if (!dateStr) return null;
 const today = new Date(); today.setHours(0, 0, 0, 0);
 const pickup = new Date(dateStr); pickup.setHours(0, 0, 0, 0);
 const diff = Math.ceil((pickup - today) / (1000 * 60 * 60 * 24));
 if (diff < 0) return 'overdue';
 if (diff <= 3) return 'soon';
 return 'normal';
 };

 const filteredPatients = patients.filter(p => {
 const effective = getEffectiveRisk(p);
 const matchesRisk = riskFilter === 'All' ||
 effective.label.toLowerCase() === riskFilter.toLowerCase();
 const s = searchQuery.toLowerCase();
 const matchesSearch =
 (p.first_name?.toLowerCase() || '').includes(s) ||
 (p.last_name?.toLowerCase() || '').includes(s) ||
 (p.patient_number?.toLowerCase() || '').includes(s) ||
 (p.phone_number?.toLowerCase() || '').includes(s);
 return matchesRisk && matchesSearch;
 });

 return (
 <div className="patients-page">

 {activeAlerts.length > 0 && (
 <div className="patients-weather-notice">
 <strong>{activeAlerts.length} weather alert(s) active.</strong>{' '}
 Affected patients show boosted risk scores below.
 </div>
 )}

 <div className="page-header">
 <div className="header-content">
 <h2 className="page-title">Patient Registry</h2>
 <p className="page-subtitle">
 Showing: {filteredPatients.length}{' '}
 {riskFilter !== 'All' ? riskFilter + ' Risk ' : ''}Patients
 </p>
 </div>
 <div className="header-actions">
 <div className="search-container">
 <Search size={16} />
 <input
 type="text"
 className="search-input"
 placeholder="Search name, ID, or phone..."
 value={searchQuery}
 onChange={e => setSearchQuery(e.target.value)}
 />
 {searchQuery && (
 <button className="clear-search" onClick={() => setSearchQuery('')}></button>
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
 <span className="icon">{analyzing ? '' : ''}</span>
 {analyzing ? 'Analyzing...' : 'Predict Risks'}
 </button>

 <button className="btn-add-patient" onClick={() => setShowModal(true)}>
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
 {searchQuery
 ? 'No results match "' + searchQuery + '".'
 : 'No patients matching "' + riskFilter + '" risk filter.'}
 </p>
 <button
 className="btn-show-all"
 onClick={() => { setRiskFilter('All'); setSearchQuery(''); }}
 >
 Clear Filters &amp; Show All
 </button>
 </div>
 ) : (
 <table className="patients-table">
 <thead>
 <tr>
 <th>ID</th>
 <th>Name</th>
 <th>Age</th>
 <th>Distance</th>
 <th>Next Pickup</th>
 <th>Predicted Risk</th>
 <th>Status</th>
 <th>Actions</th>
 </tr>
 </thead>
 <tbody>
 {filteredPatients.map(p => {
 const age = p.date_of_birth
 ? new Date().getFullYear() - new Date(p.date_of_birth).getFullYear()
 : 'N/A';
 const effective = getEffectiveRisk(p);
 const riskClass = getRiskClass(effective.label);
 const pickupStatus = getPickupStatus(p.next_pickup_date);
 const patientAlerts = getPatientAlerts(p);

 return (
 <tr
 key={p.patient_id}
 className={effective.boosted ? 'weather-affected-row' : ''}
 >
 <td>{p.patient_number}</td>
 <td className="fw-bold">
 <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
 {p.first_name} {p.last_name}
 {effective.boosted && (
 <span
 className="weather-warning-icon"
 title={
 'Weather alert: ' +
 patientAlerts.map(a => a.label).join(', ') +
 ' (+' + effective.boost + '% risk)'
 }
 >
 
 </span>
 )}
 </div>
 </td>
 <td>{age}</td>
 <td>
 {p.distance_from_clinic
 ? Math.round(Number(p.distance_from_clinic)) + ' km'
 : 'Unknown'}
 </td>
 <td>
 {p.next_pickup_date ? (
 <span className={'pickup-badge pickup-' + pickupStatus}>
 {pickupStatus === 'overdue' && ' '}
 {pickupStatus === 'soon' && ' '}
 {formatDate(p.next_pickup_date)}
 </span>
 ) : (
 <span className="pickup-badge pickup-none">Not Set</span>
 )}
 </td>
 <td>
 <div className="risk-meter-wrapper">
 <div className="risk-track">
 <div
 className={'risk-fill ' + riskClass}
 style={{ width: effective.score + '%' }}
 />
 </div>
 <span className={'risk-score-text ' + riskClass}>
 {effective.score}%
 </span>
 </div>
 {effective.boosted && (
 <div className="weather-boost-tag">
 +{effective.boost}% weather
 </div>
 )}
 </td>
 <td>
 <span className={'status-badge ' + (p.is_active ? 'active' : 'inactive')}>
 {p.is_active ? 'Active' : 'Inactive'}
 </span>
 </td>
 <td>
 <div className="action-buttons">
 <button
 className="btn-icon view"
 title="View Details"
 onClick={() => setSelectedPatient(p)}
 ><Eye size={15} /></button>
 <button
 className="btn-icon edit"
 title="Edit Patient"
 onClick={() => setEditingPatient(p)}
 ><Pencil size={15} /></button>
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
 <PatientFormModal
 onClose={() => setShowModal(false)}
 onSuccess={loadPatients}
 currentUser={currentUser}
 />
 )}

 {selectedPatient && (
 <PatientDetailsModal
 patient={selectedPatient}
 onClose={() => setSelectedPatient(null)}
 onEdit={p => { setSelectedPatient(null); setEditingPatient(p); }}
 />
 )}

 {editingPatient && (
 <PatientEditForm
 patient={editingPatient}
 onClose={() => setEditingPatient(null)}
 onSuccess={() => { setEditingPatient(null); loadPatients(); }}
 />
 )}

 </div>
 );
}

export default Patients;