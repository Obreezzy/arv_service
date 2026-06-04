import React, { useState, useEffect } from 'react';
import { Key } from 'lucide-react';
import './Staff.css';
import { usersAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';
import StaffForm from './StaffForm';

function Staff() {
  const { showToast } = useNotifications();
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await usersAPI.getAllUsers();
      setUsers(res.users || []);
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to load staff directory' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (user) => {
    if (!window.confirm(
      `Are you sure you want to ${user.is_active ? 'deactivate' : 'activate'} ${user.full_name}?`
    )) return;

    try {
      await usersAPI.toggleStatus(user.user_id, !user.is_active);
      showToast({ type: 'success', message: `Account ${user.is_active ? 'deactivated' : 'activated'} successfully.` });
      loadUsers();
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to update account status.' });
    }
  };

  const handleResetPassword = async (staffId, staffName) => {
    const newPassword = window.prompt(`Enter a new temporary password for ${staffName} (min 6 characters):`);
    
    if (!newPassword) return;
    if (newPassword.length < 6) {
        showToast({ type: 'error', message: 'Password must be at least 6 characters!' });
        return;
    }

    try {
        await usersAPI.resetPassword(staffId, newPassword);
        showToast({ type: 'success', message: `Password reset successfully. Inform ${staffName} of their new temporary password.` });
    } catch (err) {
        showToast({ type: 'error', message: err.response?.data?.message || 'Failed to reset password.' });
    }
  };

  return (
    <div className="staff-page">
      <div className="page-header">
        <div className="header-content">
          <h2 className="page-title">Staff Management</h2>
          <p className="page-subtitle">Manage clinic personnel and system access.</p>
        </div>
        <div className="header-actions">
          <button className="btn-add-staff" onClick={() => setShowModal(true)}>
            + Add New Staff
          </button>
        </div>
      </div>

      <div className="table-container">
        <div className="table-scroll">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Email / Username</th>
                <th>Role</th>
                <th>Staff ID</th>
                <th>Nurse No.</th>
                <th>Clinic</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} className={!u.is_active ? 'inactive-row' : ''}>
                  <td className="fw-bold">{u.full_name}</td>
                  <td>
                    <div>{u.email}</div>
                    <div className="sub-text">@{u.username}</div>
                  </td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>
                      {u.role.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      fontFamily: 'monospace', fontSize: '0.8rem',
                      background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px'
                    }}>
                      {u.staff_id || '—'}
                    </span>
                  </td>
                  <td>
                    {u.nurse_number ? (
                      <span style={{
                        fontFamily: 'monospace', fontSize: '0.8rem',
                        background: '#f0fdf4', color: '#166534',
                        padding: '2px 8px', borderRadius: '4px',
                        border: '1px solid #bbf7d0'
                      }}>
                        {u.nurse_number}
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>N/A</span>
                    )}
                  </td>
                  <td>
                    {u.clinic_number ? (
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>
                          {u.clinic_name || '—'}
                        </div>
                        <div style={{
                          fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280'
                        }}>
                          {u.clinic_number}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>N/A</span>
                    )}
                  </td>
                  <td>{u.phone_number || 'N/A'}</td>
                  <td>
                    <span className={`status-badge ${u.is_active ? 'status-active' : 'status-inactive'}`}>
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        className={`btn-toggle ${u.is_active ? 'btn-deactivate' : 'btn-activate'}`}
                        onClick={() => handleToggleStatus(u)}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button 
                        style={{ color: '#3b82f6', marginLeft: '15px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} 
                        onClick={() => handleResetPassword(u.user_id, u.full_name)}
                      >
                        <Key size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && <StaffForm onClose={() => setShowModal(false)} onSuccess={loadUsers} />}
    </div>
  );
}

export default Staff;