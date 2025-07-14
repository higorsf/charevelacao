// server.js (Versão Final Corrigida)

// Importações necessárias
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Configuração básica do servidor
const app = express();
const PORT = 3000;

// Caminhos para os arquivos de dados
const DATA_DIR = path.join(__dirname, 'data');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const RESULT_FILE = path.join(DATA_DIR, 'result.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Garante que as pastas de dados e uploads existam
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Middleware para servir arquivos estáticos (HTML, CSS, JS do cliente)
app.use(express.static(path.join(__dirname, 'public')));
// Middleware para servir as imagens enviadas
app.use('/uploads', express.static(UPLOADS_DIR));
// Middleware para interpretar o corpo das requisições como JSON
app.use(express.json());
// Middleware para interpretar formulários
app.use(express.urlencoded({ extended: true }));

// Configuração do Multer para upload de fotos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- Funções Auxiliares para ler/escrever JSON ---
const readJsonFile = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = fs.readFileSync(filePath);
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
};

const writeJsonFile = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// --- ROTAS DA API ---

// Rota para enviar um palpite e mensagem
app.post('/submit', upload.single('photo'), (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE) || [];
    const newSubmission = {
        id: Date.now(),
        name: req.body.name,
        email: req.body.email,
        message: req.body.message,
        genderGuess: req.body.gender,
        photo: req.file ? `/uploads/${req.file.filename}` : null,
        timestamp: new Date().toISOString()
    };
    messages.push(newSubmission);
    writeJsonFile(MESSAGES_FILE, messages);
    res.status(201).json({ success: true, message: 'Obrigado pelo seu carinho!' });
});

// Rota para obter as estatísticas dos palpites
app.get('/stats', (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE) || [];
    const stats = {
        boy: messages.filter(m => m.genderGuess === 'boy').length,
        girl: messages.filter(m => m.genderGuess === 'girl').length
    };
    res.json(stats);
});

// Rota para obter todas as mensagens para o carrossel
app.get('/messages', (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE) || [];
    // Retorna as mensagens em ordem inversa (as mais novas primeiro)
    res.json(messages.reverse());
});

// Rota para obter o resultado final
app.get('/result', (req, res) => {
    const result = readJsonFile(RESULT_FILE);
    res.json(result);
});

// Rota para login do administrador
app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;
    const adminData = readJsonFile(ADMIN_FILE);

    if (adminData && adminData.username === username && adminData.password === password) {
        res.json({ success: true, firstLogin: adminData.firstLogin });
    } else {
        res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }
});

// Rota para o admin trocar a senha
app.post('/change-password', (req, res) => {
    const { newPassword } = req.body;
    const adminData = readJsonFile(ADMIN_FILE);
    if (adminData) {
        adminData.password = newPassword;
        adminData.firstLogin = false;
        writeJsonFile(ADMIN_FILE, adminData);
        res.json({ success: true, message: 'Senha alterada com sucesso!' });
    } else {
        res.status(500).json({ success: false, message: 'Erro ao alterar a senha.' });
    }
});

// Rota para o admin definir o resultado
app.post('/set-result', (req, res) => {
    const { result } = req.body;
    writeJsonFile(RESULT_FILE, { result });
    res.json({ success: true, message: 'Resultado salvo com sucesso!' });
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
