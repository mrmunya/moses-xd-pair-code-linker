import { Router } from 'express';
import QRCode from 'qrcode';
import { makeWaSocket } from './whatsapp.js';
import { globalSessions } from './index.js';

const router = Router();

// ===== GENERATE QR CODE =====
router.get('/generate', async (req, res) => {
    try {
        const { sessionId, number } = req.query;
        
        // Generate a session ID if not provided
        const sessionIdToUse = sessionId || `qr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        
        // Create a new WhatsApp socket
        const sock = await makeWaSocket();
        
        // Set up QR code handler with timeout
        let qrCode = null;
        let connectionStatus = 'waiting';
        
        const qrPromise = new Promise((resolve, reject) => {
            // QR code event
            const handleQR = (qr) => {
                qrCode = qr;
                connectionStatus = 'qr_generated';
                resolve(qr);
            };
            sock.ev.on('qr', handleQR);
            
            // Connection update event
            const handleConnection = (update) => {
                if (update.connection === 'open') {
                    connectionStatus = 'connected';
                    resolve(null); // Resolve with null if already connected
                }
                if (update.connection === 'close') {
                    connectionStatus = 'closed';
                    reject(new Error('Connection closed'));
                }
            };
            sock.ev.on('connection.update', handleConnection);
            
            // Timeout after 60 seconds
            const timeout = setTimeout(() => {
                sock.ev.off('qr', handleQR);
                sock.ev.off('connection.update', handleConnection);
                if (!qrCode) {
                    reject(new Error('QR code generation timeout. Please try again.'));
                }
            }, 60000);
            
            // Cleanup on resolve
            const originalResolve = resolve;
            resolve = (value) => {
                clearTimeout(timeout);
                sock.ev.off('qr', handleQR);
                sock.ev.off('connection.update', handleConnection);
                originalResolve(value);
            };
        });

        // Wait for QR code or timeout
        const qr = await qrPromise;
        
        // If already connected or no QR
        if (!qr) {
            return res.json({
                success: true,
                sessionId: sessionIdToUse,
                status: connectionStatus,
                message: 'Already connected to WhatsApp!',
                connected: true
            });
        }

        // Generate QR code image
        const qrImage = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 400
        });
        
        // Store session in global sessions
        globalSessions.qr.set(sessionIdToUse, {
            qr: qr,
            qrImage: qrImage,
            timestamp: Date.now(),
            sock: sock,
            status: 'qr_generated',
            type: 'qr',
            number: number || 'N/A',
            createdAt: new Date().toISOString()
        });

        // Store in local sessions if available
        if (globalSessions.sessionSuccess) {
            globalSessions.sessionSuccess.set(sessionIdToUse, {
                id: sessionIdToUse,
                type: 'qr',
                number: number || 'N/A',
                createdAt: new Date().toISOString(),
                status: 'active'
            });
        }

        res.json({
            success: true,
            sessionId: sessionIdToUse,
            qrImage: qrImage,
            qrString: qr,
            status: 'qr_generated',
            message: '✅ QR Code generated successfully!',
            instructions: 'Open WhatsApp > Linked Devices > Link with QR code and scan this code',
            viewPage: `/session-success/${sessionIdToUse}?number=${number || 'N/A'}&type=qr`,
            channels: {
                telegram: 'https://t.me/marinyametech',
                youtube: 'https://youtube.com/@marinyametech',
                website: 'https://Marinyame.zone.id'
            },
            warning: 'Do NOT share your QR code or session ID with anyone.'
        });

    } catch (error) {
        console.error('QR generation error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate QR code',
            error: error.message
        });
    }
});

// ===== GENERATE QR CODE WITH REDIRECT =====
router.get('/generate-redirect', async (req, res) => {
    try {
        const { number } = req.query;
        
        // Generate session ID
        const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        
        // Create WhatsApp socket
        const sock = await makeWaSocket();
        
        // Set up QR handler
        let qrCode = null;
        let qrPromise = new Promise((resolve) => {
            const handleQR = (qr) => {
                qrCode = qr;
                resolve(qr);
            };
            sock.ev.on('qr', handleQR);
            
            setTimeout(() => {
                sock.ev.off('qr', handleQR);
                if (!qrCode) {
                    resolve(null);
                }
            }, 30000);
        });

        const qr = await qrPromise;
        
        if (!qr) {
            return res.status(404).json({
                success: false,
                message: 'QR code not available. Please try again.'
            });
        }

        // Generate QR image
        const qrImage = await QRCode.toDataURL(qr);
        
        // Store session
        globalSessions.qr.set(sessionId, {
            qr: qr,
            qrImage: qrImage,
            timestamp: Date.now(),
            sock: sock,
            status: 'qr_generated',
            type: 'qr',
            number: number || 'N/A'
        });

        // Redirect to session success page
        res.redirect(`/session-success/${sessionId}?number=${number || 'N/A'}&type=qr`);

    } catch (error) {
        console.error('QR redirect error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== GET QR CODE IMAGE DIRECTLY =====
router.get('/image/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = globalSessions.qr.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        if (!session.qrImage) {
            // Regenerate QR if needed
            const qrImage = await QRCode.toDataURL(session.qr, {
                errorCorrectionLevel: 'H',
                margin: 2,
                width: 400
            });
            session.qrImage = qrImage;
            globalSessions.qr.set(sessionId, session);
        }

        // Send as image
        res.setHeader('Content-Type', 'image/png');
        const imgBuffer = Buffer.from(session.qrImage.split(',')[1], 'base64');
        res.send(imgBuffer);

    } catch (error) {
        console.error('QR image error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== GET ALL QR SESSIONS =====
router.get('/sessions', (req, res) => {
    try {
        const sessions = Array.from(globalSessions.qr.entries()).map(([id, data]) => ({
            sessionId: id,
            type: 'qr',
            number: data.number || 'N/A',
            status: data.status || 'active',
            timestamp: data.timestamp,
            createdAt: data.createdAt || new Date(data.timestamp).toISOString(),
            age: Math.floor((Date.now() - (data.timestamp || Date.now())) / 1000),
            hasQR: !!data.qr
        }));
        
        res.json({
            success: true,
            count: sessions.length,
            sessions: sessions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== GET SPECIFIC QR SESSION =====
router.get('/session/:id', (req, res) => {
    try {
        const { id } = req.params;
        const session = globalSessions.qr.get(id);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.json({
            success: true,
            session: {
                sessionId: id,
                type: 'qr',
                number: session.number || 'N/A',
                status: session.status,
                timestamp: session.timestamp,
                createdAt: session.createdAt || new Date(session.timestamp).toISOString(),
                hasQR: !!session.qr
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== DELETE QR SESSION =====
router.delete('/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const session = globalSessions.qr.get(id);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        // Close socket if exists
        if (session.sock) {
            try {
                await session.sock.logout();
                await session.sock.end();
                await session.sock.destroy();
            } catch (error) {
                console.error('Error closing QR session socket:', error);
            }
        }

        // Delete session folder if exists
        const sessionPath = path.join(__dirname, 'sessions', id);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        globalSessions.qr.delete(id);
        
        res.json({
            success: true,
            message: '✅ QR Session deleted successfully',
            sessionId: id,
            deletedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error deleting QR session:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== CHECK QR STATUS =====
router.get('/status/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = globalSessions.qr.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.json({
            success: true,
            sessionId: sessionId,
            status: session.status || 'unknown',
            hasQR: !!session.qr,
            timestamp: session.timestamp,
            age: Math.floor((Date.now() - session.timestamp) / 1000)
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===== REGENERATE QR CODE =====
router.post('/regenerate/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = globalSessions.qr.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        // Generate new QR code
        const newQR = await QRCode.toDataURL(session.qr, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 400
        });

        session.qrImage = newQR;
        session.timestamp = Date.now();
        session.status = 'regenerated';
        globalSessions.qr.set(sessionId, session);

        res.json({
            success: true,
            message: 'QR Code regenerated successfully',
            sessionId: sessionId,
            qrImage: newQR
        });

    } catch (error) {
        console.error('Regenerate QR error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

export default router;
