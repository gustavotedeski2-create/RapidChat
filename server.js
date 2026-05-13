// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
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

// ===== CONFIGURAÇÃO POSTGRESQL =====

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (err) => {
    console.error('Erro no pool de conexão:', err);
});

pool.on('connect', () => {
    console.log('✓ Conectado ao PostgreSQL');
});

// ===== CRIAR TABELAS =====

async function criarTabelas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) UNIQUE NOT NULL,
                senha VARCHAR(255) NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultima_conexao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensagens (
                id SERIAL PRIMARY KEY,
                de VARCHAR(20) NOT NULL,
                para VARCHAR(20) DEFAULT 'global',
                msg TEXT,
                tipo VARCHAR(20) DEFAULT 'texto',
                imagem_url VARCHAR(500),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS chamadas (
                id SERIAL PRIMARY KEY,
                de VARCHAR(20) NOT NULL,
                para VARCHAR(20) NOT NULL,
                status VARCHAR(20) DEFAULT 'pendente',
                duracao INTEGER,
                criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finalizada_em TIMESTAMP
            )
        `);

        console.log('✓ Tabelas criadas/verificadas');
    } catch (erro) {
        console.error('Erro ao criar tabelas:', erro);
    }
}

criarTabelas();

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

        // Verificar se usuário já existe
        const usuarioExistente = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1',
            [username.toLowerCase()]
        );

        if (usuarioExistente.rows.length > 0) {
            return res.status(400).json({ erro: 'Usuário já existe' });
        }

        const senhaCriptada = await bcrypt.hash(senha, 10);
        
        await pool.query(
            'INSERT INTO usuarios (username, senha) VALUES ($1, $2)',
            [username.toLowerCase(), senhaCriptada]
        );

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

        const resultado = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1',
            [username.toLowerCase()]
        );

        if (resultado.rows.length === 0) {
            return res.status(401).json({ erro: 'Usuário não encontrado' });
        }

        const usuario = resultado.rows[0];
        const senhaValida = await bcrypt.compare(senha, usuario.senha);

        if (!senhaValida) {
            return res.status(401).json({ erro: 'Senha incorreta' });
        }

        // Atualizar última conexão
        await pool.query(
            'UPDATE usuarios SET ultima_conexao = CURRENT_TIMESTAMP WHERE id = $1',
            [usuario.id]
        );

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
        let query;
        let params;

        if (tipo === 'global') {
            query = 'SELECT * FROM mensagens WHERE para = $1 ORDER BY timestamp ASC LIMIT 100';
            params = ['global'];
        } else if (tipo === 'privado') {
            const usuarios = [usuario.username, id].sort();
            query = `
                SELECT * FROM mensagens 
                WHERE (de = $1 AND para = $2) OR (de = $2 AND para = $1)
                ORDER BY timestamp ASC LIMIT 100
            `;
            params = [usuarios[0], usuarios[1]];
        }

        const resultado = await pool.query(query, params);
        res.json(resultado.rows);
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
            try {
                const resultado = await pool.query(
                    'SELECT * FROM mensagens WHERE para = $1 ORDER BY timestamp ASC LIMIT 50',
                    ['global']
                );
                
                socket.emit('carregarHistorico', {
                    tipo: 'global',
                    mensagens: resultado.rows
                });
            } catch (err) {
                console.error('Erro ao buscar histórico:', err);
            }

            io.emit('usuario_online', { usuario: usuarioAtual });
        } else {
            socket.emit('autenticacao_falhou');
        }
    });

    // Chat global
    socket.on('chat_message', async (dados) => {
        if (!usuarioAtual) return;

        try {
            const resultado = await pool.query(
                'INSERT INTO mensagens (de, para, msg, tipo, timestamp) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *',
                [usuarioAtual, 'global', dados.msg, 'texto']
            );

            const mensagem = resultado.rows[0];

            io.emit('chat_message', {
                id: mensagem.id,
                de: usuarioAtual,
                msg: dados.msg,
                timestamp: new Date(mensagem.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

            const resultado = await pool.query(
                'INSERT INTO mensagens (de, para, msg, tipo, timestamp) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *',
                [usuarioAtual, para, msg, 'texto']
            );

            const mensagem = resultado.rows[0];

            const dados_envio = {
                id: mensagem.id,
                de: usuarioAtual,
                para: para,
                msg: msg,
                timestamp: new Date(mensagem.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

            const resultado = await pool.query(
                'INSERT INTO mensagens (de, para, tipo, imagem_url, timestamp) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *',
                [usuarioAtual, para || 'global', 'imagem', imagemUrl]
            );

            const mensagem = resultado.rows[0];

            const dados_envio = {
                id: mensagem.id,
                de: usuarioAtual,
                para: para || 'global',
                tipo: 'imagem',
                imagemUrl: imagemUrl,
                timestamp: new Date(mensagem.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

            const resultado = await pool.query(
                'INSERT INTO chamadas (de, para, status, criada_em) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *',
                [usuarioAtual, para, 'pendente']
            );

            const chamada = resultado.rows[0];

            io.to(`usuario_${para}`).emit('chamada_recebida', {
                de: usuarioAtual,
                chamadaId: chamada.id
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

            await pool.query(
                'UPDATE chamadas SET status = $1 WHERE id = $2',
                ['aceita', chamadaId]
            );

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

            await pool.query(
                'UPDATE chamadas SET status = $1 WHERE id = $2',
                ['recusada', chamadaId]
            );

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

            await pool.query(
                'UPDATE chamadas SET status = $1, duracao = $2, finalizada_em = CURRENT_TIMESTAMP WHERE id = $3',
                ['finalizada', duracao, chamadaId]
            );

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
