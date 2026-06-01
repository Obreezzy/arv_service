
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;  // Changed from 5000 — Flask ML API uses 5000

// Middleware
app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'http://localhost:3000',
            'https://arv-service.vercel.app',
        ];

        // Allow any Vercel preview URL for this project
        if (
            allowedOrigins.includes(origin) ||
            origin.match(/https:\/\/arv-service.*\.vercel\.app$/)
        ) {
            return callback(null, true);
        }

        // Allow FRONTEND_URL env var
        if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Health check route
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true,
        message: 'ARV Defaulters System API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// Welcome route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to ARV Defaulters Management System API',
        version: '2.0.0',
        endpoints: {
            health: '/api/health',
            auth: '/api/auth',
            patients: '/api/patients',
            defaulters: '/api/defaulters',
            dashboard: '/api/dashboard'
        }
    });
});

// Import routes
const authRoutes      = require('./routes/auth');
const patientRoutes   = require('./routes/patients');
const pickupRoutes    = require('./routes/pickups');
const defaulterRoutes = require('./routes/defaulters');
const dashboardRoutes = require('./routes/dashboard');
const smsRoutes       = require('./routes/sms');
const scheduler       = require('./services/scheduler');
const schedulerRoutes = require('./routes/scheduler');

// Use routes
app.use('/api/auth',      authRoutes);
app.use('/api/patients',  patientRoutes);
app.use('/api/pickups',   pickupRoutes);
app.use('/api/defaulters',defaulterRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sms',       smsRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/users',     require('./routes/users'));

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.path} not found`
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error occurred:', err.message);
    console.error(err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { error: err.stack })
    });
});

// Start automated scheduler
scheduler.startScheduler();

// ── Check ML API is online on startup ────────────────────────────
const { checkMLHealth } = require('./services/riskEngine');
checkMLHealth();

// Start server
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('  ARV DEFAULTERS SYSTEM — STARTED');
    console.log('========================================');
    console.log(`  Node.js API : http://localhost:${PORT}`);
    console.log(`  ML API      : ${process.env.ML_API_URL || 'http://localhost:5000'}`);
    console.log(`  Environment : ${process.env.NODE_ENV}`);
    console.log(`  Health      : http://localhost:${PORT}/api/health`);
    console.log('========================================\n');
    console.log('Press Ctrl+C to stop\n');
});

// Handle port conflict
app.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    } else {
        console.error('Server error:', error);
    }
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

module.exports = app;