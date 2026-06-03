import React, { useState, useEffect } from 'react';
import { X, Pill, Building2, Calendar } from 'lucide-react';
import './PickupForm.css';
import { pickupsAPI, patientsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

function PickupForm({ isOpen, onClose, onSuccess, preselectedPatient = null, currentUser = null }) {
 const { showToast, addNotification } = useNotifications();

 const [step, setStep] = useState('search');
 const [selectedPatient, setSelectedPatient] = useState(null);
 const [patients, setPatients] = useState([]);
 const [searchQuery, setSearchQuery] = useState('');
 const [loading, setLoading] = useState(false);

 const isNurse = currentUser?.role === 'healthcare_worker';

 const getInitialFormData = () => ({
 pickup_date: new Date().toISOString().split('T')[0],
 next_pickup_date: '',
 quantity_dispensed: '',
 clinic_number: isNurse ? (currentUser?.clinic_number || '') : '',
 nurse_number: isNurse ? (currentUser?.nurse_number || '') : '',
 dispensing_clinic: isNurse ? (currentUser?.clinic_name || '') : '',
 notes: ''
 });

 const [formData, setFormData] = useState(getInitialFormData);

 useEffect(() => {
 if (isNurse) {
 setFormData(prev => ({
 ...prev,
 clinic_number: currentUser?.clinic_number || '',
 nurse_number: currentUser?.nurse_number || '',
 dispensing_clinic: currentUser?.clinic_name || ''
 }));
 }
 }, [currentUser]);

 useEffect(() => {
 if (isOpen) {
 loadPatients();
 if (preselectedPatient) {
 selectPatient(preselectedPatient);
 } else {
 resetForm();
 }
 }
 }, [isOpen, preselectedPatient]);

 const resetForm = () => {
 setStep('search');
 setSelectedPatient(null);
 setSearchQuery('');
 setFormData(getInitialFormData());
 };

 const loadPatients = async () => {
 try {
 const res = await patientsAPI.getAllPatients();
 const activeList = (res.data || res.patients || []).filter(p => p.is_active !== false);
 setPatients(activeList);
 } catch (err) {
 console.error('Error loading patients', err);
 }
 };

 const filteredPatients = patients.filter(p => {
 const term = searchQuery.toLowerCase();
 const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
 return fullName.includes(term) || p.patient_number.toLowerCase().includes(term);
 });

 const selectPatient = (patient) => {
 setSelectedPatient(patient);
 setStep('details');
 const frequency = parseInt(patient.pickup_frequency || 30);
 const next = new Date();
 next.setDate(next.getDate() + frequency);
 setFormData(prev => ({ ...prev, next_pickup_date: next.toISOString().split('T')[0] }));
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (!selectedPatient) return;

 if (!formData.clinic_number.trim()) {
 showToast({ type: 'error', message: 'Clinic number is required' });
 return;
 }
 if (!formData.nurse_number.trim()) {
 showToast({ type: 'error', message: 'Nurse number is required' });
 return;
 }

 setLoading(true);
 try {
 await pickupsAPI.recordPickup({
 patient_id: selectedPatient.patient_id,
 pickup_date: formData.pickup_date,
 next_pickup_date: formData.next_pickup_date,
 quantity_dispensed: formData.quantity_dispensed || 30,
 clinic_number: formData.clinic_number,
 nurse_number: formData.nurse_number,
 dispensing_clinic: formData.dispensing_clinic,
 notes: formData.notes
 });

 const pName = `${selectedPatient.first_name} ${selectedPatient.last_name}`;
 showToast({ type: 'success', message: 'Pickup recorded successfully!' });
 addNotification({
 type: 'pickup',
 title: 'Medication Pickup',
 message: `${pName} collected meds. Next: ${formData.next_pickup_date}`
 });

 if (onSuccess) onSuccess();
 onClose();
 } catch (err) {
 console.error(err);
 showToast({ type: 'error', message: 'Failed to record pickup.' });
 } finally {
 setLoading(false);
 }
 };

 if (!isOpen) return null;

 const lockedStyle = {
 backgroundColor: '#f0fdf4',
 color: '#166534',
 fontWeight: '600',
 border: '2px solid #bbf7d0',
 cursor: 'not-allowed'
 };

 return (
 <div className="form-overlay" onClick={onClose}>
 <div className="form-modal pickup-modal" onClick={e => e.stopPropagation()}>

 <div className="form-header">
 <h2><Pill size={20} /> Record Pickup</h2>
 <button className="close-button" onClick={onClose}><X size={18} /></button>
 </div>

 <div className="modal-body" style={{ padding: '1.5rem' }}>

 {/* STEP 1: Search Patient */}
 {step === 'search' && (
 <div className="search-section">
 <input
 type="text"
 placeholder=" Type patient name or ID..."
 value={searchQuery}
 onChange={e => setSearchQuery(e.target.value)}
 className="search-input"
 autoFocus
 />
 <div className="search-results-list">
 {searchQuery && filteredPatients.length === 0 && (
 <p className="no-results">No patients found.</p>
 )}
 {filteredPatients.slice(0, 6).map(p => (
 <div key={p.patient_id} className="patient-search-item" onClick={() => selectPatient(p)}>
 <div className="p-avatar">{p.first_name[0]}{p.last_name[0]}</div>
 <div className="p-details">
 <strong>{p.first_name} {p.last_name}</strong>
 <span>{p.patient_number}</span>
 </div>
 <button className="btn-select">Select</button>
 </div>
 ))}
 {!searchQuery && (
 <div className="search-empty-state">
 <p>Start typing to find a patient...</p>
 </div>
 )}
 </div>
 </div>
 )}

 {/* STEP 2: Pickup Details */}
 {step === 'details' && selectedPatient && (
 <form onSubmit={handleSubmit} className="pickup-details-form">

 {/* Patient Summary */}
 <div className="selected-patient-summary">
 <div className="p-info">
 <strong>{selectedPatient.first_name} {selectedPatient.last_name}</strong>
 <small>{selectedPatient.patient_number}</small>
 </div>
 {!preselectedPatient && (
 <button type="button" className="btn-change-patient" onClick={() => setStep('search')}>
 Change
 </button>
 )}
 </div>

 {/* Nurse identity banner */}
 {isNurse && (
 <div style={{
 background: '#f0fdf4', border: '1px solid #bbf7d0',
 borderRadius: '8px', padding: '0.6rem 1rem',
 marginBottom: '1rem', fontSize: '0.82rem', color: '#166534'
 }}>
 Logged in as <strong>{currentUser.full_name}</strong> —
 clinic details and nurse number auto-filled from your account.
 </div>
 )}

 {/* Dispensing Details */}
 <div className="pickup-section-title"><Building2 size={15} /> Dispensing Details</div>
 <div className="form-row">

 {/* Clinic Number */}
 <div className="form-group">
 <label>Clinic Number <span style={{ color: '#ef4444' }}>*</span></label>
 {isNurse ? (
 <>
 <input type="text" value={formData.clinic_number} readOnly style={lockedStyle} />
 <small style={{ color: '#166534' }}>Auto-filled from your account</small>
 </>
 ) : (
 <>
 <input type="text" value={formData.clinic_number}
 onChange={e => setFormData({ ...formData, clinic_number: e.target.value })}
 placeholder="e.g. CLN-001" required />
 <small>Patient can use this at any clinic</small>
 </>
 )}
 </div>

 {/* Nurse Number */}
 <div className="form-group">
 <label>Nurse Number <span style={{ color: '#ef4444' }}>*</span></label>
 {isNurse ? (
 <>
 <input type="text" value={formData.nurse_number} readOnly style={lockedStyle} />
 <small style={{ color: '#166534' }}>Auto-filled from your account</small>
 </>
 ) : (
 <>
 <input type="text" value={formData.nurse_number}
 onChange={e => setFormData({ ...formData, nurse_number: e.target.value })}
 placeholder="e.g. NRS-045" required />
 <small>Enter the dispensing nurse's number</small>
 </>
 )}
 </div>
 </div>

 {/* Dispensing Clinic Name */}
 <div className="form-group">
 <label>Dispensing Clinic Name {!isNurse && '(Optional)'}</label>
 {isNurse ? (
 <>
 <input type="text" value={formData.dispensing_clinic} readOnly style={lockedStyle} />
 <small style={{ color: '#166534' }}>Auto-filled from your account</small>
 </>
 ) : (
 <>
 <input type="text" value={formData.dispensing_clinic}
 onChange={e => setFormData({ ...formData, dispensing_clinic: e.target.value })}
 placeholder="e.g. Sakubva Clinic, Mutare" />
 <small>Leave blank if picking up at their registered clinic</small>
 </>
 )}
 </div>

 {/* Pickup Schedule */}
 <div className="pickup-section-title" style={{ marginTop: '1rem' }}><Calendar size={15} /> Pickup Schedule</div>
 <div className="form-row">
 <div className="form-group">
 <label>Pickup Date</label>
 <input type="date" value={formData.pickup_date}
 onChange={e => setFormData({ ...formData, pickup_date: e.target.value })}
 required />
 </div>
 <div className="form-group">
 <label>Next Appointment</label>
 <input type="date" value={formData.next_pickup_date}
 onChange={e => setFormData({ ...formData, next_pickup_date: e.target.value })}
 required />
 </div>
 </div>

 <div className="form-group">
 <label>Notes (Optional)</label>
 <textarea rows="2" value={formData.notes}
 onChange={e => setFormData({ ...formData, notes: e.target.value })}
 placeholder="Condition notes, adherence issues, etc."
 style={{ width: '100%' }}
 />
 </div>

 <div className="form-actions">
 <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
 <button type="submit" className="submit-button" disabled={loading}>
 {loading ? 'Recording...' : ' Confirm Pickup'}
 </button>
 </div>
 </form>
 )}
 </div>
 </div>
 </div>
 );
}

export default PickupForm;