import React, { useState } from 'react';
import { X, CheckCircle } from 'lucide-react';
import './ResolveModal.css';
import { defaultersAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

function ResolveModal({ defaulter, onClose, onSuccess }) {
 const { showToast } = useNotifications();
 const [loading, setLoading] = useState(false);
 const [status, setStatus] = useState('returned'); 

 const handleSubmit = async (e) => {
 e.preventDefault();
 setLoading(true);

 try {
 await defaultersAPI.resolveDefaulter(defaulter.defaulter_id, { status });
 showToast({ type: 'success', message: `Patient marked as ${status.replace('_', ' ')}!` });
 onSuccess(); 
 onClose(); 
 } catch (err) {
 console.error(err);
 showToast({ type: 'error', message: 'Failed to update status.' });
 } finally {
 setLoading(false);
 }
 };

 if (!defaulter) return null;

 return (
 <div className="modal-overlay">
 <div className="resolve-modal-content">
 <div className="modal-header">
 <h3 className="modal-title"><CheckCircle size={18} /> Resolve Defaulter Case</h3>
 <button className="close-btn" onClick={onClose}><X size={18} /></button>
 </div>

 <form onSubmit={handleSubmit} className="modal-body">
 <div className="patient-info-box">
 <p className="info-label">Patient Name:</p>
 <p className="info-value">
 {defaulter.patient_name || `${defaulter.first_name} ${defaulter.last_name}`}
 </p>
 </div>

 <div className="form-group resolve-form-group">
 <label className="status-label">New Case Status</label>
 <select 
 value={status} 
 onChange={(e) => setStatus(e.target.value)}
 className="status-select"
 >
 <option value="returned"> Returned to Care (Medication Collected)</option>
 <option value="lost_to_followup"> Lost to Follow-up (Cannot be reached)</option>
 <option value="transferred"> Transferred (Moved to another clinic)</option>
 </select>
 </div>

 {status === 'returned' && (
 <div className="tip-box">
 <strong>Tip:</strong> Don't forget to also log their new pickup in the system so the AI can track their history!
 </div>
 )}

 <div className="modal-footer resolve-footer">
 <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
 <button type="submit" className="btn-primary" disabled={loading}>
 {loading ? 'Saving...' : 'Confirm Resolution'}
 </button>
 </div>
 </form>
 </div>
 </div>
 );
}

export default ResolveModal;