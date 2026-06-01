import React, { useState, useEffect } from 'react';
import { UserPlus, Pill, FileText, MessageSquare, AlertTriangle, Activity, Users, CheckCircle } from 'lucide-react';
import StatCard from './StatCard';
import PickupForm from './PickupForm';
import PatientForm from './PatientForm';
import './Dashboard.css';
import { defaultersAPI, patientsAPI, schedulerAPI } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);




function Dashboard({ onNavigate, currentUser }) {
  const { showToast } = useNotifications();

  const [stats, setStats] = useState({
    totalPatients: 0, activePatients: 0, activeDefaulters: 0,
    highRisk: 0, mediumRisk: 0, adherenceRate: 0
  });
  const [loading, setLoading]                 = useState(true);
  const [sendingSMS, setSendingSMS]           = useState(false);
  const [showPickupForm, setShowPickupForm]   = useState(false);
  const [showPatientForm, setShowPatientForm] = useState(false);

  useEffect(() => { fetchDashboardData(); }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [patientsRes, defaultersRes] = await Promise.all([
        patientsAPI.getAllPatients(),
        defaultersAPI.getAllDefaulters()
      ]);
      
      const patients   = patientsRes.patients   || patientsRes.data   || [];
      const defaulters = defaultersRes.defaulters || defaultersRes.data || [];
      
      // Active patients (non-defaulters)
      const activePatients = patients.filter(p => p.is_active !== false).length;

      // FIX: Count risk levels across BOTH active patients and current defaulters
      const predictedHighRisk = 
        patients.filter(p => p.risk_level?.toLowerCase() === 'high').length +
        defaulters.filter(d => d.risk_level?.toLowerCase() === 'high').length;

      const predictedMediumRisk = 
        patients.filter(p => p.risk_level?.toLowerCase() === 'medium').length +
        defaulters.filter(d => d.risk_level?.toLowerCase() === 'medium').length;

      const totalSystemPatients = patients.length + defaulters.length;

      setStats({
        totalPatients: totalSystemPatients, 
        activePatients: activePatients + defaulters.length,
        activeDefaulters: defaulters.length,
        highRisk: predictedHighRisk, 
        mediumRisk: predictedMediumRisk,
        adherenceRate: (activePatients + defaulters.length) > 0
          ? Math.round((activePatients / (activePatients + defaulters.length)) * 100) : 0
      });
      
      setLoading(false);
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setLoading(false);
    }
  };

  const handleSendReminders = async () => {
    setSendingSMS(true);
    showToast({ type: 'info', message: ' Sending reminder SMS...' });
    try {
      await schedulerAPI.sendReminders(1);
      showToast({ type: 'success', message: ' Reminder SMS sent successfully!' });
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to send SMS reminders' });
    } finally {
      setSendingSMS(false);
    }
  };



  const riskChartData = {
    labels: ['High Risk', 'Medium Risk', 'Low Risk'],
    datasets: [{ 
        data: [
            stats.highRisk, 
            stats.mediumRisk, 
            Math.max(0, stats.totalPatients - (stats.highRisk + stats.mediumRisk))
        ], 
        backgroundColor: ['#ef4444', '#f59e0b', '#10b981'], 
        borderWidth: 0 
    }]
  };

  const adherenceChartData = {
    labels: ['Adherent', 'Defaulting'],
    datasets: [{ 
        data: [
            Math.max(0, stats.activePatients - stats.activeDefaulters), 
            stats.activeDefaulters
        ], 
        backgroundColor: ['#10b981', '#ef4444'], 
        borderWidth: 0 
    }]
  };

  return (
    <div className="dashboard">


      <div className="stats-grid">
        <StatCard title="Total Patients" value={stats.totalPatients} iconNode={<Users size={32} color="#3b82f6" />} color="#3b82f6" />
        <StatCard title="Adherence Rate" value={`${stats.adherenceRate}%`} iconNode={<CheckCircle size={32} color="#10b981" />} color="#10b981" />
        <StatCard title="Missed Pickups" value={stats.activeDefaulters} iconNode={<AlertTriangle size={32} color="#ef4444" />} color="#ef4444" />
      </div>

      <div className="action-buttons-grid">
        <button className="dashboard-btn btn-register" onClick={() => setShowPatientForm(true)}>
          <UserPlus size={18} /> Register Patient
        </button>
        <button className="dashboard-btn btn-pickup" onClick={() => setShowPickupForm(true)}>
          <Pill size={18} /> Record Pickup
        </button>
        <button className="dashboard-btn btn-report" onClick={() => { if (onNavigate) onNavigate('reports'); }}>
          <FileText size={18} /> Generate Report
        </button>
        <button className="dashboard-btn btn-sms" onClick={handleSendReminders} disabled={sendingSMS}>
          <MessageSquare size={18} />
          {sendingSMS ? 'Sending...' : 'Send Reminders'}
        </button>
      </div>

      <div className="ai-section">
        <h3 className="section-title"> AI Risk Predictions</h3>
        <div className="ai-cards-container">
          <div className="ai-alert-card high-risk">
            <div className="alert-header"><AlertTriangle size={20} color="#ef4444" /><h4>High Risk Candidates</h4></div>
            <div className="alert-body"><span className="big-number red">{stats.highRisk}</span><p>Patients vulnerable due to distance, age, or history.</p></div>
            <button className="btn-action red" onClick={() => onNavigate ? onNavigate('patients', 'High') : null}>Review Patients</button>
          </div>
          <div className="ai-alert-card medium-risk">
            <div className="alert-header"><span className="alert-icon">🟠</span><h4>Medium Risk Candidates</h4></div>
            <div className="alert-body"><span className="big-number orange">{stats.mediumRisk}</span><p>Patients requiring monitoring to prevent default.</p></div>
            <button className="btn-action orange" onClick={() => onNavigate ? onNavigate('patients', 'Medium') : null}>Review Patients</button>
          </div>
          <div className="ai-alert-card system-ok">
            <div className="alert-header"><Activity size={20} color="#3b82f6" /><h4>AI Engine Status</h4></div>
            <div className="alert-body">
              <span className="status-indicator online">ONLINE</span>
              <p>Predictive models active.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <h3>Predicted Risk Analysis</h3>
          <div className="chart-container">
            <Doughnut data={riskChartData} options={{ maintainAspectRatio: false, cutout: '70%' }} />
          </div>
        </div>
        <div className="chart-card">
          <h3>Adherence Overview</h3>
          <div className="chart-container">
            <Doughnut data={adherenceChartData} options={{ maintainAspectRatio: false, cutout: '70%' }} />
          </div>
        </div>
      </div>

      {showPatientForm && (
        <PatientForm
          onClose={() => setShowPatientForm(false)}
          onSuccess={() => { fetchDashboardData(); setShowPatientForm(false); }}
          currentUser={currentUser}
        />
      )}
      {showPickupForm && (
        <PickupForm
          isOpen={true}
          onClose={() => setShowPickupForm(false)}
          onSuccess={() => { fetchDashboardData(); setShowPickupForm(false); showToast({ type: 'success', message: 'Pickup recorded!' }); }}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}

export default Dashboard;