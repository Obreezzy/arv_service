// v3 - forced update
import React, { useState, useEffect } from 'react';
import { patientsAPI, clinicsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

function PatientForm({ onClose, onSuccess, currentUser }) {
  const { showToast } = useNotifications();
  const [loading, setLoading] = useState(false);
  const [clinics, setClinics] = useState([]);
  const [clinicSearch, setClinicSearch] = useState('');
  const [showClinicDropdown, setShowClinicDropdown] = useState(false);
  const [formError, setFormError] = useState('');

  const isAdmin = currentUser?.role === 'admin';
  const isNurse = !isAdmin;

  const [formData, setFormData] = useState({
    art_number: '',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: '',
    marital_status: '',
    phone_number: '',
    alternative_phone: '',
    email: '',
    province: '',
    district: '',
    ward: '',
    village: '',
    headman: '',
    art_start_date: new Date().toISOString().split('T')[0],
    who_clinical_stage: '1',
    arv_regimen: '',
    functional_status: 'Working',
    tb_flag: false,
    pregnancy_flag: false,
    treatment_supporter: false,
    chronic_diseases: '',
    pickup_frequency: '30',
    next_pickup_date: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    clinic_name: '',
    clinic_number: '',
    nurse_number: '',
  });

  useEffect(() => {
    if (isAdmin) {
      clinicsAPI.getClinics()
        .then(res => setClinics(res.data || []))
        .catch(() => {});
    } else {
      setFormData(prev => ({
        ...prev,
        clinic_name: currentUser?.clinic_name || '',
        clinic_number: currentUser?.clinic_number || '',
        nurse_number: currentUser?.nurse_number || '',
      }));
    }
  }, [isAdmin, currentUser]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormError('');
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleClinicSelect = (clinic) => {
    setFormData(prev => ({
      ...prev,
      clinic_name: clinic.clinic_name,
      clinic_number: clinic.clinic_number,
    }));
    setClinicSearch(clinic.clinic_name);
    setShowClinicDropdown(false);
  };

  const filteredClinics = clinics.filter(c =>
    c.clinic_name.toLowerCase().includes(clinicSearch.toLowerCase()) ||
    c.clinic_number.toLowerCase().includes(clinicSearch.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!formData.art_number.trim()) { setFormError('ART Number is required.'); return; }
    if (!formData.first_name.trim()) { setFormError('First name is required.'); return; }
    if (!formData.last_name.trim())  { setFormError('Last name is required.'); return; }
    if (!formData.date_of_birth)     { setFormError('Date of birth is required.'); return; }
    if (!formData.gender)            { setFormError('Gender is required.'); return; }
    if (!formData.phone_number.trim()) { setFormError('Phone number is required.'); return; }

    setLoading(true);
    try {
      await patientsAPI.createPatient(formData);
      showToast({ type: 'success', message: 'Patient registered successfully!' });
      onSuccess();
      onClose();
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to register patient.';
      setFormError(message);
      showToast({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const Section = ({ title }) => (
    <div style={{
      fontSize: '0.75rem', fontWeight: '700', color: '#6b7280',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      margin: '1.5rem 0 0.75rem', borderBottom: '1px solid #e5e7eb',
      paddingBottom: '0.4rem'
    }}>{title}</div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '780px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h3 className="modal-title">Register New Patient</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">

          {formError && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
              padding: '0.75rem 1rem', marginBottom: '1rem',
              fontSize: '0.85rem', color: '#991b1b', display: 'flex', gap: '0.5rem'
            }}>
              <span>⚠️</span><span>{formError}</span>
            </div>
          )}

          {/* IDENTIFICATION */}
          <Section title="Patient Identification" />
          <div className="form-grid">
            <div className="form-group">
              <label>ART Number <span style={{color:'#ef4444'}}>*</span></label>
              <input name="art_number" value={formData.art_number} onChange={handleChange}
                placeholder="e.g. CHP/CHP-SP/16/575" required />
            </div>
            <div className="form-group">
              <label>Enrollment Date</label>
              <input type="date" name="enrollment_date" onChange={handleChange}
                defaultValue={new Date().toISOString().split('T')[0]} />
            </div>
          </div>

          {/* PERSONAL */}
          <Section title="Personal Information" />
          <div className="form-grid">
            <div className="form-group">
              <label>First Name <span style={{color:'#ef4444'}}>*</span></label>
              <input name="first_name" value={formData.first_name} onChange={handleChange}
                placeholder="Enter first name" required />
            </div>
            <div className="form-group">
              <label>Last Name <span style={{color:'#ef4444'}}>*</span></label>
              <input name="last_name" value={formData.last_name} onChange={handleChange}
                placeholder="Enter last name" required />
            </div>
            <div className="form-group">
              <label>Date of Birth <span style={{color:'#ef4444'}}>*</span></label>
              <input type="date" name="date_of_birth" value={formData.date_of_birth}
                onChange={handleChange} min="1947-01-01" max="2008-12-31" required />
              <small style={{color:'#6b7280',fontSize:'0.75rem'}}>Range: 1947 — 2008</small>
            </div>
            <div className="form-group">
              <label>Gender <span style={{color:'#ef4444'}}>*</span></label>
              <select name="gender" value={formData.gender} onChange={handleChange} required>
                <option value="">Select gender</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
            <div className="form-group">
              <label>Marital Status</label>
              <select name="marital_status" value={formData.marital_status} onChange={handleChange}>
                <option value="">Select marital status</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </select>
            </div>
            <div className="form-group">
              <label>Phone Number <span style={{color:'#ef4444'}}>*</span></label>
              <input name="phone_number" value={formData.phone_number} onChange={handleChange}
                placeholder="+263771234567" required />
            </div>
            <div className="form-group">
              <label>Alternative Phone</label>
              <input name="alternative_phone" value={formData.alternative_phone}
                onChange={handleChange} placeholder="+263771234567" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" name="email" value={formData.email}
                onChange={handleChange} placeholder="patient@example.com" />
            </div>
          </div>

          {/* LOCATION */}
          <Section title="Location" />
          <div className="form-grid">
            <div className="form-group">
              <label>Province</label>
              <input name="province" value={formData.province} onChange={handleChange}
                placeholder="e.g. Manicaland" />
            </div>
            <div className="form-group">
              <label>District</label>
              <input name="district" value={formData.district} onChange={handleChange}
                placeholder="e.g. Chipinge" />
            </div>
            <div className="form-group">
              <label>Ward</label>
              <input name="ward" value={formData.ward} onChange={handleChange}
                placeholder="e.g. Ward 9" />
            </div>
            <div className="form-group">
              <label>Village</label>
              <input name="village" value={formData.village} onChange={handleChange}
                placeholder="e.g. Checheche" />
            </div>
            <div className="form-group">
              <label>Headman / Sabhuku</label>
              <input name="headman" value={formData.headman} onChange={handleChange}
                placeholder="e.g. Headman Chikwanda" />
            </div>
          </div>

          {/* CLINICAL */}
          <Section title="Clinical Information" />
          <div className="form-grid">
            <div className="form-group">
              <label>ART Start Date</label>
              <input type="date" name="art_start_date" value={formData.art_start_date}
                onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>WHO Clinical Stage</label>
              <select name="who_clinical_stage" value={formData.who_clinical_stage} onChange={handleChange}>
                <option value="1">Stage 1</option>
                <option value="2">Stage 2</option>
                <option value="3">Stage 3</option>
                <option value="4">Stage 4</option>
              </select>
            </div>
            <div className="form-group">
              <label>ARV Regimen</label>
              <select name="arv_regimen" value={formData.arv_regimen} onChange={handleChange}>
                <option value="">Select regimen</option>
                <option value="TLD">TLD (Tenofovir/Lamivudine/Dolutegravir)</option>
                <option value="TDF/3TC/NVP">TDF/3TC/NVP</option>
                <option value="TDF/3TC/EFV">TDF/3TC/EFV</option>
                <option value="AZT/3TC/NVP">AZT/3TC/NVP</option>
                <option value="AZT/3TC/EFV">AZT/3TC/EFV</option>
                <option value="ABC/3TC/LPV/r">ABC/3TC/LPV/r</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>Functional Status</label>
              <select name="functional_status" value={formData.functional_status} onChange={handleChange}>
                <option value="Working">Working</option>
                <option value="Ambulatory">Ambulatory</option>
                <option value="Bedridden">Bedridden</option>
              </select>
            </div>
            <div className="form-group">
              <label>Chronic Conditions</label>
              <input name="chronic_diseases" value={formData.chronic_diseases} onChange={handleChange}
                placeholder="e.g. Diabetes, Hypertension" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '2rem', margin: '0.75rem 0', flexWrap: 'wrap' }}>
            {[
              { name: 'tb_flag', label: 'TB Co-infection' },
              { name: 'pregnancy_flag', label: 'Pregnancy' },
              { name: 'treatment_supporter', label: 'Has Treatment Supporter' },
            ].map(({ name, label }) => (
              <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" name={name} checked={formData[name]} onChange={handleChange} />
                {label}
              </label>
            ))}
          </div>

          {/* PICKUP */}
          <Section title="Medication Pickup" />
          <div className="form-grid">
            <div className="form-group">
              <label>Pickup Frequency</label>
              <select name="pickup_frequency" value={formData.pickup_frequency} onChange={handleChange}>
                <option value="30">Monthly (30 days)</option>
                <option value="60">Every 2 Months (60 days)</option>
                <option value="90">Every 3 Months (90 days)</option>
                <option value="180">Every 6 Months (180 days)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Next Pickup Date</label>
              <input type="date" name="next_pickup_date" value={formData.next_pickup_date}
                onChange={handleChange} />
            </div>
          </div>

          {/* EMERGENCY */}
          <Section title="Emergency Contact" />
          <div className="form-grid">
            <div className="form-group">
              <label>Contact Name</label>
              <input name="emergency_contact_name" value={formData.emergency_contact_name}
                onChange={handleChange} placeholder="Full name" />
            </div>
            <div className="form-group">
              <label>Contact Phone</label>
              <input name="emergency_contact_phone" value={formData.emergency_contact_phone}
                onChange={handleChange} placeholder="+263771234567" />
            </div>
          </div>

          {/* CLINIC */}
          <Section title="Clinic Assignment" />
          {isNurse ? (
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: '8px', padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap'
            }}>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Clinic</div>
                <div style={{ fontWeight: '600' }}>{currentUser?.clinic_name || '—'}</div>
              </div>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Facility Number</div>
                <div style={{ fontFamily: 'monospace' }}>{currentUser?.clinic_number || '—'}</div>
              </div>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Nurse Number</div>
                <div style={{ fontFamily: 'monospace', color: '#166534' }}>{currentUser?.nurse_number || '—'}</div>
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <div className="form-group">
                <label>Search & Assign Clinic <span style={{color:'#ef4444'}}>*</span></label>
                <div style={{ position: 'relative' }}>
                  <input type="text" value={clinicSearch}
                    onChange={(e) => {
                      setClinicSearch(e.target.value);
                      setShowClinicDropdown(true);
                      setFormData(prev => ({ ...prev, clinic_name: e.target.value }));
                    }}
                    onFocus={() => setShowClinicDropdown(true)}
                    onBlur={() => setTimeout(() => setShowClinicDropdown(false), 200)}
                    placeholder="Search by clinic name or facility code..."
                  />
                  {showClinicDropdown && filteredClinics.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0,
                      background: '#fff', border: '1px solid #d1d5db',
                      borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      zIndex: 100, maxHeight: '200px', overflowY: 'auto'
                    }}>
                      {filteredClinics.map((c, i) => (
                        <div key={i} onMouseDown={() => handleClinicSelect(c)}
                          style={{
                            padding: '0.6rem 1rem', cursor: 'pointer',
                            borderBottom: '1px solid #f3f4f6',
                            display: 'flex', justifyContent: 'space-between'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                          onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                        >
                          <span style={{ fontWeight: '500', fontSize: '0.875rem' }}>{c.clinic_name}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280' }}>{c.clinic_number}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <small style={{color:'#6b7280',fontSize:'0.75rem'}}>Type clinic name or facility code</small>
              </div>
              <div className="form-group">
                <label>Facility Number</label>
                <input name="clinic_number" value={formData.clinic_number}
                  onChange={handleChange} placeholder="Auto-fills when clinic selected" />
              </div>
            </div>
          )}

          <div className="modal-footer" style={{ marginTop: '1.5rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Registering...' : 'Register Patient'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

export default PatientForm;