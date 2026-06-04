import React, { useState } from 'react';
import './Login.css';
import { useNotifications } from '../contexts/NotificationContext';
import { authAPI } from '../services/api';

function Login({ onLogin }) {
  const { showToast } = useNotifications();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
        const response = await authAPI.login({ email, password });
        
        if (response.success) {
            sessionStorage.setItem('token', response.token); 
            
            showToast({ type: 'success', message: `Welcome back, ${response.user.full_name}!` });
            
            onLogin(response.user);
        }
    } catch (err) {
        console.error("Login failed:", err);
        const errorMessage = err.response?.data?.message || 'Failed to connect to server.';
        showToast({ type: 'error', message: errorMessage });
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
            <div className="login-logo">ARV</div>
            <h2>System Login</h2>
            <p>Enter your credentials to access the Defaulters Management System.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Email Address</label>
            <input 
              type="email" 
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Authenticating...' : 'Secure Login'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280', padding: '0 1rem', marginBottom: '1rem' }}>
          Forgot your password? Please contact the <strong>System Admin</strong> to request a secure credential reset.
        </div>

        <div className="login-footer">
            <p>Unauthorized access is strictly prohibited. This system contains sensitive patient medical records.</p>
        </div>
      </div>
    </div>
  );
}

export default Login;