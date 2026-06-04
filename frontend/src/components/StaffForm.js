import React, { useState } from 'react';
import { authAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

const FACILITIES = [
  { name: 'St Peters Checheche Clinic',   code: 'CHP-SP' },
  { name: 'Tamanda Clinic',               code: 'CHP-TM' },
  { name: 'Biriwiri Clinic',              code: 'CHP-BW' },
  { name: 'Musikavanhu Clinic',           code: 'CHP-MV' },
  { name: 'Gaza Clinic',                  code: 'CHP-GZ' },
  { name: 'Chisumbanje Clinic',           code: 'CHP-CS' },
  { name: 'Mount Selinda Hospital',       code: 'CHP-MS' },
  { name: 'Ngorima Clinic',               code: 'CHP-NG' },
  { name: 'Tanganda Clinic',              code: 'CHP-TG' },
  { name: 'Chikore Mission Hospital',     code: 'CHP-CM' },
  { name: 'Chimanimani Road Clinic',      code: 'CHP-CR' },
  { name: 'Rupangwe Clinic',              code: 'CHP-RW' },
  { name: 'Chipinge District Hospital',   code: 'CHP-DH' },
  { name: 'Mpinga Clinic',                code: 'CHP-MP' },
  { name: 'Ndowoyo Clinic',               code: 'CHP-ND' },
  { name: 'Checheche RHC',               code: 'CHP-CH' },
];

function StaffForm({ onClose, onSuccess }) {
  const { showToast } = useNotifications();
  const [loading, setLoading]     = useState(false);
  const [formError, setFormError] = useState('');
  const [facilitySearch, setFacilitySearch] = useState('');
  const [showDropdown, setShowDropdown]     = useState(false);

  const [formData, setFormData] = useState({
    full_name:     '',
    username:      '',
    email:         '',
    phone_number:  '',
    role:          'healthcare_worker',
    password:      '',
    clinic_name:   '',
    clinic_number: '',
  });

  const isNurseRole = formData.role === 'healthcare_worker';
  const isAdminRole = formData.role === 'admin';
  const needsClinic = !isAdminRole;

  const handleChange = (e) => {
    setFormError('');
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFacilitySelect = (facility) => {
    setFormData(prev => ({
      ...prev,
      clinic_name:   facility.name,
      clinic_number: facility.code,
    }));
    setFacilitySearch(facility.name);
    setShowDropdown(false);
  };

  const filteredFacilities = FACILITIES.filter(f =>
    f.name.toLowerCase().includes(facilitySearch.toLowerCase()) ||
    f.code.toLowerCase().includes(facilitySearch.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formData.full_name.trim())  { setFormError('Full name is required.'); return; }
    if (!formData.username.trim())   { setFormError('Username is required.'); return; }
    if (!formData.email.trim())      { setFormError('Email address is required.'); return; }
    if (!formData.password || formData.password.length < 6) {
      setFormError('Password must be at least 6 characters.'); return;
    }
    if (needsClinic && !formData.clinic_name.trim()) {
      setFormError('Facility name is required for this role.'); return;
    }
    if (needsClinic && !formData.clinic_number.trim()) {
      setFormError('Facility code is required for this role.'); return;
    }

    setLoading(true);
    try {
      await authAPI.register(formData);
      showToast({ type: 'success', message: formData.full_name + ' added successfully!' });
      onSuccess();
      onClose();
    } catch (err) {
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

          {formError && (
            <div style={{
              backgroundColor: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem',
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
              fontSize: '0.85rem', color: '#991b1b'
            }}>
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
                Must be unique - used for login identification
              </small>
            </div>

            <div className="form-group">
              <label>Email Address <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="email" name="email" required
                value={formData.email} onChange={handleChange}
                placeholder="e.g. tendai@clinic.com" />
              <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                Must be unique - used to log into the system
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

          {needsClinic && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{
                fontSize: '0.8rem', fontWeight: '700', color: '#6b7280',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                marginBottom: '0.75rem'
              }}>
                Facility Assignment
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label>Facility Name <span style={{ color: '#ef4444' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={facilitySearch}
                      onChange={(e) => {
                        setFacilitySearch(e.target.value);
                        setShowDropdown(true);
                        setFormData(prev => ({ ...prev, clinic_name: e.target.value, clinic_number: '' }));
                      }}
                      onFocus={() => setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                      placeholder="Search facility name..."
                      required={needsClinic}
                    />
                    {showDropdown && filteredFacilities.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: '#fff', border: '1px solid #d1d5db',
                        borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 200, maxHeight: '220px', overflowY: 'auto'
                      }}>
                        {filteredFacilities.map((f, i) => (
                          <div
                            key={i}
                            onMouseDown={() => handleFacilitySelect(f)}
                            style={{
                              padding: '0.6rem 1rem', cursor: 'pointer',
                              borderBottom: '1px solid #f3f4f6',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f0fdf4'}
                            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                          >
                            <span style={{ fontWeight: '500', fontSize: '0.875rem' }}>{f.name}</span>
                            <span style={{
                              fontFamily: 'monospace', fontSize: '0.75rem',
                              color: '#166534', background: '#f0fdf4',
                              padding: '2px 6px', borderRadius: '4px',
                              border: '1px solid #bbf7d0'
                            }}>{f.code}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                    Type to search from registered facilities
                  </small>
                </div>

                <div className="form-group">
                  <label>Facility Code <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    name="clinic_number"
                    value={formData.clinic_number}
                    onChange={handleChange}
                    placeholder="Auto-fills when facility selected"
                    style={{
                      background: formData.clinic_number ? '#f0fdf4' : '',
                      fontFamily: 'monospace'
                    }}
                  />
                  <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                    Auto-fills when facility is selected above
                  </small>
                </div>
              </div>
            </div>
          )}

          <div style={{
            marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '8px',
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
                When they log in, their <strong>Facility Name</strong>, <strong>Facility Code</strong>,
                and <strong>Nurse Number</strong> will auto-fill and lock when recording pickups or
                registering patients.
              </>
            )}
            {formData.role === 'data_entry' && (
              <>
                 A <strong>Staff ID</strong> (STF-XXX) will be auto-generated.<br />
                Their <strong>Facility Name</strong> and <strong>Facility Code</strong> will auto-fill
                when using the system.
              </>
            )}
            {isAdminRole && (
              <>
                 A <strong>Staff ID</strong> (STF-XXX) will be auto-generated.
                Administrators are not assigned to a specific facility.
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