
const { spawn } = require('child_process');
const axios     = require('axios');
const path      = require('path');

//Config 
const ML_API_PORT = 5000;
const ML_API_URL  = `http://localhost:${ML_API_PORT}`;
const ML_API_DIR  = path.join(__dirname, 'ml_api');
const NODE_SCRIPT = path.join(__dirname, 'backend', 'server.js');


const c = {
    reset  : '\x1b[0m',
    green  : '\x1b[32m',
    yellow : '\x1b[33m',
    red    : '\x1b[31m',
    cyan   : '\x1b[36m',
    bold   : '\x1b[1m',
};

const log = {
    info  : (msg) => console.log(`${c.cyan}[STARTUP]${c.reset} ${msg}`),
    ok    : (msg) => console.log(`${c.green}[  OK   ]${c.reset} ${msg}`),
    warn  : (msg) => console.log(`${c.yellow}[ WARN  ]${c.reset} ${msg}`),
    error : (msg) => console.log(`${c.red}[ ERROR ]${c.reset} ${msg}`),
    flask : (msg) => console.log(`${c.yellow}[ FLASK ]${c.reset} ${msg}`),
    node  : (msg) => console.log(`${c.green}[ NODE  ]${c.reset} ${msg}`),
};


//Start Flask ML API 
const startFlask = () => {
    return new Promise((resolve, reject) => {
        log.info('Starting Flask ML API...');

        // Full Python path — miniconda3 on Windows
        const pythonCmd = process.platform === 'win32'
            ? 'C:\\Users\\user\\miniconda3\\python.exe'
            : 'python3';

        const flask = spawn(pythonCmd, ['app.py'], {
            cwd : ML_API_DIR,
            env : { ...process.env, PORT: ML_API_PORT, FLASK_ENV: 'production' },
            stdio: 'pipe'
        });

        flask.stdout.on('data', (data) => {
            data.toString().trim().split('\n').forEach(line => {
                if (line.trim()) log.flask(line);
            });
        });

        flask.stderr.on('data', (data) => {
            data.toString().trim().split('\n').forEach(line => {
                // Flask uses stderr for normal logs — only show non-WARNING lines
                if (line.trim() && !line.includes('WARNING') && !line.includes('Development')) {
                    log.flask(line);
                }
            });
        });

        flask.on('error', (err) => {
            log.error(`Failed to start Flask: ${err.message}`);
            log.error('Fix: cd ml_api && pip install -r requirements.txt');
            reject(err);
        });

        flask.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                log.error(`Flask exited unexpectedly with code ${code}`);
                log.error('Check ml_api/app.py and arv_model_output/ folder');
            }
        });

        // Poll /health every second — wait up to 60 seconds
        let attempts = 0;

        const poll = setInterval(async () => {
            attempts++;
            try {
                await axios.get(`${ML_API_URL}/health`, { timeout: 1000 });
                clearInterval(poll);
                console.log('');
                log.ok(`Flask ML API ready → ${ML_API_URL}`);
                resolve(flask);
            } catch {
                if (attempts >= 60) {
                    clearInterval(poll);
                    log.error('Flask did not start within 60 seconds');
                    log.error('Make sure arv_model_output/ folder exists in ml_api/');
                    reject(new Error('Flask startup timeout'));
                } else {
                    process.stdout.write('.');
                }
            }
        }, 1000);
    });
};


//Start Node.js backend 
const startNode = () => {
    return new Promise((resolve, reject) => {
        log.info('Starting Node.js backend...');

        const node = spawn('node', [NODE_SCRIPT], {
            env  : {
                ...process.env,
                ML_API_URL,          
            },
            stdio: 'pipe'
        });

        node.stdout.on('data', (data) => {
            data.toString().trim().split('\n').forEach(line => {
                if (line.trim()) log.node(line);
            });
        });

        node.stderr.on('data', (data) => {
            data.toString().trim().split('\n').forEach(line => {
                if (line.trim()) log.node(line);
            });
        });

        node.on('error', (err) => {
            log.error(`Failed to start Node.js: ${err.message}`);
            reject(err);
        });

        node.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                log.warn(`Node.js exited with code ${code}`);
            }
        });

        setTimeout(() => {
            log.ok('Node.js backend started');
            resolve(node);
        }, 3000);
    });
};


const setupShutdown = (flaskProcess, nodeProcess) => {
    const shutdown = (signal) => {
        console.log('');
        log.warn(`${signal} received — shutting down...`);

        if (flaskProcess) {
            flaskProcess.kill('SIGTERM');
            log.info('Flask ML API stopped');
        }
        if (nodeProcess) {
            nodeProcess.kill('SIGTERM');
            log.info('Node.js backend stopped');
        }

        process.exit(0);
    };

    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
};


const main = async () => {

    try {
        const flaskProcess = await startFlask();

        const nodeProcess  = await startNode();

        setupShutdown(flaskProcess, nodeProcess);

        console.log('');
        console.log(`${c.bold}${c.green}╔══════════════════════════════════════════╗${c.reset}`);
        console.log(`${c.bold}${c.green}║       ALL SERVICES RUNNING               ║${c.reset}`);
        console.log(`${c.bold}${c.green}║                                          ║${c.reset}`);
        console.log(`${c.bold}${c.green}║   Flask ML API → http://localhost:5000   ║${c.reset}`);
        console.log(`${c.bold}${c.green}║   Node.js API  → http://localhost:3001   ║${c.reset}`);
        console.log(`${c.bold}${c.green}║   Frontend     → http://localhost:3000   ║${c.reset}`);
        console.log(`${c.bold}${c.green}║                                          ║${c.reset}`);
        console.log(`${c.bold}${c.green}║   Press Ctrl+C to stop all services      ║${c.reset}`);
        console.log(`${c.bold}${c.green}╚══════════════════════════════════════════╝${c.reset}`);
        console.log('');

    } catch (error) {
        log.error(`Startup failed: ${error.message}`);
        log.error('Common fixes:');
        log.error('  1. Run: cd ml_api && pip install -r requirements.txt');
        log.error('  2. Make sure arv_model_output/ is inside ml_api/');
        log.error('  3. Run your Jupyter notebook Step 13 to generate model files');
        process.exit(1);
    }
};

main();