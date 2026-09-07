import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';

// Importing the modules
import pairRouter from './pair.js';
import qrRouter from './qr.js';
import QRCode from 'qrcode';

const app = express();

// Resolve the current directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// ===== GLOBAL SESSION STORAGE =====
// Store sessions globally for easy access across all routes
export const globalSessions = {
    pair: new Map(),
    qr: new Map()
};

// Increase max listeners to handle multiple connections
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// ===== MIDDLEWARE =====
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ===== SESSION MANAGEMENT ROUTES =====

// Get all sessions (both pair and QR)
app.get('/api/sessions', (req, res) => {
    try {
        const pairSessions = Array.from(globalSessions.pair.entries()).map(([id, data]) => ({
            sessionId: id,
            type: 'pair',
            number: data.number,
            status: data.status || 'active',
            timestamp: data.timestamp,
            createdAt: new Date(data.timestamp).toISOString(),
            age: Math.floor((Date.now() - data.timestamp) / 1000) // seconds
        }));

        const qrSessions = Array.from(globalSessions.qr.entries()).map(([id, data]) => ({
            sessionId: id,
            type: 'qr',
            status: data.status || 'active',
            timestamp: data.timestamp,
            createdAt: new Date(data.timestamp).toISOString(),
            age: Math.floor((Date.now() - data.timestamp) / 1000)
        }));

        res.json({
            success: true,
            total: pairSessions.length + qrSessions.length,
            sessions: [...pairSessions, ...qrSessions]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get specific session by ID
app.get('/api/session/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        // Check in pair sessions
        let session = globalSessions.pair.get(id);
        let type = 'pair';
        
        if (!session) {
            // Check in QR sessions
            session = globalSessions.qr.get(id);
            type = 'qr';
        }
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        const response = {
            success: true,
            session: {
                sessionId: id,
                type: type,
                ...session,
                createdAt: new Date(session.timestamp).toISOString()
            }
        };

        // Don't send sensitive data like sock object
        if (response.session.sock) {
            delete response.session.sock;
        }

        res.json(response);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Delete session by ID
app.delete('/api/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let deleted = false;
        let session = null;

        // Check in pair sessions
        if (globalSessions.pair.has(id)) {
            session = globalSessions.pair.get(id);
            if (session.sock) {
                try {
                    await session.sock.logout();
                } catch (error) {
                    console.error('Error logging out session:', error);
                }
            }
            globalSessions.pair.delete(id);
            deleted = true;
        }

        // Check in QR sessions
        if (globalSessions.qr.has(id)) {
            session = globalSessions.qr.get(id);
            if (session.sock) {
                try {
                    await session.sock.logout();
                } catch (error) {
                    console.error('Error logging out session:', error);
                }
            }
            globalSessions.qr.delete(id);
            deleted = true;
        }

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.json({
            success: true,
            message: 'Session deleted successfully',
            sessionId: id
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get session statistics
app.get('/api/stats', (req, res) => {
    try {
        const pairCount = globalSessions.pair.size;
        const qrCount = globalSessions.qr.size;
        const total = pairCount + qrCount;

        res.json({
            success: true,
            stats: {
                totalSessions: total,
                pairSessions: pairCount,
                qrSessions: qrCount,
                timestamp: new Date().toISOString(),
                memoryUsage: process.memoryUsage()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Clean up all expired sessions
app.post('/api/cleanup', (req, res) => {
    try {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        let cleaned = 0;

        // Clean pair sessions
        for (const [id, data] of globalSessions.pair.entries()) {
            if (now - data.timestamp > maxAge) {
                globalSessions.pair.delete(id);
                cleaned++;
            }
        }

        // Clean QR sessions
        for (const [id, data] of globalSessions.qr.entries()) {
            if (now - data.timestamp > maxAge) {
                globalSessions.qr.delete(id);
                cleaned++;
            }
        }

        res.json({
            success: true,
            message: `Cleaned up ${cleaned} expired sessions`,
            cleaned: cleaned,
            remaining: globalSessions.pair.size + globalSessions.qr.size
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== MAIN ROUTES =====

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Use pair and qr routers
app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        sessions: globalSessions.pair.size + globalSessions.qr.size
    });
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        success: false, 
        message: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ===== START SERVER =====
app.listen(PORT, () => {
    console.log('🚀 ====================================');
    console.log('📱 WhatsApp Bot Server');
    console.log('🚀 ====================================');
    console.log(`🔗 Server running on http://localhost:${PORT}`);
    console.log('📋 ====================================');
    console.log('📋 Available Endpoints:');
    console.log('   GET  /api/sessions        - List all sessions');
    console.log('   GET  /api/session/:id     - Get session details');
    console.log('   DELETE /api/session/:id   - Delete a session');
    console.log('   GET  /api/stats           - Session statistics');
    console.log('   POST /api/cleanup         - Clean expired sessions');
    console.log('   GET  /health              - Health check');
    console.log('📋 ====================================');
    console.log('🔑 Pairing Endpoints:');
    console.log('   POST /pair                - Generate pairing code');
    console.log('   GET  /pair/sessions       - List pair sessions');
    console.log('   GET  /pair/session/:id    - Get pair session');
    console.log('   DELETE /pair/session/:id  - Delete pair session');
    console.log('📷 QR Code Endpoints:');
    console.log('   GET  /qr/generate         - Generate QR code');
    console.log('   GET  /qr/sessions         - List QR sessions');
    console.log('   GET  /qr/session/:id      - Get QR session');
    console.log('   DELETE /qr/session/:id    - Delete QR session');
    console.log('📋 ====================================');
    console.log('👨‍💻 YouTube: @marinyamestudios');
    console.log('🐙 GitHub: @mrmosesclr');
    console.log('🚀 ====================================');
});

// ===== AUTO CLEANUP =====
// Clean up old sessions every 5 minutes
setInterval(() => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    let cleaned = 0;

    for (const [id, data] of globalSessions.pair.entries()) {
        if (now - data.timestamp > maxAge) {
            globalSessions.pair.delete(id);
            cleaned++;
        }
    }

    for (const [id, data] of globalSessions.qr.entries()) {
        if (now - data.timestamp > maxAge) {
            globalSessions.qr.delete(id);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Auto-cleaned ${cleaned} expired sessions`);
    }
}, 5 * 60 * 1000);

export default app;
