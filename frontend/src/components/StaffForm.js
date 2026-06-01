import React, { useState } from 'react';
import { authAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

function StaffForm({ onClose, onSuccess }) {
  const { showToast } = useNotifications();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({
    full_name:     '',
    username:      '',
    email:         '',
    phone_number:  '',
    role:          'healthcare_worker',
    password:      '',
    clinic_name:   '',
    clinic_number: ''
  });

  const isNurseRole = formData.role === 'healthcare_worker';
  const isAdminRole = formData.role === 'admin';
  const needsClinic = !isAdminRole;

  const handleChange = (e) => {
    setFormError('');
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    // ── Frontend validation ──
    if (!formData.full_name.trim()) {
      setFormError('Full name is required.');
      return;
    }
    if (!formData.username.trim()) {
      setFormError('Username is required.');
      return;
    }
    if (!formData.email.trim()) {
      setFormError('Email address is required.');
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (needsClinic && !formData.clinic_number.trim()) {
      setFormError('Clinic Number is required for this role.');
      return;
    }
    if (needsClinic && !formData.clinic_name.trim()) {
      setFormError('Clinic Name is required for this role.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.register(formData);
      showToast({ type: 'success', message: formData.full_name + ' added successfully!' });
      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      // ── Show the exact message returned by the backend ──
      const message = err.response?.data?.message || 'Failed to create account. Please try again.';
      setFormError(message);
      showToast({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content staff-modal">
        <div className="modal-header">
          <h3 className="modal-title">Add New Staff Member</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">

          {/* ── Error banner ── */}
          {formError && (
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              fontSize: '0.85rem',
              color: '#991b1b'
            }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
              <span>{formError}</span>
            </div>
          )}

          <div className="form-grid">

            <div className="form-group">
              <label>Full Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="text" name="full_name" required
                value={formData.full_name} onChange={handleChange}
                placeholder="e.g. Tendai Moyo" />
            </div>

            <div className="form-group">
              <label>Username <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="text" name="username" required
                value={formData.username} onChange={handleChange}
                placeholder="e.g. tendai.moyo" />
              <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                Must be unique — used for login identification
              </small>
            </div>

            <div className="form-group">
              <label>Email Address <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="email" name="email" required
                value={formData.email} onChange={handleChange}
                placeholder="e.g. tendai@clinic.com" />
              <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                Must be unique — used to log into the system
              </small>
            </div>

            <div className="form-group">
              <label>Phone Number</label>
              <input type="text" name="phone_number"
                value={formData.phone_number} onChange={handleChange}
                placeholder="e.g. 0771234567" />
            </div>

            <div className="form-group">
              <label>System Role <span style={{ color: '#ef4444' }}>*</span></label>
              <select name="role" required value={formData.role} onChange={handleChange}>
                <option value="healthcare_worker">Healthcare Worker (Nurse)</option>
                <option value="data_entry">Data Entry</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            <div className="form-group">
              <label>Temporary Password <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="password" name="password" required minLength="6"
                value={formData.password} onChange={handleChange}
                placeholder="Min. 6 characters" />
              <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                Staff member should change this after first login
              </small>
            </div>

          </div>

          {/* ── Clinic Assignment ── */}
          {needsClinic && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{
                fontSize: '0.8rem', fontWeight: '700', color: '#6b7280',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                marginBottom: '0.75rem'
              }}>
                 Clinic Assignment
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Clinic Number <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    name="clinic_number"
                    value={formData.clinic_number}
                    onChange={handleChange}
                    placeholder="e.g. CLN-001"
                    required={needsClinic}
                  />
                  <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                    Auto-fills when they record pickups or register patients
                  </small>
                </div>
                <div className="form-group">
                  <label>Clinic Name <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    name="clinic_name"
                    value={formData.clinic_name}
                    onChange={handleChange}
                    placeholder="e.g. Sakubva Clinic, Mutare"
                    required={needsClinic}
                  />
                  <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                    Full name of the clinic they are assigned to
                  </small>
                </div>
              </div>
            </div>
          )}

          {/* ── Auto-generation notice ── */}
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            backgroundColor: isNurseRole ? '#f0fdf4' : '#f8fafc',
            border: '1px solid ' + (isNurseRole ? '#bbf7d0' : '#e2e8f0'),
            fontSize: '0.82rem',
            color: isNurseRole ? '#166534' : '#64748b',
            lineHeight: '1.6'
          }}>
            {isNurseRole && (
              <>
                 A <strong>Staff ID</strong> (STF-XXX) and <strong>Nurse Number</strong> (NRS-XXX)
                will be auto-generated.<br />
                When they log in, their <strong>Clinic Number</strong>, <strong>Clinic Name</strong>,
                and <strong>Nurse Number</strong> will auto-fill and lock when recording pickups or
                registering patients.
              </>
            )}
            {formData.role === 'data_entry' && (
              <>
                 A <strong>Staff ID</strong> (STF-XXX) will be auto-generated.<br />
                Their <strong>Clinic Number</strong> and <strong>Clinic Name</strong> will auto-fill
                when using the system. No nurse number is assigned to data entry staff.
              </>
            )}
            {isAdminRole && (
              <>
                 A <strong>Staff ID</strong> (STF-XXX) will be auto-generated for this
                administrator. Administrators are not assigned to a specific clinic.
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StaffForm;