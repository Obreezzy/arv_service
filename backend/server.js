// backend/server.js
// ARV Defaulters Management System v2
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const express  = require('express');
const cors     = require('cors');
const dotenv   = require('dotenv');

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'http://localhost:3000',
            'https://arv-service.vercel.app',
        ];

        if (
            allowedOrigins.includes(origin) ||
            origin.match(/https:\/\/arv-service.*\.vercel\.app$/)
        ) {
            return callback(null, true);
        }

        if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});


// ── Core routes ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        success     : true,
        message     : 'ARV Defaulters System API is running',
        timestamp   : new Date().toISOString(),
        environment : process.env.NODE_ENV,
        mlApi       : process.env.ML_API_URL || 'not set',
    });
});

app.get('/', (req, res) => {
    res.json({
        success  : true,
        message  : 'Welcome to ARV Defaulters Management System API',
        version  : '2.0.0',
        endpoints: {
            health     : '/api/health',
            auth       : '/api/auth',
            patients   : '/api/patients',
            defaulters : '/api/defaulters',
            dashboard  : '/api/dashboard',
            predictions: '/api/predictions',   // ← NEW
        },
    });
});


// ── Feature routes ────────────────────────────────────────────────────────────
// BUG FIX: riskEngine was imported twice — once at line 83, then mlService
// at line 118 (which doesn't exist). Removed both. riskEngine is now only
// used inside the predictions route — server.js doesn't call it directly.

const authRoutes        = require('./routes/auth');
const patientRoutes     = require('./routes/patients');
const pickupRoutes      = require('./routes/pickups');
const defaulterRoutes   = require('./routes/defaulters');
const dashboardRoutes   = require('./routes/dashboard');
const smsRoutes         = require('./routes/sms');
const schedulerRoutes   = require('./routes/scheduler');
const predictionsRoutes = require('./routes/predictions');   // ← NEW

const scheduler = require('./services/scheduler');

app.use('/api/auth',        authRoutes);
app.use('/api/patients',    patientRoutes);
app.use('/api/pickups',     pickupRoutes);
app.use('/api/defaulters',  defaulterRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/sms',         smsRoutes);
app.use('/api/scheduler',   schedulerRoutes);
app.use('/api/users',       require('./routes/users'));
app.use('/api/predictions', predictionsRoutes);             // ← NEW


// ── 404 & error handlers ──────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        success : false,
        message : `Route ${req.method} ${req.path} not found`,
    });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    console.error(err.stack);
    res.status(err.status || 500).json({
        success : false,
        message : err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});


// ── Startup sequence ──────────────────────────────────────────────────────────
// BUG FIX: scheduler.startScheduler() and checkMLHealth() were called BEFORE
// app.listen(), meaning they fired before the server was ready. Moved both
// inside the app.listen callback so they only run once the port is bound.

app.listen(PORT, async () => {
    console.log('\n========================================');
    console.log('  ARV DEFAULTERS SYSTEM — STARTED');
    console.log('========================================');
    console.log(`  Node.js API : http://localhost:${PORT}`);
    console.log(`  ML API      : ${process.env.ML_API_URL || '⚠ ML_API_URL not set'}`);
    console.log(`  Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Health      : http://localhost:${PORT}/api/health`);
    console.log('========================================\n');

    // Start automated SMS/reminder scheduler
    scheduler.startScheduler();

    // Check ML API reachability on startup
    // BUG FIX: was requiring './services/mlService' which does not exist.
    // riskEngine.js is the correct file and already exports checkMLHealth.
    const { checkMLHealth } = require('./services/riskEngine');
    await checkMLHealth();
});


// ── Process error handlers ────────────────────────────────────────────────────
app.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`✗ Port ${PORT} is already in use`);
    } else {
        console.error('Server error:', error);
    }
    process.exit(1);
});

process.on('SIGTERM', () => { console.log('\nShutting down (SIGTERM)…'); process.exit(0); });
process.on('SIGINT',  () => { console.log('\nShutting down (SIGINT)…');  process.exit(0); });

module.exports = app;