import React, { useState } from 'react';
import { Save, Loader } from 'lucide-react';
import { labsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';

function LabEntryForm({ patientId, onSuccess }) {
  const { showToast } = useNotifications();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    cd4_count: '',
    vl_value: '',
    vl_suppressed: false,
    weight_kg: '',
    side_effects: '',
    test_date: new Date().toISOString().split('T')[0]
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    // Sanitize values to prevent PostgreSQL string-to-numeric type crashes
    const sanitizedPayload = {
      patient_id: patientId,
      cd4_count: formData.cd4_count ? parseInt(formData.cd4_count, 10) : null,
      vl_value: formData.vl_value ? parseInt(formData.vl_value, 10) : null,
      vl_suppressed: Boolean(formData.vl_suppressed),
      weight_kg: formData.weight_kg ? parseFloat(formData.weight_kg) : null,
      side_effects: formData.side_effects.trim() || null,
      test_date: formData.test_date
    };

    try {
      await labsAPI.recordResult(sanitizedPayload);
      showToast({ type: 'success', message: 'Lab results recorded & risk profile updated!' });
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('API Error saving lab values:', err);
      showToast({ type: 'error', message: 'Failed to save lab results.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="lab-entry-form" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#666' }}>Date of Test</label>
          <input type="date" value={formData.test_date} onChange={e => setFormData({...formData, test_date: e.target.value})} required style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
        </div>
        <div className="form-group">
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#666' }}>CD4 Count</label>
          <input type="number" placeholder="e.g. 500" value={formData.cd4_count} onChange={e => setFormData({...formData, cd4_count: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
        </div>
        <div className="form-group">
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#666' }}>Viral Load (copies/ml)</label>
          <input type="number" placeholder="e.g. 20" value={formData.vl_value} onChange={e => setFormData({...formData, vl_value: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
        </div>
        <div className="form-group">
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#666' }}>Weight (kg)</label>
          <input type="number" step="0.1" placeholder="e.g. 65.5" value={formData.weight_kg} onChange={e => setFormData({...formData, weight_kg: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
        </div>
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={formData.vl_suppressed} onChange={e => setFormData({...formData, vl_suppressed: e.target.checked})} />
          Viral Load Suppressed?
        </label>
      </div>

      <div className="form-group">
        <label style={{ display: 'block', fontSize: '0.8rem', color: '#666' }}>Side Effects / Notes</label>
        <textarea rows="3" placeholder="Describe side effects..." value={formData.side_effects} onChange={e => setFormData({...formData, side_effects: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
      </div>

      <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: '0.75rem', cursor: 'pointer' }}>
        {loading ? <><Loader size={16} className="spin"/> Saving...</> : <><Save size={16}/> Save Results</>}
      </button>
    </form>
  );
}

export default LabEntryForm;