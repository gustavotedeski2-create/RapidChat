// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuração CORS
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static('uploads'));

// Criar pasta de uploads se não existir
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Configurar multer para uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não suportado'));
        }
    }
});

// Conectar MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/patochat';
mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✓ Conectado ao MongoDB');
}).catch(err => {
    console.error('✗ Erro ao conectar MongoDB:', err);
});

// ===== SCHEMAS =====

const usuarioSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, lowercase: true, minlength: 3, maxlength: 20 },
    senha: { type: String, required: true },
    criadoEm: { type: Date, default: Date.now },
    ultimaConexao: { type: Date, default: Date.now }
});

const mensagemSchema = new mongoose.Schema({
    de: { type: String, required: true },
    para: { type: String, default: 'global' },
    msg: String,
    tipo: { type: String, enum: ['texto', 'imagem'], default: 'texto' },
    imagemUrl: String,
    timestamp: { type: Date, default: Date.now }
});

const chamadaSchema = new mongoose.Schema({
    de: { type: String, required: true },
    para: { type: String, required: true },
    status: { type: String, enum: ['pendente', 'aceita', 'recusada', 'finalizada'], default: 'pendente' },
    duracao: Number,
    criadaEm: { type: Date, default: Date.now },
    finalizadaEm: Date
});

const Usuario = mongoose.model('Usuario', usuarioSchema);
const Mensagem = mongoose.model('Mensagem', mensagemSchema);
const Chamada = mongoose.model('Chamada', chamadaSchema);

// ===== FUNÇÕES AUXILIARES =====

const JWT_SECRET = process.env.JWT_SECRET || 'seu-secret-key-mude-em-producao';

function gerarToken(usuario) {
    return jwt.sign({ username: usuario }, JWT_SECRET, { expiresIn: '7d' });
}

function verificarToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

// ===== ROTAS HTTP =====

app.get('/', (req, res) => {
    res.json({ status: 'PatoChat Server rodando 🦆' });
});

// Registro
app.post('/api/registrar', async (req, res) => {
    try {
        const { username, senha } = req.body;

        if (!username || !senha) {
            return res.status(400).json({ erro: 'Username e senha obrigatórios' });
        }

        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ erro: 'Username deve ter entre 3 e 20 caracteres' });
        }

        if (senha.length < 6) {
            return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });
        }

        const usuarioExistente = await Usuario.findOne({ username: username.toLowerCase() });
        if (usuarioExistente) {
            return res.status(400).json({ erro: 'Usuário já existe' });
        }

        const senhaCriptada = await bcrypt.hash(senha, 10);
        const novoUsuario = new Usuario({
            username: username.toLowerCase(),
            senha: senhaCriptada
        });

        await novoUsuario.save();
        const token = gerarToken(username.toLowerCase());

        res.status(201).json({ 
            mensagem: 'Usuário criado com sucesso',
            token,
            username: username.toLowerCase()
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Erro ao registrar' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, senha } = req.body;

        if (!username || !senha) {
            return res.status(400).json({ erro: 'Username e senha obrigatórios' });
        }

        const usuario = await Usuario.findOne({ username: username.toLowerCase() });
        if (!usuario) {
            return res.status(401).json({ erro: 'Usuário não encontrado' });
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ erro: 'Senha incorreta' });
        }

        usuario.ultimaConexao = new Date();
        await usuario.save();

        const token = gerarToken(username.toLowerCase());
        res.json({ 
            mensagem: 'Login realizado',
            token,
            username: username.toLowerCase()
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Erro ao fazer login' });
    }
});

// Upload de imagem
app.post('/api/upload', upload.single('imagem'), (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const usuario = verificarToken(token);

        if (!usuario) {
            return res.status(401).json({ erro: 'Não autorizado' });
        }

        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
        }

        const imagemUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/uploads/${req.file.filename}`;
        res.json({ imagemUrl });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Erro ao fazer upload' });
    }
});

// Histórico de mensagens
app.get('/api/mensagens/:tipo/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const usuario = verificarToken(token);

        if (!usuario) {
            return res.status(401).json({ erro: 'Não autorizado' });
        }

        const { tipo, id } = req.params;
        let query = {};

        if (tipo === 'global') {
            query = { para: 'global' };
        } else if (tipo === 'privado') {
            const usuarios = [usuario.username, id].sort();
            query = {
                $or: [
                    { de: usuarios[0], para: usuarios[1] },
                    { de: usuarios[1], para: usuarios[0] }
                ]
            };
        }

        const mensagens = await Mensagem.find(query).sort({ timestamp: 1 }).limit(100);
        res.json(mensagens);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Erro ao buscar mensagens' });
    }
});

// ===== EVENTOS SOCKET.IO =====

io.on('connection', (socket) => {
    console.log(`[${new Date().toLocaleTimeString()}] Novo cliente: ${socket.id}`);

    let usuarioAtual = null;

    // Autenticar usuário
    socket.on('autenticar', async (dados) => {
        const { token } = dados;
        const verificado = verificarToken(token);

        if (verificado) {
            usuarioAtual = verificado.username;
            socket.username = usuarioAtual;
            socket.join(`usuario_${usuarioAtual}`);

            console.log(`✓ ${usuarioAtual} autenticado via socket`);

            // Pega histórico global e envia
            const historico = await Mensagem.find({ para: 'global' })
                .sort({ timestamp: 1 })
                .limit(50);
            
            socket.emit('carregarHistorico', {
                tipo: 'global',
                mensagens: historico
            });

            io.emit('usuario_online', { usuario: usuarioAtual });
        } else {
            socket.emit('autenticacao_falhou');
        }
    });

    // Chat global
    socket.on('chat_message', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const mensagem = new Mensagem({
                de: usuarioAtual,
                para: 'global',
                msg: dados.msg,
                tipo: 'texto',
                timestamp: new Date()
            });

            await mensagem.save();

            io.emit('chat_message', {
                _id: mensagem._id,
                de: usuarioAtual,
                msg: dados.msg,
                timestamp: mensagem.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            });

            console.log(`[GLOBAL] ${usuarioAtual}: ${dados.msg}`);
        } catch (erro) {
            console.error(erro);
        }
    });

    // Mensagem privada
    socket.on('private_message', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const { para, msg } = dados;

            const mensagem = new Mensagem({
                de: usuarioAtual,
                para: para,
                msg: msg,
                tipo: 'texto',
                timestamp: new Date()
            });

            await mensagem.save();

            const dados_envio = {
                _id: mensagem._id,
                de: usuarioAtual,
                para: para,
                msg: msg,
                timestamp: mensagem.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            };

            socket.emit('private_message', dados_envio);
            io.to(`usuario_${para}`).emit('private_message', dados_envio);

            console.log(`[PRIVADO] ${usuarioAtual} → ${para}: ${msg}`);
        } catch (erro) {
            console.error(erro);
        }
    });

    // Imagem
    socket.on('enviar_imagem', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const { para, imagemUrl } = dados;

            const mensagem = new Mensagem({
                de: usuarioAtual,
                para: para || 'global',
                tipo: 'imagem',
                imagemUrl: imagemUrl,
                timestamp: new Date()
            });

            await mensagem.save();

            const dados_envio = {
                _id: mensagem._id,
                de: usuarioAtual,
                para: para || 'global',
                tipo: 'imagem',
                imagemUrl: imagemUrl,
                timestamp: mensagem.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            };

            if (para && para !== 'global') {
                socket.emit('enviar_imagem', dados_envio);
                io.to(`usuario_${para}`).emit('enviar_imagem', dados_envio);
            } else {
                io.emit('enviar_imagem', dados_envio);
            }
        } catch (erro) {
            console.error(erro);
        }
    });

    // Iniciar chamada
    socket.on('iniciar_chamada', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const { para } = dados;

            const chamada = new Chamada({
                de: usuarioAtual,
                para: para,
                status: 'pendente'
            });

            await chamada.save();

            io.to(`usuario_${para}`).emit('chamada_recebida', {
                de: usuarioAtual,
                chamadaId: chamada._id
            });

            console.log(`[CHAMADA] ${usuarioAtual} → ${para}`);
        } catch (erro) {
            console.error(erro);
        }
    });

    // Aceitar chamada
    socket.on('aceitar_chamada', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const { chamadaId, de } = dados;

            await Chamada.findByIdAndUpdate(chamadaId, { status: 'aceita' });

            io.to(`usuario_${de}`).emit('chamada_aceita', {
                chamadaId: chamadaId,
                para: usuarioAtual
            });

            console.log(`[CHAMADA] ${usuarioAtual} aceitou chamada de ${de}`);
        } catch (erro) {
            console.error(erro);
        }
    });

    // Recusar chamada
    socket.on('recusar_chamada', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const { chamadaId, de } = dados;

            await Chamada.findByIdAndUpdate(chamadaId, { status: 'recusada' });

            io.to(`usuario_${de}`).emit('chamada_recusada', {
                chamadaId: chamadaId
            });

            console.log(`[CHAMADA] ${usuarioAtual} recusou chamada de ${de}`);
        } catch (erro) {
            console.error(erro);
        }
    });

    // WebRTC offer
    socket.on('webrtc_offer', (dados) => {
        const { para, offer } = dados;
        io.to(`usuario_${para}`).emit('webrtc_offer', {
            de: usuarioAtual,
            offer: offer
        });
    });

    // WebRTC answer
    socket.on('webrtc_answer', (dados) => {
        const { para, answer } = dados;
        io.to(`usuario_${para}`).emit('webrtc_answer', {
            de: usuarioAtual,
            answer: answer
        });
    });

    // ICE candidate
    socket.on('webrtc_ice', (dados) => {
        const { para, candidate } = dados;
        io.to(`usuario_${para}`).emit('webrtc_ice', {
            de: usuarioAtual,
            candidate: candidate
        });
    });

    // Finalizar chamada
    socket.on('finalizar_chamada', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const { chamadaId, duracao } = dados;

            await Chamada.findByIdAndUpdate(chamadaId, {
                status: 'finalizada',
                duracao: duracao,
                finalizadaEm: new Date()
            });

            io.emit('chamada_finalizada', { chamadaId });
        } catch (erro) {
            console.error(erro);
        }
    });

    // Desconexão
    socket.on('disconnect', () => {
        if (usuarioAtual) {
            console.log(`✗ ${usuarioAtual} desconectou`);
            io.emit('usuario_offline', { usuario: usuarioAtual });
        }
    });
});

// ===== INICIALIZAÇÃO =====

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🦆 PatoChat Server rodando na porta ${PORT}`);
    console.log(`Base URL: ${process.env.BASE_URL || 'http://localhost:3000'}`);
});
