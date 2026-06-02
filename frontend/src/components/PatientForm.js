// v5.1 - fixed focus loss, auto ART, auto pickup, NOK required, per-field validation, added clear ID placeholder
import React, { useState } from 'react';
import { patientsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

const FACILITIES = [
  { name: 'St Peters Checheche Clinic',  code: 'CHP-SP' },
  { name: 'Tamanda Clinic',              code: 'CHP-TM' },
  { name: 'Biriwiri Clinic',             code: 'CHP-BW' },
  { name: 'Musikavanhu Clinic',          code: 'CHP-MV' },
  { name: 'Gaza Clinic',                 code: 'CHP-GZ' },
  { name: 'Chisumbanje Clinic',          code: 'CHP-CS' },
  { name: 'Mount Selinda Hospital',      code: 'CHP-MS' },
  { name: 'Ngorima Clinic',              code: 'CHP-NG' },
  { name: 'Tanganda Clinic',             code: 'CHP-TG' },
  { name: 'Chikore Mission Hospital',    code: 'CHP-CM' },
  { name: 'Chimanimani Road Clinic',     code: 'CHP-CR' },
  { name: 'Rupangwe Clinic',             code: 'CHP-RW' },
  { name: 'Chipinge District Hospital',  code: 'CHP-DH' },
  { name: 'Mpinga Clinic',               code: 'CHP-MP' },
  { name: 'Ndowoyo Clinic',              code: 'CHP-ND' },
  { name: 'Checheche RHC',               code: 'CHP-CH' },
];

const today = new Date().toISOString().split('T')[0];
const currentYear = new Date().getFullYear().toString().slice(-2);

const generateArtNumber = (facilityCode) => {
  if (!facilityCode) return '';
  const seq = String(Math.floor(1000 + Math.random() * 9000));
  return `CHP/${facilityCode}/${currentYear}/${seq}`;
};

const addDays = (dateStr, days) => {
  if (!dateStr || !days) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + parseInt(days));
  return d.toISOString().split('T')[0];
};

const Field = ({ id, label, required, hint, error, children }) => (
  <div className="form-group">
    <label htmlFor={id}>
      {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
    </label>
    {children}
    {hint && !error && (
      <small style={{ color: '#6b7280', fontSize: '0.72rem' }}>{hint}</small>
    )}
    {error && (
      <small style={{ color: '#dc2626', fontSize: '0.72rem', marginTop: '2px', display: 'block' }}>
        System Alert: {error}
      </small>
    )}
  </div>
);

const Section = ({ title }) => (
  <div style={{
    fontSize: '0.72rem', fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '0.07em',
    margin: '1.5rem 0 0.75rem',
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '0.4rem'
  }}>{title}</div>
);

const inputStyle = (errors, id) => ({
  borderColor: errors[id] ? '#dc2626' : undefined
});

function PatientForm({ onClose, onSuccess, currentUser }) {
  const { showToast } = useNotifications();
  const [loading, setLoading]           = useState(false);
  const [clinicSearch, setClinicSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [errors, setErrors]             = useState({});

  const isAdmin = currentUser?.role === 'admin';
  const isNurse = !isAdmin;

  const nurseClinic  = currentUser?.clinic_name   || '';
  const nurseCode    = currentUser?.clinic_number || '';
  const nurseNumber  = currentUser?.nurse_number  || '';

  const [formData, setFormData] = useState({
    art_number:          isNurse && nurseCode ? generateArtNumber(nurseCode) : '',
    enrollment_date:     today,
    first_name:          '',
    last_name:           '',
    date_of_birth:       '',
    gender:              '',
    marital_status:      '',
    phone_number:        '',
    alternative_phone:   '',
    province:            '',
    district:            '',
    ward:                '',
    village:             '',
    headman:             '',
    art_start_date:      today,
    who_clinical_stage:  '2',
    arv_regimen:         '',
    chronic_score:       '0',
    tb_flag:             false,
    pregnancy_flag:      false,
    treatment_supporter: false,
    pickup_frequency:    '30',
    next_pickup_date:    addDays(today, 30),
    nok_name:            '',
    nok_relationship:    '',
    nok_phone:           '',
    clinic_name:         isNurse ? nurseClinic : '',
    clinic_number:       isNurse ? nurseCode   : '',
    nurse_number:        isNurse ? nurseNumber  : '',
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setErrors(prev => ({ ...prev, [name]: '' }));

    setFormData(prev => {
      const updated = { ...prev, [name]: type === 'checkbox' ? checked : value };

      if (name === 'enrollment_date' || name === 'pickup_frequency') {
        const base = name === 'enrollment_date' ? value : prev.enrollment_date;
        const freq = name === 'pickup_frequency' ? value  : prev.pickup_frequency;
        updated.next_pickup_date = addDays(base, freq);
      }

      return updated;
    });
  };

  const handleFacilitySelect = (facility) => {
    const artNum = generateArtNumber(facility.code);
    setFormData(prev => ({
      ...prev,
      clinic_name:   facility.name,
      clinic_number: facility.code,
      art_number:    artNum,
      next_pickup_date: addDays(prev.enrollment_date, prev.pickup_frequency),
    }));
    setClinicSearch(facility.name);
    setShowDropdown(false);
    setErrors(prev => ({ ...prev, clinic_name: '', art_number: '' }));
  };

  const filteredFacilities = FACILITIES.filter(f =>
    f.name.toLowerCase().includes(clinicSearch.toLowerCase()) ||
    f.code.toLowerCase().includes(clinicSearch.toLowerCase())
  );

  const validate = () => {
    const e = {};
    if (!formData.art_number.trim())        e.art_number         = 'ART Number is required.';
    if (!formData.first_name.trim())        e.first_name         = 'First name is required.';
    if (!formData.last_name.trim())         e.last_name          = 'Last name is required.';
    if (!formData.date_of_birth)            e.date_of_birth      = 'Date of birth is required.';
    if (!formData.gender)                   e.gender             = 'Gender is required.';
    if (!formData.marital_status)           e.marital_status     = 'Marital status is required.';
    if (!formData.phone_number.trim())      e.phone_number       = 'Phone number is required.';
    if (!formData.arv_regimen)              e.arv_regimen        = 'ARV Regimen is required.';
    if (!formData.who_clinical_stage)       e.who_clinical_stage = 'WHO Clinical Stage is required.';
    if (!formData.nok_name.trim())          e.nok_name           = 'Next of kin name is required.';
    if (!formData.nok_relationship.trim())  e.nok_relationship   = 'Relationship is required.';
    if (!formData.nok_phone.trim())         e.nok_phone          = 'Next of kin phone is required.';
    if (!formData.clinic_name.trim())       e.clinic_name        = 'Facility assignment is required.';

    const phoneReg = /^\+?[0-9]{9,15}$/;
    if (formData.phone_number && !phoneReg.test(formData.phone_number.replace(/\s/g, '')))
      e.phone_number = 'Enter a valid phone number e.g. +263771234567';
    if (formData.alternative_phone && !phoneReg.test(formData.alternative_phone.replace(/\s/g, '')))
      e.alternative_phone = 'Enter a valid phone number.';
    if (formData.nok_phone && !phoneReg.test(formData.nok_phone.replace(/\s/g, '')))
      e.nok_phone = 'Enter a valid phone number.';

    if (formData.date_of_birth) {
      const yr = new Date(formData.date_of_birth).getFullYear();
      if (yr < 1947 || yr > 2008)
        e.date_of_birth = 'Date of birth must be between 1947 and 2008.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      showToast({ type: 'error', message: 'Please fix the errors highlighted below.' });
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...formData,
        emergency_contact_name:  formData.nok_name,
        emergency_contact_phone: formData.nok_phone,
        chronic_score:           parseInt(formData.chronic_score) || 0,
      };
      await patientsAPI.createPatient(payload);
      showToast({ type: 'success', message: 'Patient registered successfully!' });
      onSuccess();
      onClose();
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to register patient.';
      showToast({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '800px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h3 className="modal-title">Register New Patient</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" noValidate>

          {isAdmin && (
            <>
              <Section title="Facility Assignment" />
              <div className="form-grid">
                <Field id="clinic_name" error={errors.clinic_name} label="Facility Name" required>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="clinic_name"
                      type="text"
                      value={clinicSearch}
                      onChange={(e) => {
                        const v = e.target.value;
                        setClinicSearch(v);
                        setShowDropdown(true);
                        setFormData(prev => ({ ...prev, clinic_name: v, clinic_number: '', art_number: '' }));
                        setErrors(prev => ({ ...prev, clinic_name: '' }));
                      }}
                      onFocus={() => setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                      placeholder="Search facility name or code..."
                      style={inputStyle(errors, 'clinic_name')}
                      autoComplete="off"
                    />
                    {showDropdown && filteredFacilities.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: '#fff', border: '1px solid #d1d5db',
                        borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        zIndex: 300, maxHeight: '220px', overflowY: 'auto'
                      }}>
                        {filteredFacilities.map((f, i) => (
                          <div key={i}
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
                              fontFamily: 'monospace', fontSize: '0.75rem', color: '#166534',
                              background: '#f0fdf4', padding: '2px 6px', borderRadius: '4px',
                              border: '1px solid #bbf7d0'
                            }}>{f.code}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
                <Field id="clinic_number" label="Facility Code">
                  <input
                    id="clinic_number"
                    type="text"
                    value={formData.clinic_number}
                    readOnly
                    placeholder="Auto-fills when facility selected"
                    style={{ background: '#f9fafb', fontFamily: 'monospace' }}
                  />
                </Field>
              </div>
            </>
          )}

          {/* ── PATIENT IDENTIFICATION ── */}
          <Section title="Patient Identification" />
          <div className="form-grid">
            <Field id="assigned_id_placeholder" label="System Patient ID">
              <input
                id="assigned_id_placeholder"
                type="text"
                value="Auto-assigned on save (e.g. P-0008)"
                readOnly
                style={{ background: '#f9fafb', color: '#6b7280', fontStyle: 'italic', border: '1px dashed #d1d5db' }}
              />
            </Field>
            
            <Field id="art_number" error={errors.art_number} label="ART Number" required>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  id="art_number"
                  name="art_number"
                  value={formData.art_number}
                  onChange={handleChange}
                  placeholder={formData.clinic_number ? '' : 'Select facility first'}
                  style={{ ...inputStyle(errors, 'art_number'), flex: 1, fontFamily: 'monospace' }}
                />
                {formData.clinic_number && (
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      art_number: generateArtNumber(formData.clinic_number)
                    }))}
                    style={{
                      padding: '0.4rem 0.75rem', fontSize: '0.75rem', whiteSpace: 'nowrap',
                      background: '#f0fdf4', border: '1px solid #bbf7d0',
                      borderRadius: '6px', cursor: 'pointer', color: '#166534', fontWeight: '600'
                    }}
                  >
                    Regenerate
                  </button>
                )}
              </div>
            </Field>
            
            <Field id="enrollment_date" error={errors.enrollment_date} label="Enrollment Date" required>
              <input
                id="enrollment_date"
                type="date"
                name="enrollment_date"
                value={formData.enrollment_date}
                onChange={handleChange}
              />
            </Field>
          </div>

          {/* ── PERSONAL INFORMATION ── */}
          <Section title="Personal Information" />
          <div className="form-grid">
            <Field id="first_name" error={errors.first_name} label="First Name" required>
              <input id="first_name" name="first_name" value={formData.first_name}
                onChange={handleChange} placeholder="Enter first name"
                style={inputStyle(errors, 'first_name')} autoComplete="off" />
            </Field>
            <Field id="last_name" error={errors.last_name} label="Last Name" required>
              <input id="last_name" name="last_name" value={formData.last_name}
                onChange={handleChange} placeholder="Enter last name"
                style={inputStyle(errors, 'last_name')} autoComplete="off" />
            </Field>
            <Field id="date_of_birth" error={errors.date_of_birth} label="Date of Birth" required hint="Range: 1947 — 2008">
              <input id="date_of_birth" type="date" name="date_of_birth"
                value={formData.date_of_birth} onChange={handleChange}
                min="1947-01-01" max="2008-12-31"
                style={inputStyle(errors, 'date_of_birth')} />
            </Field>
            <Field id="gender" error={errors.gender} label="Gender" required>
              <select id="gender" name="gender" value={formData.gender}
                onChange={handleChange} style={inputStyle(errors, 'gender')}>
                <option value="">Select gender</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
            <Field id="marital_status" error={errors.marital_status} label="Marital Status" required hint="Used in ML risk model">
              <select id="marital_status" name="marital_status"
                value={formData.marital_status} onChange={handleChange}
                style={inputStyle(errors, 'marital_status')}>
                <option value="">Select marital status</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </select>
            </Field>
            <Field id="phone_number" error={errors.phone_number} label="Phone Number" required>
              <input id="phone_number" name="phone_number" value={formData.phone_number}
                onChange={handleChange} placeholder="+263771234567"
                style={inputStyle(errors, 'phone_number')} />
            </Field>
            <Field id="alternative_phone" error={errors.alternative_phone} label="Alternative Phone">
              <input id="alternative_phone" name="alternative_phone"
                value={formData.alternative_phone} onChange={handleChange}
                placeholder="+263771234567"
                style={inputStyle(errors, 'alternative_phone')} />
            </Field>
          </div>

          {/* ── LOCATION ── */}
          <Section title="Location" />
          <div className="form-grid">
            <Field id="province" label="Province">
              <input id="province" name="province" value={formData.province}
                onChange={handleChange} placeholder="e.g. Manicaland" />
            </Field>
            <Field id="district" label="District">
              <input id="district" name="district" value={formData.district}
                onChange={handleChange} placeholder="e.g. Chipinge" />
            </Field>
            <Field id="ward" label="Ward">
              <input id="ward" name="ward" value={formData.ward}
                onChange={handleChange} placeholder="e.g. Ward 9" />
            </Field>
            <Field id="village" label="Village">
              <input id="village" name="village" value={formData.village}
                onChange={handleChange} placeholder="e.g. Checheche" />
            </Field>
            <Field id="headman" label="Headman / Sabhuku">
              <input id="headman" name="headman" value={formData.headman}
                onChange={handleChange} placeholder="e.g. Headman Chikwanda" />
            </Field>
          </div>

          {/* ── CLINICAL INFORMATION ── */}
          <Section title="Clinical Information" />
          <div className="form-grid">
            <Field id="art_start_date" label="ART Start Date">
              <input id="art_start_date" type="date" name="art_start_date"
                value={formData.art_start_date} onChange={handleChange} />
            </Field>
            <Field id="who_clinical_stage" error={errors.who_clinical_stage} label="WHO Clinical Stage" required>
              <select id="who_clinical_stage" name="who_clinical_stage"
                value={formData.who_clinical_stage} onChange={handleChange}
                style={inputStyle(errors, 'who_clinical_stage')}>
                <option value="1">Stage 1 — Asymptomatic</option>
                <option value="2">Stage 2 — Mild Symptoms</option>
                <option value="3">Stage 3 — Advanced</option>
                <option value="4">Stage 4 — Severe</option>
              </select>
            </Field>
            <Field id="arv_regimen" error={errors.arv_regimen} label="ARV Regimen" required>
              <select id="arv_regimen" name="arv_regimen" value={formData.arv_regimen}
                onChange={handleChange} style={inputStyle(errors, 'arv_regimen')}>
                <option value="">Select regimen</option>
                <option value="TLD">TLD (Tenofovir/Lamivudine/Dolutegravir)</option>
                <option value="TDF/3TC/NVP">TDF/3TC/NVP</option>
                <option value="TDF/3TC/EFV">TDF/3TC/EFV</option>
                <option value="AZT/3TC/NVP">AZT/3TC/NVP</option>
                <option value="AZT/3TC/EFV">AZT/3TC/EFV</option>
                <option value="ABC/3TC/LPV/r">ABC/3TC/LPV/r</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field id="chronic_score" label="Chronic Condition Score"
              hint="Used directly in ML risk model">
              <select id="chronic_score" name="chronic_score"
                value={formData.chronic_score} onChange={handleChange}>
                <option value="0">0 — None</option>
                <option value="1">1 — Mild (e.g. Hypertension)</option>
                <option value="2">2 — Moderate (e.g. Diabetes)</option>
                <option value="3">3 — Severe (e.g. Renal Disease)</option>
                <option value="4">4 — Multiple conditions</option>
                <option value="5">5 — Critical comorbidities</option>
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', gap: '2rem', margin: '0.75rem 0', flexWrap: 'wrap' }}>
            {[
              { name: 'tb_flag',             label: 'TB Co-infection' },
              { name: 'pregnancy_flag',      label: 'Pregnancy' },
              { name: 'treatment_supporter', label: 'Has Treatment Supporter' },
            ].map(({ name, label }) => (
              <label key={name} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                cursor: 'pointer', fontSize: '0.9rem'
              }}>
                <input type="checkbox" name={name}
                  checked={formData[name]} onChange={handleChange} />
                {label}
              </label>
            ))}
          </div>

          {/* ── MEDICATION PICKUP ── */}
          <Section title="Medication Pickup" />
          <div className="form-grid">
            <Field id="pickup_frequency" label="Pickup Frequency">
              <select id="pickup_frequency" name="pickup_frequency"
                value={formData.pickup_frequency} onChange={handleChange}>
                <option value="30">Monthly (30 days)</option>
                <option value="60">Every 2 Months (60 days)</option>
                <option value="90">Every 3 Months (90 days)</option>
                <option value="180">Every 6 Months (180 days)</option>
              </select>
            </Field>
            <Field id="next_pickup_date" label="Next Pickup Date"
              hint={`Auto-calculated: Enrollment date + ${formData.pickup_frequency} days`}>
              <input
                id="next_pickup_date"
                type="date"
                value={formData.next_pickup_date}
                readOnly
                style={{ background: '#f9fafb', color: '#374151', cursor: 'default' }}
              />
            </Field>
          </div>

          {/* ── NEXT OF KIN ── */}
          <Section title="Next of Kin" />
          <div className="form-grid">
            <Field id="nok_name" error={errors.nok_name} label="Full Name" required>
              <input id="nok_name" name="nok_name" value={formData.nok_name}
                onChange={handleChange} placeholder="Full name of next of kin"
                style={inputStyle(errors, 'nok_name')} autoComplete="off" />
            </Field>
            <Field id="nok_relationship" error={errors.nok_relationship} label="Relationship" required>
              <select id="nok_relationship" name="nok_relationship"
                value={formData.nok_relationship} onChange={handleChange}
                style={inputStyle(errors, 'nok_relationship')}>
                <option value="">Select relationship</option>
                <option value="Spouse">Spouse</option>
                <option value="Parent">Parent</option>
                <option value="Child">Child</option>
                <option value="Sibling">Sibling</option>
                <option value="Relative">Other Relative</option>
                <option value="Friend">Friend</option>
                <option value="Guardian">Guardian</option>
              </select>
            </Field>
            <Field id="nok_phone" error={errors.nok_phone} label="Phone Number" required>
              <input id="nok_phone" name="nok_phone" value={formData.nok_phone}
                onChange={handleChange} placeholder="+263771234567"
                style={inputStyle(errors, 'nok_phone')} />
            </Field>
          </div>

          {isNurse && (
            <>
              <Section title="Facility Assignment" />
              <div style={{
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: '8px', padding: '1rem',
                display: 'flex', gap: '1rem', flexWrap: 'wrap'
              }}>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '0.25rem' }}>Facility</div>
                  <div style={{ fontWeight: '600' }}>{nurseClinic || '—'}</div>
                </div>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '0.25rem' }}>Facility Code</div>
                  <div style={{ fontFamily: 'monospace' }}>{nurseCode || '—'}</div>
                </div>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '0.25rem' }}>Nurse Number</div>
                  <div style={{ fontFamily: 'monospace', color: '#166534' }}>{nurseNumber || '—'}</div>
                </div>
              </div>
            </>
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