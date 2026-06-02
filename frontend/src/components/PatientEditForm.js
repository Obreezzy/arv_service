import React, { useState } from 'react';
import { User, MapPin, Heart, Phone, X, Save } from 'lucide-react';
import './PatientForm.css';
import { patientsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

function PatientEditForm({ patient, onClose, onSuccess }) {
 const { showToast, addNotification } = useNotifications();

 const [formData, setFormData] = useState({
   patient_number: patient.patient_number || '',
   first_name: patient.first_name || '',
   last_name: patient.last_name || '',
   date_of_birth: patient.date_of_birth ? patient.date_of_birth.split('T')[0] : '',
   gender: patient.gender || '',
   enrollment_date: patient.enrollment_date ? patient.enrollment_date.split('T')[0] : '',
   phone_number: patient.phone_number || '',
   alternative_phone: patient.alternative_phone || '',
   province: patient.province || '',
   district: patient.district || '',
   ward: patient.ward || '',
   village: patient.village || '',
   headman: patient.headman || '',
   arv_regimen: patient.arv_regimen || '',
   emergency_contact_name: patient.emergency_contact_name || '',
   emergency_contact_phone: patient.emergency_contact_phone || '',
   next_pickup_date: patient.next_pickup_date ? patient.next_pickup_date.split('T')[0] : '',
   pickup_frequency: String(patient.pickup_frequency || '30'),
   marital_status: patient.marital_status || '',
   treatment_supporter: patient.treatment_supporter === true || patient.treatment_supporter === 'true',
   who_clinical_stage: String(patient.who_clinical_stage || '2'),
   art_start_date: patient.art_start_date ? patient.art_start_date.split('T')[0] : '',
   chronic_score: String(patient.chronic_score || '0'),
   tb_flag: patient.tb_flag === true || patient.tb_flag === 'true',
   pregnancy_flag: patient.pregnancy_flag === true || patient.pregnancy_flag === 'true'
 });

 const [loading, setLoading] = useState(false);
 const [error, setError] = useState(null);
 const [success, setSuccess] = useState(false);

 const handleChange = (e) => {
   const { name, value, type, checked } = e.target;

   if (type === 'checkbox') {
     setFormData(prev => ({ ...prev, [name]: checked }));
     return;
   }

   const lettersOnly = /^[a-zA-Z\s\-'.]*$/;
   const wholeNumberOnly = /^\d*$/;
   const phoneChars = /^[\+\d\s\-\(\)]*$/;

   const letterFields = ['first_name', 'last_name', 'province', 'district', 'village', 'headman', 'emergency_contact_name'];
   const wholeNumFields = ['ward'];
   const phoneFields = ['phone_number', 'alternative_phone', 'emergency_contact_phone'];

   if (letterFields.includes(name) && !lettersOnly.test(value)) return;
   if (wholeNumFields.includes(name) && !wholeNumberOnly.test(value)) return;
   if (phoneFields.includes(name) && !phoneChars.test(value)) return;

   if (name === 'date_of_birth' && value) {
     const year = new Date(value).getFullYear();
     if (year < 1946 || year > 2018) return;
   }

   setFormData({ ...formData, [name]: value });
 };

 const handleDobBlur = (e) => {
   const value = e.target.value;
   if (!value) return;
   const year = parseInt(value.split('-')[0], 10);
   if (year < 1946 || year > 2018) {
     setFormData(prev => ({ ...prev, date_of_birth: '' }));
     setError('Date of birth must be between 1946 and 2018');
   }
 };

 const validateForm = () => {
   const fail = (msg) => { setError(msg); return msg; };
   const lettersOnly = /^[a-zA-Z\s\-'.]+$/;
   const wholeNumberOnly = /^\d+$/;
   const phoneRegex = /^[\+]?[0-9\s\-\(\)]+$/;

   if (!formData.first_name || !formData.last_name) return fail('First name and last name are required');
   if (!lettersOnly.test(formData.first_name)) return fail('First name must contain letters only');
   if (!lettersOnly.test(formData.last_name)) return fail('Last name must contain letters only');
   if (!formData.date_of_birth) return fail('Date of birth is required');
   if (!formData.gender) return fail('Gender is required');
   if (!formData.phone_number) return fail('Phone number is required');
   if (!phoneRegex.test(formData.phone_number)) return fail('Phone number format is invalid');

   if (formData.alternative_phone && !phoneRegex.test(formData.alternative_phone))
     return fail('Alternative phone format is invalid');
   if (formData.ward && !wholeNumberOnly.test(formData.ward))
     return fail('Ward must be a whole number');
   if (formData.province && !lettersOnly.test(formData.province))
     return fail('Province must contain letters only');
   if (formData.district && !lettersOnly.test(formData.district))
     return fail('District must contain letters only');
   if (formData.village && !lettersOnly.test(formData.village))
     return fail('Village must contain letters only');
   if (formData.headman && !lettersOnly.test(formData.headman))
     return fail('Headman name must contain letters only');
   if (formData.emergency_contact_name && !lettersOnly.test(formData.emergency_contact_name))
     return fail('Emergency contact name must contain letters only');
   if (formData.emergency_contact_phone && !phoneRegex.test(formData.emergency_contact_phone))
     return fail('Emergency contact phone format is invalid');

   const dob = new Date(formData.date_of_birth);
   const today = new Date();
   if (dob >= today) return fail('Date of birth must be in the past');
   if (dob < new Date('1946-01-01')) return fail('Date of birth cannot be before 1946');

   setError(null);
   return null;
 };

 const handleSubmit = async (e) => {
   e.preventDefault();
   const validationError = validateForm();
   if (validationError) {
     showToast({ type: 'error', message: validationError, duration: 4000 });
     return;
   }

   setLoading(true);
   setError(null);

   try {
     const payload = {
       ...formData,
       marital_status: formData.marital_status,
       treatment_supporter: formData.treatment_supporter,
       who_clinical_stage: parseInt(formData.who_clinical_stage) || 2,
       art_start_date: formData.art_start_date || null,
       next_pickup_date: formData.next_pickup_date || patient.next_pickup_date || null,
       pickup_frequency: parseInt(formData.pickup_frequency) || 30,
       chronic_score: parseInt(formData.chronic_score) || 0,
       tb_flag: formData.tb_flag,
       pregnancy_flag: formData.pregnancy_flag
     };

     const patientId = patient.patient_id || patient.id;
     const response = await patientsAPI.updatePatient(patientId, payload);

     setSuccess(true);
     const patientName = `${formData.first_name} ${formData.last_name}`;

     showToast({ type: 'success', message: `${patientName}'s profile has been securely updated`, duration: 5000 });
     addNotification({
       type: 'patient', title: 'Patient Profile Updated',
       message: `${patientName} (${formData.patient_number}) record synced`,
       showToast: false
     });

     setTimeout(() => {
       if (onSuccess) onSuccess(response);
       if (onClose) onClose();
     }, 2000);

   } catch (err) {
     const errorMessage = err.response?.data?.message || err.response?.data?.error || 'Failed to update patient profile.';
     setError(errorMessage);
     setLoading(false);
     showToast({ type: 'error', message: errorMessage, duration: 5000 });
   }
 };

 if (success) {
   return (
     <div className="form-overlay">
       <div className="form-modal success-modal">
         <h2>Update Complete</h2>
         <p>{formData.first_name} {formData.last_name}'s record parameters are updated.</p>
       </div>
     </div>
   );
 }

 return (
   <div className="form-overlay" onClick={onClose}>
     <div className="form-modal" onClick={e => e.stopPropagation()}>
       <div className="form-header">
         <h2>Edit Patient Information</h2>
         <button className="close-button" onClick={onClose}><X size={18} /></button>
       </div>

       {error && (
         <div className="form-error"><span>System Refusal:</span> {error}</div>
       )}

       <form onSubmit={handleSubmit} className="patient-form">

         <div className="form-section">
           <h3 className="section-title"><User size={16} /> Patient Identification</h3>
           <div className="form-row">
             <div className="form-group">
               <label>Patient Number</label>
               <input type="text" name="patient_number" value={formData.patient_number}
                 readOnly style={{ backgroundColor: '#f3f4f6' }} />
               <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>Patient number cannot be changed</small>
             </div>
             <div className="form-group">
               <label>Enrollment Date</label>
               <input type="date" name="enrollment_date" value={formData.enrollment_date}
                 readOnly style={{ backgroundColor: '#f3f4f6' }} />
               <small style={{ color: '#6b7280', fontSize: '0.75rem' }}>Enrollment date cannot be changed</small>
             </div>
           </div>
         </div>

         <div className="form-section">
           <h3 className="section-title"><User size={16} /> Personal Information</h3>
           <div className="form-row">
             <div className="form-group">
               <label>First Name <span className="required">*</span></label>
               <input type="text" name="first_name" value={formData.first_name}
                 onChange={handleChange} placeholder="Enter first name" required />
             </div>
             <div className="form-group">
               <label>Last Name <span className="required">*</span></label>
               <input type="text" name="last_name" value={formData.last_name}
                 onChange={handleChange} placeholder="Enter last name" required />
             </div>
           </div>

           <div className="form-row">
             <div className="form-group">
               <label>Date of Birth <span className="required">*</span></label>
               <input type="date" name="date_of_birth" value={formData.date_of_birth}
                 onChange={handleChange} onBlur={handleDobBlur}
                 min="1946-01-01" max="2018-12-31" required />
             </div>
             <div className="form-group">
               <label>Gender <span className="required">*</span></label>
               <select name="gender" value={formData.gender} onChange={handleChange} required>
                 <option value="">Select gender</option>
                 <option value="M">Male</option>
                 <option value="F">Female</option>
               </select>
             </div>
           </div>

           <div className="form-row">
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
               <label>ART Start Date</label>
               <input type="date" name="art_start_date" value={formData.art_start_date}
                 onChange={handleChange} />
             </div>
           </div>

           <div className="form-row">
             <div className="form-group">
               <label>Phone Number <span className="required">*</span></label>
               <input type="tel" name="phone_number" value={formData.phone_number}
                 onChange={handleChange} placeholder="+263771234567" required />
             </div>
             <div className="form-group">
               <label>Alternative Phone</label>
               <input type="tel" name="alternative_phone" value={formData.alternative_phone}
                 onChange={handleChange} placeholder="+263712345678" />
             </div>
           </div>
         </div>

         <div className="form-section">
           <h3 className="section-title"><MapPin size={16} /> Location Information</h3>
           <div className="form-row">
             <div className="form-group">
               <label>Province</label>
               <input type="text" name="province" value={formData.province}
                 onChange={handleChange} placeholder="e.g. Manicaland" />
             </div>
             <div className="form-group">
               <label>District</label>
               <input type="text" name="district" value={formData.district}
                 onChange={handleChange} placeholder="e.g. Chipinge" />
             </div>
           </div>
           <div className="form-row">
             <div className="form-group">
               <label>Ward</label>
               <input type="text" name="ward" value={formData.ward}
                 onChange={handleChange} placeholder="e.g. Ward 9" />
             </div>
             <div className="form-group">
               <label>Village</label>
               <input type="text" name="village" value={formData.village}
                 onChange={handleChange} placeholder="e.g. Checheche" />
             </div>
           </div>
           <div className="form-group">
             <label>Headman / Sabhuku</label>
             <input type="text" name="headman" value={formData.headman}
               onChange={handleChange} placeholder="e.g. Headman Chikwanda" />
           </div>
         </div>

         <div className="form-section">
           <h3 className="section-title"><Heart size={16} /> Medical Parameters</h3>

           <div className="form-row">
             <div className="form-group">
               <label>ARV Regimen</label>
               <select name="arv_regimen" value={formData.arv_regimen} onChange={handleChange}>
                 <option value="">Select ARV regimen</option>
                 <option value="TLD">TLD (Tenofovir/Lamivudine/Dolutegravir)</option>
                 <option value="TDF/3TC/EFV">TDF/3TC/EFV</option>
                 <option value="TDF/3TC/NVP">TDF/3TC/NVP</option>
                 <option value="AZT/3TC/NVP">AZT/3TC/NVP</option>
                 <option value="AZT/3TC/EFV">AZT/3TC/EFV</option>
                 <option value="ABC/3TC/LPV/r">ABC/3TC/LPV/r</option>
                 <option value="Other">Other</option>
               </select>
             </div>

             <div className="form-group">
               <label>WHO Clinical Stage</label>
               <select name="who_clinical_stage" value={formData.who_clinical_stage} onChange={handleChange}>
                 <option value="1">Stage 1 — Asymptomatic</option>
                 <option value="2">Stage 2 — Mild Symptoms</option>
                 <option value="3">Stage 3 — Advanced</option>
                 <option value="4">Stage 4 — Severe</option>
               </select>
             </div>
           </div>

           <div className="form-row">
             <div className="form-group">
               <label>Chronic Condition Score</label>
               <select name="chronic_score" value={formData.chronic_score} onChange={handleChange}>
                 <option value="0">0 — None</option>
                 <option value="1">1 — Mild</option>
                 <option value="2">2 — Moderate</option>
                 <option value="3">3 — Severe</option>
                 <option value="4">4 — Multiple conditions</option>
                 <option value="5">5 — Critical comorbidities</option>
               </select>
             </div>
           </div>

           <div style={{ display: 'flex', gap: '2rem', margin: '0.75rem 0', flexWrap: 'wrap' }}>
             <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input type="checkbox" name="tb_flag" checked={formData.tb_flag} onChange={handleChange} />
               <span>TB Co-infection</span>
             </label>
             {formData.gender === 'F' && (
               <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                 <input type="checkbox" name="pregnancy_flag" checked={formData.pregnancy_flag} onChange={handleChange} />
                 <span>Pregnancy</span>
               </label>
             )}
             <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input type="checkbox" name="treatment_supporter" checked={formData.treatment_supporter} onChange={handleChange} />
               <span>Has Treatment Supporter</span>
             </label>
           </div>
         </div>

         <div className="form-section">
           <h3 className="section-title"><Phone size={16} /> Emergency Contact</h3>
           <div className="form-row">
             <div className="form-group">
               <label>Emergency Contact Name</label>
               <input type="text" name="emergency_contact_name" value={formData.emergency_contact_name}
                 onChange={handleChange} placeholder="Contact person name" />
             </div>
             <div className="form-group">
               <label>Emergency Contact Phone</label>
               <input type="tel" name="emergency_contact_phone" value={formData.emergency_contact_phone}
                 onChange={handleChange} placeholder="+263771234567" />
             </div>
           </div>
         </div>

         <div className="form-actions">
           <button type="button" className="cancel-button" onClick={onClose} disabled={loading}>
             Cancel
           </button>
           <button type="submit" className="submit-button" disabled={loading}>
             {loading ? 'Updating...' : 'Save Changes'}
           </button>
         </div>

       </form>
     </div>
   </div>
 );
}

export default PatientEditForm;