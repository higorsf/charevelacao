// server.js (Com contador de espectadores e melhorias)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const activeChatUsers = new Set();
let broadcaster = null;
const watchers = new Map();

// Nova função para notificar o admin sobre a contagem
const broadcastViewerCount = () => {
    if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
        broadcaster.send(JSON.stringify({ type: 'viewer-count', count: watchers.size }));
    }
};

wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID();
    console.log(`Cliente conectado: ${ws.id}`);

    ws.on('message', (message) => {
        let parsed;
        try {
            parsed = JSON.parse(message);
        } catch {
            console.error('Mensagem inválida:', message);
            return;
        }

        switch (parsed.type) {
            case 'broadcaster':
                broadcaster = ws;
                console.log(`Transmissor definido: ${ws.id}`);
                watchers.forEach((watcherWs, watcherId) => {
                    broadcaster.send(JSON.stringify({ type: 'watcher', id: watcherId }));
                });
                broadcastViewerCount(); // Envia contagem inicial
                break;

            case 'watcher':
                watchers.set(ws.id, ws);
                console.log(`Espectador registrado: ${ws.id}`);
                if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
                    broadcaster.send(JSON.stringify({ type: 'watcher', id: ws.id }));
                }
                broadcastViewerCount(); // Atualiza contagem
                break;

            case 'offer': {
                const watcherWs = watchers.get(parsed.toId);
                if (watcherWs && watcherWs.readyState === WebSocket.OPEN) {
                    watcherWs.send(JSON.stringify({ type: 'offer', sdp: parsed.sdp, fromId: ws.id }));
                }
                break;
            }

            case 'answer':
                if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
                    broadcaster.send(JSON.stringify({ type: 'answer', sdp: parsed.sdp, fromId: ws.id }));
                }
                break;

            case 'iceCandidate': {
                const targetId = parsed.toId;
                // Ajuste para garantir que o alvo pode ser o broadcaster
                const targetWs = (broadcaster && broadcaster.id === targetId) ? broadcaster : watchers.get(targetId);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({ type: 'iceCandidate', candidate: parsed.candidate, fromId: ws.id }));
                }
                break;
            }
            
            case 'chat':
                if (ws.username) {
                    const chatMsg = { type: 'chat', sender: ws.username, text: parsed.text };
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(chatMsg));
                    });
                }
                break;

            case 'join':
                const name = parsed.name.trim();
                if (activeChatUsers.has(name)) {
                    ws.send(JSON.stringify({ type: 'join-error', text: 'Este nome já está em uso.' }));
                } else if (name.length < 2) {
                    ws.send(JSON.stringify({ type: 'join-error', text: 'O nome precisa ter pelo menos 2 caracteres.' }));
                } else {
                    ws.username = name;
                    activeChatUsers.add(name);
                    ws.send(JSON.stringify({ type: 'join-success', name: ws.username }));
                    console.log(`Usuário entrou no chat: ${name}`);
                }
                break;

            case 'end-live':
                // Notifica todos que live acabou
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'end-live' }));
                    }
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Cliente desconectou: ${ws.id} (username: ${ws.username})`);
        if (ws.username) activeChatUsers.delete(ws.username);

        if (ws === broadcaster) {
            broadcaster = null;
            console.log('Transmissor desconectou. Encerrando live.');
            watchers.forEach(watcher => {
                if (watcher.readyState === WebSocket.OPEN) {
                    watcher.send(JSON.stringify({ type: 'end-live' }));
                }
            });
            watchers.clear();
        } else if (watchers.has(ws.id)) {
            watchers.delete(ws.id);
            if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
                broadcaster.send(JSON.stringify({ type: 'watcher-disconnected', id: ws.id }));
            }
            broadcastViewerCount(); // Atualiza contagem
        }
    });

    ws.on('error', (err) => console.error(`Erro WS [${ws.id}]:`, err));
});

// O resto do seu código (rotas express, multer, etc.) permanece exatamente igual.
// ... (copie e cole o resto do seu server.js aqui)
const DATA_DIR = path.join(__dirname, 'data');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const RESULT_FILE = path.join(DATA_DIR, 'result.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
const readJsonFile = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath)); } catch (error) { return null; }
};
const writeJsonFile = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};
app.post('/verify-live-password', (req, res) => {
    const { password } = req.body;
    const adminData = readJsonFile(ADMIN_FILE);
    if (adminData && adminData.livePassword === password) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Senha da live incorreta.' });
    }
});
app.post('/submit', upload.single('photo'), (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE) || [];
    const newSubmission = { id: Date.now(), name: req.body.name, email: req.body.email, message: req.body.message, genderGuess: req.body.gender, photo: req.file ? `/uploads/${req.file.filename}` : null, timestamp: new Date().toISOString() };
    messages.push(newSubmission);
    writeJsonFile(MESSAGES_FILE, messages);
    res.status(201).json({ success: true, message: 'Obrigado pelo seu carinho!' });
});
app.get('/stats', (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE) || [];
    res.json({ boy: messages.filter(m => m.genderGuess === 'boy').length, girl: messages.filter(m => m.genderGuess === 'girl').length });
});
app.get('/messages', (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE) || [];
    res.json(messages.reverse());
});
app.get('/result', (req, res) => {
    res.json(readJsonFile(RESULT_FILE));
});
app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;
    const adminData = readJsonFile(ADMIN_FILE);
    if (adminData && adminData.username === username && adminData.password === password) {
        res.json({ success: true, firstLogin: adminData.firstLogin });
    } else {
        res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }
});
app.post('/change-password', (req, res) => {
    const { newPassword } = req.body;
    const adminData = readJsonFile(ADMIN_FILE);
    if (adminData) {
        adminData.password = newPassword;
        adminData.firstLogin = false;
        writeJsonFile(ADMIN_FILE, adminData);
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false });
    }
});
app.post('/set-result', (req, res) => {
    writeJsonFile(RESULT_FILE, { result: req.body.result });
    res.json({ success: true });
});
server.listen(PORT, () => {
    console.log(`Servidor HTTP e WebSocket a correr em http://localhost:${PORT}`);
});