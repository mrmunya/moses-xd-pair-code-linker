import express from 'express';
import { makeWASocket, useMultiFileAuthState, makeInMemoryStore, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// ===== DELAY FUNCTION =====
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let MarinyameBot = null;
let isConnecting = false;

// Store for session data
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent' }) });

// Session storage
const sessions = new Map();
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Generate a unique session ID
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// Save session credentials
const saveCreds = async (sessionId, creds) => {
    try {
        const sessionPath = path.join(SESSIONS_DIR, sessionId);
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }
        
        // Save creds to session folder
        fs.writeFileSync(
            path.join(sessionPath, 'creds.json'),
            JSON.stringify(creds, null, 2)
        );
        
        console.log(`✅ Session ${sessionId} saved successfully`);
    } catch (error) {
        console.error('Error saving session:', error);
    }
};

// Load session credentials
async function loadSession(sessionId) {
    try {
        const sessionPath = path.join(SESSIONS_DIR, sessionId);
        const credsPath = path.join(sessionPath, 'creds.json');
        
        if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            console.log(`✅ Session ${sessionId} loaded successfully`);
            return creds;
        }
        return null;
    } catch (error) {
        console.error('Error loading session:', error);
        return null;
    }
}

// Get or create auth state
async function getAuthState(sessionId) {
    const sessionPath = path.join(SESSIONS_DIR, sessionId);
    
    // Use existing session if available
    if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        return { state, saveCreds, isNew: false };
    }
    
    // Create new session
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    return { state, saveCreds, isNew: true };
}

// ===== MAIN PAIRING ROUTE =====
router.post('/pair', async (req, res) => {
    try {
        // Validate request body
        const { number, sessionId } = req.body;
        
        if (!number) {
            return res.status(400).json({ 
                success: false, 
                message: 'Phone number is required' 
            });
        }

        // Use provided sessionId or generate new one
        const sid = sessionId || generateSessionId();
        
        // Clean phone number
        let num = number.replace(/[^\d+]/g, '');
        if (num.startsWith('+')) num = num.substring(1);
        if (!num.startsWith('234') && num.length > 0) {
            num = '234' + num;
        }

        // Check if already connecting
        if (isConnecting) {
            return res.status(429).json({
                success: false,
                message: 'A pairing request is already in progress. Please wait.'
            });
        }

        isConnecting = true;

        // Check if session already exists
        const existingCreds = await loadSession(sid);
        if (existingCreds) {
            // Session exists, try to connect
            try {
                const result = await connectWithSession(sid, num, res);
                if (result) {
                    isConnecting = false;
                    return;
                }
            } catch (error) {
                console.log('⚠️ Existing session failed, creating new one');
            }
        }

        // Start new session
        await initiateSession(sid, num, res);
        
    } catch (error) {
        console.error('Error in /pair route:', error);
        isConnecting = false;
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }
});

// ===== CONNECT WITH EXISTING SESSION =====
async function connectWithSession(sessionId, num, res) {
    try {
        console.log(`🔄 Connecting with existing session: ${sessionId}`);
        
        const { state, saveCreds } = await getAuthState(sessionId);
        
        MarinyameBot = makeWASocket({
            version: [3, 0, 0],
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['MarinyameTech', 'Chrome', '120.0.0.0'],
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            connectTimeoutMs: 30000,
            qrTimeout: 20000,
        });

        MarinyameBot.ev.on('creds.update', saveCreds);

        // Wait for connection
        return new Promise((resolve) => {
            MarinyameBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log(`✅ Session ${sessionId} connected successfully`);
                    isConnecting = false;
                    
                    // Store session
                    sessions.set(sessionId, MarinyameBot);
                    global.MarinyameBot = MarinyameBot;
                    
                    if (!res.headersSent) {
                        res.json({
                            success: true,
                            sessionId: sessionId,
                            status: 'connected',
                            message: 'Connected with existing session'
                        });
                    }
                    resolve(true);
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log('🚪 Session logged out');
                        // Delete invalid session
                        const sessionPath = path.join(SESSIONS_DIR, sessionId);
                        if (fs.existsSync(sessionPath)) {
                            fs.rmSync(sessionPath, { recursive: true, force: true });
                        }
                        resolve(false);
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error connecting with session:', error);
        return false;
    }
}

// ===== INITIATE NEW SESSION =====
async function initiateSession(sessionId, num, res) {
    let sessionAttempts = 0;
    const maxAttempts = 3;

    while (sessionAttempts < maxAttempts) {
        try {
            sessionAttempts++;
            console.log(`🔄 Session attempt ${sessionAttempts}/${maxAttempts} for ID: ${sessionId}`);

            // Get auth state
            const sessionPath = path.join(SESSIONS_DIR, sessionId);
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            
            // Create WhatsApp socket
            MarinyameBot = makeWASocket({
                version: [3, 0, 0],
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: state,
                browser: ['MarinyameTech', 'Chrome', '120.0.0.0'],
                defaultQueryTimeoutMs: 30000,
                keepAliveIntervalMs: 30000,
                connectTimeoutMs: 30000,
                qrTimeout: 20000,
                patchMessageBeforeSending: (message) => {
                    const requiresPatch = !!(
                        message.buttonsMessage ||
                        message.templateMessage ||
                        message.listMessage
                    );
                    if (requiresPatch) {
                        message = {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadataVersion: 2,
                                        deviceListMetadata: {},
                                    },
                                    ...message,
                                },
                            },
                        };
                    }
                    return message;
                },
            });

            // Save credentials with session ID
            MarinyameBot.ev.on('creds.update', () => {
                saveCreds(sessionId, MarinyameBot.authState.creds);
            });

            // Handle connection events
            MarinyameBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr, pairingCode } = update;

                // Handle pairing code
                if (pairingCode) {
                    console.log(`📱 Pairing Code for session ${sessionId}:`, pairingCode);
                    
                    // Store session info
                    sessions.set(sessionId, {
                        socket: MarinyameBot,
                        sessionId: sessionId,
                        phoneNumber: num,
                        createdAt: new Date()
                    });
                    
                    if (!res.headersSent) {
                        return res.json({
                            success: true,
                            sessionId: sessionId,
                            code: pairingCode,
                            message: 'Pairing code generated successfully. Use it to link your WhatsApp.'
                        });
                    }
                }

                // Handle QR code
                if (qr) {
                    console.log(`📱 QR Code generated for session ${sessionId}`);
                    if (!res.headersSent) {
                        return res.json({
                            success: true,
                            sessionId: sessionId,
                            qr: qr,
                            message: 'QR Code generated successfully. Scan with WhatsApp.'
                        });
                    }
                }

                // Handle connection status
                if (connection === 'open') {
                    console.log(`✅ Session ${sessionId} established successfully`);
                    isConnecting = false;
                    
                    // Save session
                    const sessionData = {
                        socket: MarinyameBot,
                        sessionId: sessionId,
                        phoneNumber: num,
                        connectedAt: new Date(),
                        status: 'connected'
                    };
                    
                    sessions.set(sessionId, sessionData);
                    global.MarinyameBot = MarinyameBot;
                    
                    // Save session info to file
                    const sessionInfoPath = path.join(SESSIONS_DIR, sessionId, 'session.json');
                    fs.writeFileSync(sessionInfoPath, JSON.stringify({
                        sessionId: sessionId,
                        phoneNumber: num,
                        connectedAt: new Date().toISOString(),
                        status: 'connected'
                    }, null, 2));
                    
                    if (!res.headersSent) {
                        return res.json({
                            success: true,
                            sessionId: sessionId,
                            status: 'connected',
                            message: 'WhatsApp connected successfully'
                        });
                    }
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(`🔌 Connection closed. Status: ${statusCode}`);
                    
                    if (shouldReconnect) {
                        console.log(`🔄 Attempting to reconnect session ${sessionId}...`);
                        if (!res.headersSent) {
                            res.status(503).json({
                                success: false,
                                sessionId: sessionId,
                                message: 'Connection lost, reconnecting...',
                                retry: true
                            });
                        }
                        // Recursive reconnect
                        setTimeout(() => {
                            initiateSession(sessionId, num, res);
                        }, 5000);
                    } else {
                        console.log(`🚪 Session ${sessionId} logged out.`);
                        isConnecting = false;
                        
                        // Clean up session
                        sessions.delete(sessionId);
                        const sessionPath = path.join(SESSIONS_DIR, sessionId);
                        if (fs.existsSync(sessionPath)) {
                            fs.rmSync(sessionPath, { recursive: true, force: true });
                        }
                        
                        if (!res.headersSent) {
                            res.status(401).json({
                                success: false,
                                sessionId: sessionId,
                                message: 'Session expired. Please restart the server.',
                                logout: true
                            });
                        }
                    }
                }
            });

            // Handle messages (optional)
            MarinyameBot.ev.on('messages.upsert', async (m) => {
                const msg = m.messages[0];
                if (!msg.key.fromMe) {
                    console.log(`📩 Received message from: ${msg.key.remoteJid}`);
                }
            });

            // Request pairing code if not registered
            if (!MarinyameBot.authState.creds.registered) {
                console.log(`📱 Requesting pairing code for session ${sessionId}...`);
                
                try {
                    await delay(3000);
                    
                    // Clean number for WhatsApp API
                    const cleanNum = num.replace(/[^\d]/g, '');
                    if (cleanNum.length < 10) {
                        throw new Error('Invalid phone number format. Please provide a valid number.');
                    }

                    const code = await MarinyameBot.requestPairingCode(cleanNum);
                    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    console.log(`✅ Pairing code for session ${sessionId}:`, formattedCode);
                    
                    if (!res.headersSent) {
                        return res.json({
                            success: true,
                            sessionId: sessionId,
                            code: formattedCode,
                            rawCode: code,
                            message: 'Pairing code generated successfully'
                        });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    isConnecting = false;
                    
                    if (!res.headersSent) {
                        const errorMessage = error.message || 'Failed to get pairing code. Please check your phone number and try again.';
                        res.status(503).json({
                            success: false,
                            sessionId: sessionId,
                            message: errorMessage,
                            error: error.message
                        });
                    }
                    throw error;
                }
            }

            // Store socket globally
            global.MarinyameBot = MarinyameBot;
            break; // Exit retry loop on success

        } catch (error) {
            console.error(`❌ Session attempt ${sessionAttempts} failed:`, error);
            
            if (sessionAttempts >= maxAttempts) {
                isConnecting = false;
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        sessionId: sessionId,
                        message: 'Failed to establish connection after multiple attempts',
                        error: error.message
                    });
                }
                throw error;
            }
            
            // Wait before retry
            await delay(3000);
        }
    }
}

// ===== GET SESSION INFO =====
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const sessionPath = path.join(SESSIONS_DIR, sessionId);
        const credsPath = path.join(sessionPath, 'creds.json');
        
        if (!fs.existsSync(credsPath)) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        const sessionInfo = sessions.get(sessionId);
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

        res.json({
            success: true,
            sessionId: sessionId,
            status: sessionInfo ? 'connected' : 'disconnected',
            phoneNumber: sessionInfo?.phoneNumber || creds?.creds?.me?.id?.split(':')[0] || 'Unknown',
            connectedAt: sessionInfo?.connectedAt || null,
            isRegistered: !!creds?.creds?.registered
        });
    } catch (error) {
        console.error('Error getting session info:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving session info'
        });
    }
});

// ===== LIST ALL SESSIONS =====
router.get('/sessions', async (req, res) => {
    try {
        const sessionDirs = fs.readdirSync(SESSIONS_DIR).filter(
            dir => fs.existsSync(path.join(SESSIONS_DIR, dir, 'creds.json'))
        );

        const sessionList = sessionDirs.map(sessionId => {
            const sessionInfo = sessions.get(sessionId);
            return {
                sessionId: sessionId,
                status: sessionInfo ? 'connected' : 'disconnected',
                phoneNumber: sessionInfo?.phoneNumber || 'Unknown',
                connectedAt: sessionInfo?.connectedAt || null
            };
        });

        res.json({
            success: true,
            sessions: sessionList,
            count: sessionList.length
        });
    } catch (error) {
        console.error('Error listing sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving sessions'
        });
    }
});

// ===== DELETE SESSION =====
router.delete('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const sessionPath = path.join(SESSIONS_DIR, sessionId);
        
        if (!fs.existsSync(sessionPath)) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        // Disconnect socket
        const session = sessions.get(sessionId);
        if (session?.socket) {
            await session.socket.end();
        }

        // Delete session folder
        fs.rmSync(sessionPath, { recursive: true, force: true });
        sessions.delete(sessionId);

        res.json({
            success: true,
            message: 'Session deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting session'
        });
    }
});

// ===== CLEANUP ON EXIT =====
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    for (const [sid, session] of sessions) {
        if (session.socket) {
            await session.socket.end();
        }
    }
    process.exit(0);
});

// ===== GLOBAL ERROR HANDLERS =====
process.on('uncaughtException', (err) => {
    const e = String(err);
    const ignoreErrors = [
        'conflict',
        'not-authorized',
        'Socket connection timeout',
        'rate-overlimit',
        'Connection Closed',
        'Timed Out',
        'Value not found',
        'Stream Errored',
        'statusCode: 515',
        'statusCode: 503'
    ];
    
    if (ignoreErrors.some(ignore => e.includes(ignore))) {
        return;
    }
    
    console.error('🔥 Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

export default router;
