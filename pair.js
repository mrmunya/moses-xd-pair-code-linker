import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Store active sessions
const sessions = new Map();

// ===== DELETE SESSION ROUTE =====
router.delete('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Check if session exists
        if (!sessions.has(sessionId)) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        const session = sessions.get(sessionId);
        const sessionPath = path.join(__dirname, 'sessions', sessionId);

        // Close socket connection if exists
        if (session.socket) {
            try {
                await session.socket.end();
                await session.socket.destroy();
            } catch (error) {
                console.error('Error closing socket:', error);
            }
        }

        // Delete session folder
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        
        // Remove from sessions map
        sessions.delete(sessionId);

        res.json({
            success: true,
            message: '✅ Session deleted successfully',
            sessionId: sessionId,
            deletedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting session',
            error: error.message
        });
    }
});

// ===== SESSION SUCCESS RESPONSE =====
router.post('/session-success', (req, res) => {
    try {
        const { sessionId, type = 'pair', number } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required'
            });
        }

        const successMessage = `
✅ *SESSION ID OBTAINED SUCCESSFULLY!*  

📁 Save and upload the *SESSION_ID* (text) to the \`session\` folder as \`creds.json\`, or add it to your \`.env\` file like this:  
\`SESSION_ID=${sessionId}\`

📢 *Stay Updated — Follow Our Channels:*

➊ *Telegram*  
https://t.me/marinyametech

➋ *YouTube*  
https://youtube.com/@marinyametech

🚫 *Do NOT share your session ID or creds.json with anyone.*

🌐 *Explore more tools on our website:*  
https://Marinyame.zone.id
        `;

        // Store session info
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
                id: sessionId,
                type: type,
                number: number || 'N/A',
                createdAt: new Date().toISOString(),
                status: 'active'
            });
        }

        res.json({
            success: true,
            sessionId: sessionId,
            message: successMessage,
            instructions: {
                step1: 'Save the Session ID',
                step2: 'Create creds.json file in session folder',
                step3: 'Add SESSION_ID to .env file',
                step4: 'Keep your session secure'
            },
            channels: {
                telegram: 'https://t.me/marinyametech',
                youtube: 'https://youtube.com/@marinyametech',
                website: 'https://Marinyame.zone.id'
            },
            warning: 'Do NOT share your session ID or creds.json with anyone.'
        });

    } catch (error) {
        console.error('Error in session success:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing session success',
            error: error.message
        });
    }
});

// ===== SESSION SUCCESS HTML PAGE =====
router.get('/session-success/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { number } = req.query;

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Session Success - Marinyame Tech</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 600px;
            width: 100%;
            animation: slideIn 0.5s ease-out;
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .success-icon {
            text-align: center;
            font-size: 60px;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 20px;
            font-size: 28px;
        }
        .session-id-box {
            background: #f8f9fa;
            border: 2px dashed #667eea;
            border-radius: 10px;
            padding: 15px;
            text-align: center;
            margin: 20px 0;
            font-family: monospace;
            font-size: 18px;
            word-break: break-all;
        }
        .session-id-box .label {
            font-size: 14px;
            color: #888;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .session-id-box .id {
            font-size: 20px;
            color: #333;
            font-weight: bold;
            margin-top: 8px;
            display: block;
        }
        .message {
            background: #f0fdf4;
            border: 1px solid #86efac;
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
            white-space: pre-wrap;
            font-size: 14px;
            line-height: 1.8;
        }
        .channels {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
        }
        .channels h3 {
            margin-bottom: 15px;
            color: #333;
        }
        .channels a {
            display: block;
            padding: 12px;
            margin: 8px 0;
            background: white;
            border-radius: 8px;
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s;
            border: 1px solid #e0e0e0;
        }
        .channels a:hover {
            transform: translateX(5px);
            border-color: #667eea;
            box-shadow: 0 2px 10px rgba(102, 126, 234, 0.2);
        }
        .channels a .emoji {
            margin-right: 10px;
        }
        .warning {
            background: #fef2f2;
            border: 1px solid #fca5a5;
            border-radius: 10px;
            padding: 15px;
            color: #991b1b;
            text-align: center;
            margin: 20px 0;
            font-weight: 600;
        }
        .buttons {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        .copy-btn, .download-btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .copy-btn {
            background: #667eea;
            color: white;
        }
        .copy-btn:hover {
            background: #5a67d8;
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
        }
        .download-btn {
            background: #28a745;
            color: white;
        }
        .download-btn:hover {
            background: #218838;
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(40, 167, 69, 0.4);
        }
        .footer {
            text-align: center;
            margin-top: 20px;
            color: #888;
            font-size: 13px;
            line-height: 1.6;
        }
        .footer a {
            color: #667eea;
            text-decoration: none;
        }
        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #333;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            display: none;
            animation: slideUp 0.3s ease-out;
            z-index: 1000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        @keyframes slideUp {
            from { transform: translate(-50%, 100px); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
        }
        .toast.show { display: block; }
        .phone-number {
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-bottom: 15px;
        }
        .phone-number strong {
            color: #333;
        }
        @media (max-width: 480px) {
            .container { padding: 20px; }
            h1 { font-size: 22px; }
            .buttons { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>SESSION ID OBTAINED SUCCESSFULLY!</h1>
        
        ${number ? `<div class="phone-number">📱 Phone: <strong>${number}</strong></div>` : ''}
        
        <div class="session-id-box">
            <div class="label">📁 Session ID</div>
            <span class="id" id="sessionId">${sessionId}</span>
        </div>

        <div class="message">
📁 Save and upload the <strong>SESSION_ID</strong> (text) to the <code>session</code> folder as <code>creds.json</code>, or add it to your <code>.env</code> file like this:

<code style="display: block; background: #f8f9fa; padding: 10px; border-radius: 5px; margin-top: 8px; word-break: break-all;">
SESSION_ID=${sessionId}
</code>
        </div>

        <div class="channels">
            <h3>📢 Stay Updated — Follow Our Channels:</h3>
            <a href="https://t.me/marinyametech" target="_blank">
                <span class="emoji">➊</span> Telegram
            </a>
            <a href="https://youtube.com/@marinyametech" target="_blank">
                <span class="emoji">➋</span> YouTube
            </a>
            <a href="https://Marinyame.zone.id" target="_blank">
                <span class="emoji">🌐</span> Website
            </a>
        </div>

        <div class="warning">
            🚫 Do NOT share your session ID or creds.json with anyone.
        </div>

        <div class="buttons">
            <button class="copy-btn" onclick="copySessionId()">📋 Copy Session ID</button>
            <button class="download-btn" onclick="downloadSession()">💾 Download Session</button>
        </div>

        <div class="footer">
            <p>🚀 Marinyame Tech © 2024</p>
            <p style="font-size: 12px; margin-top: 5px;">
                <a href="/">Home</a> • 
                <a href="/pair">Pair Device</a> • 
                <a href="/qr">QR Code</a>
            </p>
        </div>
    </div>

    <div id="toast" class="toast"></div>

    <script>
        function copySessionId() {
            const sessionId = document.getElementById('sessionId').textContent;
            navigator.clipboard.writeText(sessionId).then(() => {
                showToast('✅ Session ID copied to clipboard!');
            }).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = sessionId;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('✅ Session ID copied to clipboard!');
            });
        }

        function downloadSession() {
            const sessionId = document.getElementById('sessionId').textContent;
            const content = JSON.stringify({
                sessionId: sessionId,
                createdAt: new Date().toISOString(),
                type: '${req.query.type || 'pair'}',
                number: '${number || ''}'
            }, null, 2);
            
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`session_\${sessionId}.json\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('📥 Session file downloaded!');
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('show');
            clearTimeout(toast.timeout);
            toast.timeout = setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                copySessionId();
                e.preventDefault();
            }
        });
    </script>
</body>
</html>
        `;

        res.send(html);

    } catch (error) {
        console.error('Error generating HTML page:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating session page',
            error: error.message
        });
    }
});

// ===== GET ALL SESSIONS =====
router.get('/sessions', (req, res) => {
    try {
        const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
            sessionId: id,
            type: data.type || 'unknown',
            number: data.number || 'N/A',
            status: data.status || 'active',
            createdAt: data.createdAt,
            age: Math.floor((Date.now() - new Date(data.createdAt).getTime()) / 1000)
        }));

        res.json({
            success: true,
            total: sessionList.length,
            sessions: sessionList
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching sessions',
            error: error.message
        });
    }
});

// ===== GET SESSION DETAILS =====
router.get('/session/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessions.has(sessionId)) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        const session = sessions.get(sessionId);
        res.json({
            success: true,
            session: {
                sessionId: sessionId,
                ...session
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching session',
            error: error.message
        });
    }
});

// ===== CLEANUP ON EXIT =====
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    let closedSessions = 0;
    
    for (const [sid, session] of sessions) {
        if (session.socket) {
            try {
                await session.socket.end();
                await session.socket.destroy();
                closedSessions++;
            } catch (error) {
                console.error(`Error closing session ${sid}:`, error);
            }
        }
    }
    
    console.log(`✅ Closed ${closedSessions} sessions`);
    console.log('👋 Goodbye!');
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
        console.log('⚠️ Ignored error:', e.substring(0, 100));
        return;
    }
    
    console.error('🔥 Uncaught exception:', err);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    const e = String(reason);
    const ignoreErrors = [
        'conflict',
        'not-authorized',
        'Socket connection timeout',
        'rate-overlimit'
    ];
    
    if (ignoreErrors.some(ignore => e.includes(ignore))) {
        console.log('⚠️ Ignored rejection:', e.substring(0, 100));
        return;
    }
    
    console.error('⚠️ Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

// ===== AUTO CLEANUP EXPIRED SESSIONS =====
setInterval(() => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    let cleaned = 0;

    for (const [id, data] of sessions.entries()) {
        const createdAt = new Date(data.createdAt).getTime();
        if (now - createdAt > maxAge) {
            // Close socket if exists
            if (data.socket) {
                try {
                    data.socket.end();
                    data.socket.destroy();
                } catch (error) {
                    // Ignore errors
                }
            }
            sessions.delete(id);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Auto-cleaned ${cleaned} expired sessions`);
    }
}, 5 * 60 * 1000);

export default router;
