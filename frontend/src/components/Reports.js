import React, { useState, useEffect } from 'react';
import { FileText, AlertTriangle, TrendingUp, Users, Download, FileSpreadsheet } from 'lucide-react';
import './Reports.css';
import { defaultersAPI, patientsAPI, pickupsAPI } from '../services/api'; 
import { useNotifications } from '../contexts/NotificationContext';
import LineChart from './charts/LineChart';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

function Reports() {
 const { showToast } = useNotifications();

 const [stats, setStats] = useState({
 totalPatients: 0, totalDefaulters: 0, highRisk: 0, adherenceRate: 0
 });

 const [patientsData, setPatientsData] = useState([]);
 const [defaultersData, setDefaultersData] = useState([]);
 const [loading, setLoading] = useState(true);

 const [selectedPatient, setSelectedPatient] = useState('');
 const [dateFrom, setDateFrom] = useState('');
 const [dateTo, setDateTo] = useState('');
 const [reportType, setReportType] = useState('summary');

 useEffect(() => { fetchReportData(); }, []);

 const fetchReportData = async () => {
 try {
 setLoading(true);
 const [pRes, dRes] = await Promise.all([
 patientsAPI.getAllPatients(),
 defaultersAPI.getAllDefaulters()
 ]);
 const patients = pRes.patients || pRes.data || [];
 const defaulters = dRes.defaulters || dRes.data || [];
 setPatientsData(patients);
 setDefaultersData(defaulters);

 const active = patients.filter(p => p.is_active !== false).length;
 const totalSystemPatients = patients.length + defaulters.length;
 const highRisk =
   patients.filter(p => p.risk_level?.toLowerCase() === 'high').length +
   defaulters.filter(d => d.risk_level?.toLowerCase() === 'high').length;
 const adherenceRate = (active + defaulters.length) > 0
   ? Math.round((active / (active + defaulters.length)) * 100) : 0;
 setStats({
   totalPatients: totalSystemPatients,
   totalDefaulters: defaulters.length,
   highRisk,
   adherenceRate,
 });
 setLoading(false);
 } catch (err) {
 showToast({ type: 'error', message: 'Failed to load report data' });
 setLoading(false);
 }
 };

 const fmtDate = (d) => {
 if (!d) return 'N/A';
 const dt = new Date(d);
 return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
 };

 const pdfHeader = (doc, title) => {
 doc.setFillColor(30, 64, 175);
 doc.rect(0, 0, 210, 38, 'F');
 doc.setTextColor(255,255,255);
 doc.setFontSize(18); doc.setFont('helvetica','bold');
 doc.text('ARV Defaulters Management System', 105, 16, { align: 'center' });
 doc.setFontSize(11); doc.setFont('helvetica','normal');
 doc.text(title, 105, 26, { align: 'center' });
 doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 33, { align: 'center' });
 doc.setTextColor(0,0,0);
 };

 const generateSummaryPDF = () => {
 const doc = new jsPDF();
 pdfHeader(doc, 'Executive Summary Report');

 doc.setFontSize(13); doc.setFont('helvetica','bold');
 doc.text('1. System Overview', 14, 50);

 autoTable(doc, {
 startY: 55,
 body: [
 ['Total Registered Patients', stats.totalPatients],
 ['Active Defaulters', stats.totalDefaulters],
 ['High Risk Patients', stats.highRisk],
 ['Adherence Rate', `${stats.adherenceRate}%`],
 ['Report Period', dateFrom && dateTo ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}` : 'All Time'],
 ],
 theme: 'striped',
 headStyles: { fillColor: [30,64,175] },
 styles: { fontSize: 10 },
 columnStyles: { 0: { fontStyle:'bold', cellWidth: 90 } }
 });

 const y1 = doc.lastAutoTable.finalY + 10;
 doc.setFontSize(13); doc.setFont('helvetica','bold');
 doc.text('2. Active Defaulters', 14, y1);

 autoTable(doc, {
 startY: y1 + 5,
 head: [['Patient', 'ID', 'Days Overdue', 'Risk Level', 'Phone']],
 body: defaultersData.length > 0
 ? defaultersData.map(d => [
 `${d.first_name} ${d.last_name}`,
 d.patient_number || 'N/A',
 `${d.days_overdue || 0} days`,
 d.risk_level?.toUpperCase() || 'N/A',
 d.phone_number || 'N/A'
 ])
 : [['No active defaulters','','','','']],
 headStyles: { fillColor: [239,68,68] },
 alternateRowStyles: { fillColor: [254,242,242] },
 styles: { fontSize: 9 }
 });

 doc.save('ARV_Summary_Report.pdf');
 showToast({ type: 'success', message: 'Summary PDF generated!' });
 };

 const generatePatientPDF = async () => {
 const patient = patientsData.find(p => p.patient_id === parseInt(selectedPatient));
 if (!patient) { showToast({ type: 'error', message: 'Please select a patient first' }); return; }

 setLoading(true);
 showToast({ type: 'info', message: 'Gathering patient history...' });

 let history = [];
 try {
 const res = await pickupsAPI.getPatientPickups(patient.patient_id);
 history = res.pickups || res.data || [];
 } catch (err) {
 console.error("Failed to fetch history", err);
 }

 const doc = new jsPDF();
 pdfHeader(doc, `Patient Report: ${patient.first_name} ${patient.last_name}`);

 const isDefaulter = defaultersData.find(d => d.patient_id === patient.patient_id);
 let startY = 50;

 if (isDefaulter) {
 doc.setFontSize(12); doc.setFont('helvetica','bold');
 doc.setTextColor(239,68,68);
 doc.text(`URGENT: Patient is currently a defaulter (${isDefaulter.days_overdue} days overdue)`, 14, startY);
 doc.setTextColor(0,0,0);
 startY += 10;
 }

 doc.setFontSize(13); doc.setFont('helvetica','bold');
 doc.text('Patient Profile', 14, startY);

 autoTable(doc, {
 startY: startY + 5,
 body: [
 ['Patient Number', patient.patient_number],
 ['Full Name', `${patient.first_name} ${patient.last_name}`],
 ['Date of Birth', fmtDate(patient.date_of_birth)],
 ['Gender', patient.gender || 'N/A'],
 ['Phone', patient.phone_number || 'N/A'],
 ['District', patient.district || 'N/A'],
 ['Ward', patient.ward || 'N/A'],
 ['Village', patient.village || 'N/A'],
 ['Headman / Sabhuku', patient.headman || 'N/A'],
 ['Distance from Clinic', patient.distance_from_clinic ? `${Math.round(patient.distance_from_clinic)} km` : 'N/A'],
 ['ARV Regimen', patient.arv_regimen || 'N/A'],
 ['Pickup Frequency', patient.pickup_frequency ? `Every ${patient.pickup_frequency} days` : 'N/A'],
 ['Risk Level', patient.risk_level || 'N/A'],
 ['Risk Score', patient.risk_score ? `${patient.risk_score}%` : 'N/A']
 ],
 theme: 'striped',
 headStyles: { fillColor: [30,64,175] },
 styles: { fontSize: 10 },
 columnStyles: { 0: { fontStyle:'bold', cellWidth: 60 } }
 });

 const nextY = doc.lastAutoTable.finalY + 15;
 doc.setFontSize(13); doc.setFont('helvetica','bold');
 doc.text('Recent Pickup History', 14, nextY); 

 const historyBody = history.slice(0, 15).map((pickup, index) => {
 const actualDate = new Date(pickup.actual_pickup_date);
 const prevRecord = history[index + 1]; 
 const expectedDate = prevRecord ? new Date(prevRecord.next_pickup_date) : null;
 
 let status = 'On Time';
 if (expectedDate && actualDate > expectedDate) {
 const daysLate = Math.floor((actualDate - expectedDate) / (1000 * 60 * 60 * 24));
 status = `${daysLate} Days Late`; 
 status = 'First Record';
 }

 return [
 fmtDate(pickup.actual_pickup_date),
 expectedDate ? fmtDate(expectedDate) : 'N/A',
 status,
 pickup.quantity_dispensed || '30',
 pickup.notes || '-'
 ];
 });

 if (historyBody.length === 0) {
 historyBody.push(['No pickup history available for this patient.', '', '', '', '']);
 }

 autoTable(doc, {
 startY: nextY + 5,
 head: [['Actual Pickup', 'Expected Date', 'Status', 'Dispensed', 'Notes']],
 body: historyBody,
 headStyles: { fillColor: [59, 130, 246] }, 
 alternateRowStyles: { fillColor: [241, 245, 249] },
 styles: { fontSize: 9 },
 didParseCell: function(data) {
 if (data.section === 'body' && data.column.index === 2) {
 if (data.cell.raw.includes('Late')) {
 data.cell.styles.textColor = [220, 38, 38]; 
 data.cell.styles.fontStyle = 'bold';
 } else if (data.cell.raw.includes('On Time')) {
 data.cell.styles.textColor = [22, 163, 74]; 
 }
 }
 }
 });

 doc.save(`Patient_Report_${patient.patient_number}.pdf`);
 setLoading(false);
 showToast({ type: 'success', message: `Report for ${patient.first_name} generated!` });
 };

 const generateHighRiskPDF = () => {
 const doc = new jsPDF();
 pdfHeader(doc, 'High Risk Patients Report');

 const highRisk = patientsData.filter(p => p.risk_level === 'High' || p.risk_level === 'Medium');

 doc.setFontSize(13); doc.setFont('helvetica','bold');
 doc.text(`At-Risk Patients (${highRisk.length} total)`, 14, 50);

 autoTable(doc, {
 startY: 55,
 head: [['Patient', 'ID', 'Risk', 'Score', 'Next Pickup', 'Phone']],
 body: highRisk.length > 0
 ? highRisk.map(p => [
 `${p.first_name} ${p.last_name}`,
 p.patient_number,
 p.risk_level?.toUpperCase() || 'N/A',
 p.risk_score ? `${p.risk_score}%` : '0%',
 fmtDate(p.next_pickup_date),
 p.phone_number || 'N/A'
 ])
 : [['No high/medium risk patients found','','','','','','']],
 headStyles: { fillColor: [245,158,11] },
 alternateRowStyles: { fillColor: [255,251,235] },
 styles: { fontSize: 9 }
 });

 doc.save('High_Risk_Patients_Report.pdf');
 showToast({ type: 'success', message: 'High Risk report generated!' });
 };

 const generateDefaultersPDF = () => {
 const doc = new jsPDF();
 pdfHeader(doc, 'Defaulters Tracking Report');

 doc.setFontSize(13); doc.setFont('helvetica','bold');
 doc.text(`Active Defaulters: ${defaultersData.length}`, 14, 50);

 autoTable(doc, {
 startY: 55,
 head: [['Patient Name', 'ID', 'Days Overdue', 'Risk', 'Phone', 'Detected']],
 body: defaultersData.length > 0
 ? defaultersData.map(d => [
 `${d.first_name} ${d.last_name}`,
 d.patient_number || 'N/A',
 `${d.days_overdue || 0} days`,
 d.risk_level?.toUpperCase() || 'N/A',
 d.phone_number || 'N/A',
 fmtDate(d.detected_date)
 ])
 : [['No active defaulters','','','','','']],
 headStyles: { fillColor: [239,68,68] },
 alternateRowStyles: { fillColor: [254,242,242] },
 styles: { fontSize: 9 }
 });

 doc.save('Defaulters_Report.pdf');
 showToast({ type: 'success', message: 'Defaulters report generated!' });
 };

 const generateExcel = () => {
 const wb = XLSX.utils.book_new();

 const pSheet = XLSX.utils.json_to_sheet(patientsData.map(p => ({
 'Patient Number': p.patient_number,
 'First Name': p.first_name,
 'Last Name': p.last_name,
 'Gender': p.gender,
 'Date of Birth': fmtDate(p.date_of_birth),
 'Phone': p.phone_number,
 'District': p.district,
 'Ward': p.ward,
 'Village': p.village,
 'Headman': p.headman,
 'Distance (km)': p.distance_from_clinic,
 'ARV Regimen': p.arv_regimen,
 'Risk Level': p.risk_level,
 'Risk Score': p.risk_score,
 'Next Pickup': fmtDate(p.next_pickup_date),
 'Status': p.is_active ? 'Active' : 'Inactive',
 'Enrollment': fmtDate(p.enrollment_date),
 })));
 XLSX.utils.book_append_sheet(wb, pSheet, 'Patients');

 const dSheet = XLSX.utils.json_to_sheet(defaultersData.map(d => ({
 'Patient Name': `${d.first_name} ${d.last_name}`,
 'Patient ID': d.patient_number,
 'Days Overdue': d.days_overdue,
 'Risk Level': d.risk_level,
 'Phone': d.phone_number,
 'Status': d.status,
 'Detected Date': fmtDate(d.detected_date),
 })));
 XLSX.utils.book_append_sheet(wb, dSheet, 'Defaulters');

 const sSheet = XLSX.utils.json_to_sheet([
 { Metric: 'Total Patients', Value: stats.totalPatients },
 { Metric: 'Active Defaulters', Value: stats.totalDefaulters },
 { Metric: 'High Risk', Value: stats.highRisk },
 { Metric: 'Adherence Rate', Value: `${stats.adherenceRate}%` },
 { Metric: 'Report Date', Value: new Date().toLocaleDateString() },
 ]);
 XLSX.utils.book_append_sheet(wb, sSheet, 'Summary');

 XLSX.writeFile(wb, 'ARV_System_Data.xlsx');
 showToast({ type: 'success', message: 'Excel exported successfully!' });
 };

 const adherenceTrendData = {
 labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
 datasets: [{
 label: 'Adherence %',
 data: [85, 87, 84, 89, 91, stats.adherenceRate],
 borderColor: '#10b981',
 backgroundColor: 'rgba(16, 185, 129, 0.1)',
 fill: true, tension: 0.4
 }]
 };

 if (loading) return (
 <div className="loading-state">
 <div className="spinner"></div>
 <p>Processing data...</p>
 </div>
 );

 return (
 <div className="reports-page">
 <div className="reports-header">
 <h2 className="reports-title">System Reports &amp; Exports</h2>
 <div className="reports-date">As of {new Date().toLocaleDateString()}</div>
 </div>

 {/* Report Type Selector */}
 <div className="report-type-bar">
 {[
 { key: 'summary',    label: 'Summary',        desc: 'Full system overview',  icon: <FileText size={16} /> },
 { key: 'patient',    label: 'Patient Report', desc: 'Single patient detail', icon: <Users size={16} /> },
 { key: 'highrisk',   label: 'High Risk',      desc: 'At-risk patients',      icon: <AlertTriangle size={16} /> },
 { key: 'defaulters', label: 'Defaulters',     desc: 'Missed pickups',        icon: <TrendingUp size={16} /> },
 { key: 'excel',      label: 'Excel Export',   desc: 'Full data export',      icon: <FileSpreadsheet size={16} /> },
 ].map(r => (
 <button
 key={r.key}
 className={`report-type-btn ${reportType === r.key ? 'active' : ''}`}
 onClick={() => setReportType(r.key)}
 >
 <span className="rt-icon">{r.icon}</span>
 <span className="rt-label">{r.label}</span>
 <span className="rt-desc">{r.desc}</span>
 </button>
 ))}
 </div>

 {/* Filters */}
 <div className="report-filters">
 {reportType === 'patient' && (
 <div className="filter-group">
 <label>Select Patient</label>
 <select value={selectedPatient} onChange={e => setSelectedPatient(e.target.value)}>
 <option value="">-- Choose a patient --</option>
 {patientsData.map(p => (
 <option key={p.patient_id} value={p.patient_id}>
 {p.first_name} {p.last_name} ({p.patient_number})
 </option>
 ))}
 </select>
 </div>
 )}
 <div className="filter-group">
 <label>From Date</label>
 <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
 </div>
 <div className="filter-group">
 <label>To Date</label>
 <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
 </div>
 </div>

 {/* Generate Button */}
 <div className="generate-section">
 <button
 className="btn-generate"
 onClick={() => {
 if (reportType === 'summary') generateSummaryPDF();
 else if (reportType === 'patient') generatePatientPDF();
 else if (reportType === 'highrisk') generateHighRiskPDF();
 else if (reportType === 'defaulters') generateDefaultersPDF();
 else if (reportType === 'excel') generateExcel();
 }}
 >
 {reportType === 'excel' ? <><Download size={16} /> Export Excel</> : <><FileText size={16} /> Generate PDF Report</>}
 </button>

 <div className="report-stats-row">
 <div className="mini-stat"><span>{stats.totalPatients}</span><small>Total Patients</small></div>
 <div className="mini-stat red"><span>{stats.totalDefaulters}</span><small>Defaulters</small></div>
 <div className="mini-stat orange"><span>{stats.highRisk}</span><small>High Risk</small></div>
 <div className="mini-stat green"><span>{stats.adherenceRate}%</span><small>Adherence</small></div>
 </div>
 </div>

 {/* Chart */}
 <div className="report-chart-box">
 <h3>Adherence Performance Trend</h3>
 <div className="chart-inner">
 <LineChart data={adherenceTrendData} />
 </div>
 </div>
 </div>
 );
}

export default Reports;