// server.js (Com Sinalização Reforçada v3)

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

wss.on('connection', ws => {
    const id = crypto.randomUUID();
    ws.id = id;
    console.log(`Cliente WebSocket conectado com ID: ${id}`);
    
    ws.on('message', message => {
        let parsedMessage;
        try { parsedMessage = JSON.parse(message); } 
        catch (e) { return console.error("Mensagem inválida:", message); }

        switch (parsedMessage.type) {
            case 'broadcaster':
                broadcaster = ws;
                console.log(`Transmissor definido com ID: ${ws.id}`);
                // **CORREÇÃO**: Notifica o novo transmissor sobre todos os espectadores já existentes.
                watchers.forEach((watcherWs, watcherId) => {
                    console.log(`Notificando transmissor sobre espectador existente: ${watcherId}`);
                    broadcaster.send(JSON.stringify({ type: 'watcher', id: watcherId }));
                });
                break;
            case 'watcher':
                watchers.set(ws.id, ws);
                console.log(`Espectador [${ws.id}] registrado. Notificando transmissor se estiver ativo.`);
                // Notifica o transmissor (se ele já estiver conectado).
                if (broadcaster) {
                    broadcaster.send(JSON.stringify({ type: 'watcher', id: ws.id }));
                }
                break;
            case 'offer':
                const watcherToOffer = watchers.get(parsedMessage.toId);
                if (watcherToOffer) {
                    // Repassa a oferta do transmissor para o espectador específico.
                    watcherToOffer.send(JSON.stringify({ type: 'offer', sdp: parsedMessage.sdp, fromId: ws.id }));
                }
                break;
            case 'answer':
                // Repassa a resposta do espectador para o transmissor.
                if (broadcaster) {
                    broadcaster.send(JSON.stringify({ type: 'answer', sdp: parsedMessage.sdp, fromId: ws.id }));
                }
                break;
            case 'iceCandidate':
                const targetId = parsedMessage.toId;
                const targetIsBroadcaster = targetId === broadcaster?.id;
                const targetWs = targetIsBroadcaster ? broadcaster : watchers.get(targetId);
                if (targetWs) {
                    // Repassa o ICE Candidate para o destino correto (transmissor ou espectador).
                    targetWs.send(JSON.stringify({ type: 'iceCandidate', candidate: parsedMessage.candidate, fromId: ws.id }));
                }
                break;
            case 'join':
                const requestedName = parsedMessage.name.trim();
                if (activeChatUsers.has(requestedName)) {
                    ws.send(JSON.stringify({ type: 'join-error', text: 'Este nome já está em uso.' }));
                } else if (requestedName.length < 2) {
                    ws.send(JSON.stringify({ type: 'join-error', text: 'O nome precisa ter pelo menos 2 caracteres.' }));
                } else {
                    ws.username = requestedName;
                    activeChatUsers.add(ws.username);
                    ws.send(JSON.stringify({ type: 'join-success' }));
                    console.log(`Usuário '${ws.username}' entrou no chat.`);
                }
                break;
            case 'chat':
                if (ws.username) {
                    const chatMessage = { type: 'chat', sender: ws.username, text: parsedMessage.text };
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(chatMessage));
                    });
                }
                break;
            case 'end-live':
                 wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'end-live' }));
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Cliente [${ws.id}] (username: ${ws.username}) desconectou.`);
        if (ws.username) activeChatUsers.delete(ws.username);

        // **MELHORIA**: Lógica de desconexão mais robusta.
        if (ws === broadcaster) {
            console.log('O transmissor desconectou. Encerrando a live para todos.');
            broadcaster = null;
            // Notifica todos os espectadores que a live acabou.
            watchers.forEach(watcher => {
                watcher.send(JSON.stringify({ type: 'end-live' }));
            });
        } else if (watchers.has(ws.id)) {
            const watcherId = ws.id;
            watchers.delete(watcherId);
            console.log(`O espectador [${watcherId}] desconectou.`);
            // Notifica o transmissor para que ele possa limpar a conexão.
            if (broadcaster) {
                broadcaster.send(JSON.stringify({ type: 'watcher-disconnected', id: watcherId }));
            }
        }
    });
    ws.on('error', error => console.error(`Erro no WebSocket [${ws.id}]:`, error));
});

// O resto do seu código permanece igual...
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