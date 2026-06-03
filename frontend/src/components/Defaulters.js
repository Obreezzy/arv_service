import React, { useState, useEffect } from 'react';
import { RefreshCw, Loader2, Pill, CheckCircle, Trash2 } from 'lucide-react';
import './Defaulters.css';
import { defaultersAPI, patientsAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';
import PickupForm from './PickupForm';

function Defaulters({ currentUser }) {
  const { showToast } = useNotifications();
  const [defaulters, setDefaulters]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [pickupPatient, setPickupPatient] = useState(null);

  useEffect(() => { loadDefaulters(); }, []);

  const loadDefaulters = async () => {
    try {
      setLoading(true);
      const res  = await defaultersAPI.getAllDefaulters();
      setDefaulters(res.defaulters || res.data || []);
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: 'Failed to load defaulters list' });
    } finally {
      setLoading(false);
    }
  };

  const getRiskClass = (level) => {
    switch (level?.toLowerCase()) {
      case 'high':   return 'risk-high';
      case 'medium': return 'risk-medium';
      case 'low':    return 'risk-low';
      default:       return 'risk-default';
    }
  };

  const handleDeletePatient = async (patient) => {
    if (!window.confirm(`CRITICAL WARNING: Are you sure you want to permanently delete ${patient.first_name} ${patient.last_name}? This will erase their entire clinical history and remove them from the system forever.`)) {
      return;
    }
    try {
      setLoading(true);
      await patientsAPI.deletePatient(patient.patient_id);
      showToast({ type: 'success', message: 'Patient completely deleted from the database.' });
      loadDefaulters();
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: 'Error deleting patient.' });
      setLoading(false);
    }
  };

  return (
    <div className="defaulters-page">
      <div className="page-header">
        <div className="header-content">
          <h2 className="page-title">Defaulters Tracking</h2>
          <p className="page-subtitle">
            Patients who have missed their scheduled medication pickups.
            {defaulters.length > 0 && (
              <span style={{ marginLeft: '0.5rem', color: '#ef4444', fontWeight: '700' }}>
                ({defaulters.length} active)
              </span>
            )}
          </p>
        </div>
        <button className="btn-scan" onClick={loadDefaulters} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="table-container">
        <div className="table-scroll">
          {loading ? (
            <div className="empty-state">
              <div className="empty-icon"><Loader2 size={40} /></div>
              <h3>Loading defaulters...</h3>
            </div>
          ) : defaulters.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><CheckCircle size={40} color="#10b981" /></div>
              <h3>No Defaulters Found</h3>
              <p>All patients are currently up to date with their medication pickups.</p>
            </div>
          ) : (
            <table className="defaulters-table">
              <thead>
                <tr>
                  <th>Patient Name</th>
                  <th>Phone</th>
                  <th>Days Overdue</th>
                  <th>Risk Level</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {defaulters.map(d => (
                  <tr key={d.defaulter_id || Math.random()}>
                    <td className="fw-bold">
                      {d.first_name} {d.last_name}
                      <div className="sub-text">{d.patient_number}</div>
                    </td>
                    <td>{d.phone_number || 'N/A'}</td>
                    <td><span className="overdue-days">{d.days_overdue} days</span></td>
                    <td>
                      <span className={`risk-badge ${getRiskClass(d.risk_level)}`}>
                        {d.risk_level?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          className="btn-record-pickup"
                          onClick={() => setPickupPatient({
                            patient_id:       d.patient_id,
                            first_name:       d.first_name,
                            last_name:        d.last_name,
                            patient_number:   d.patient_number,
                            phone_number:     d.phone_number,
                            pickup_frequency: d.pickup_frequency || 30
                          })}
                        >
                          <Pill size={15} /> Record Pickup
                        </button>
                        <button 
                          className="btn-icon delete" 
                          title="Delete Patient Entirely" 
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.4rem', borderRadius: '4px' }} 
                          onClick={() => handleDeletePatient(d)}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {pickupPatient && (
        <PickupForm
          isOpen={true}
          preselectedPatient={pickupPatient}
          currentUser={currentUser}
          onClose={() => setPickupPatient(null)}
          onSuccess={() => {
            setPickupPatient(null);
            showToast({ type: 'success', message: 'Pickup recorded! Patient returned to active list.' });
            loadDefaulters();
          }}
        />
      )}
    </div>
  );
}

export default Defaulters;