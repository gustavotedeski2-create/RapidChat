// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Estado do servidor
const usuariosConectados = new Map();
const mensagensGlobal = [];
const mensagensPrivadas = new Map();

// ROTAS HTTP
app.get('/', (req, res) => {
    res.json({ 
        status: 'PatoChat Server rodando 🦆',
        usuarios: usuariosConectados.size
    });
});

app.get('/usuarios', (req, res) => {
    const usuarios = Array.from(usuariosConectados.values());
    res.json(usuarios);
});

// EVENTOS SOCKET.IO
io.on('connection', (socket) => {
    console.log(`[${new Date().toLocaleTimeString()}] Novo cliente conectado: ${socket.id}`);

    // Evento: Usuário se conecta
    socket.on('user_connected', (dados) => {
        const usuario = dados.user;
        usuariosConectados.set(socket.id, usuario);

        console.log(`[${new Date().toLocaleTimeString()}] ${usuario} entrou no chat`);
        console.log(`Total de usuários: ${usuariosConectados.size}`);

        // Notifica todos sobre os usuários online
        io.emit('usuarios_conectados', Array.from(usuariosConectados.values()));
        io.emit('user_list', Array.from(usuariosConectados.values()));

        // Envia histórico global para o novo usuário
        socket.emit('chat_history', mensagensGlobal);
    });

    // Evento: Chat global
    socket.on('chat message', (dados) => {
        const mensagem = {
            id: Date.now(),
            user: dados.user,
            msg: dados.msg,
            tipo: 'global',
            timestamp: dados.timestamp || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            data: new Date().toISOString()
        };

        mensagensGlobal.push(mensagem);

        // Limita histórico a últimas 100 mensagens
        if (mensagensGlobal.length > 100) {
            mensagensGlobal.shift();
        }

        console.log(`[GLOBAL] ${dados.user}: ${dados.msg}`);

        // Envia para todos
        io.emit('chat message', mensagem);
    });

    // Evento: Chat privado
    socket.on('private message', (dados) => {
        const { de, para, msg, timestamp } = dados;
        const chaveChat = [de, para].sort().join('_');

        const mensagem = {
            id: Date.now(),
            de: de,
            para: para,
            msg: msg,
            tipo: 'privado',
            timestamp: timestamp || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            data: new Date().toISOString()
        };

        // Armazena no cache (pode ser banco de dados depois)
        if (!mensagensPrivadas.has(chaveChat)) {
            mensagensPrivadas.set(chaveChat, []);
        }
        mensagensPrivadas.get(chaveChat).push(mensagem);

        // Limita histórico a últimas 100 mensagens por chat
        if (mensagensPrivadas.get(chaveChat).length > 100) {
            mensagensPrivadas.get(chaveChat).shift();
        }

        console.log(`[PRIVADO] ${de} → ${para}: ${msg}`);

        // Encontra o socket do usuário destino
        let socketDestino = null;
        for (let [socketId, usuario] of usuariosConectados) {
            if (usuario === para) {
                socketDestino = socketId;
                break;
            }
        }

        // Envia para o remetente
        socket.emit('private message', mensagem);

        // Envia para o destinatário se estiver online
        if (socketDestino) {
            io.to(socketDestino).emit('private message', mensagem);
        } else {
            // Notifica o remetente que o usuário não está online
            socket.emit('user_offline', { usuario: para });
        }
    });

    // Evento: Pedido de histórico privado
    socket.on('get_private_history', (dados) => {
        const { outro_usuario } = dados;
        const usuario_atual = usuariosConectados.get(socket.id);
        const chaveChat = [usuario_atual, outro_usuario].sort().join('_');

        const historico = mensagensPrivadas.get(chaveChat) || [];
        socket.emit('private_history', {
            outro_usuario: outro_usuario,
            mensagens: historico
        });
    });

    // Evento: Status de digitação
    socket.on('typing', (dados) => {
        const usuario = usuariosConectados.get(socket.id);
        if (usuario) {
            socket.broadcast.emit('user_typing', {
                usuario: usuario,
                tipo: dados.tipo // 'global' ou chaveChat
            });
        }
    });

    // Evento: Parou de digitar
    socket.on('stop_typing', (dados) => {
        const usuario = usuariosConectados.get(socket.id);
        if (usuario) {
            socket.broadcast.emit('user_stop_typing', {
                usuario: usuario,
                tipo: dados.tipo
            });
        }
    });

    // Evento: Desconexão
    socket.on('disconnect', () => {
        const usuario = usuariosConectados.get(socket.id);
        if (usuario) {
            usuariosConectados.delete(socket.id);
            console.log(`[${new Date().toLocaleTimeString()}] ${usuario} saiu do chat`);

            // Notifica todos sobre desconexão
            io.emit('usuarios_conectados', Array.from(usuariosConectados.values()));
            io.emit('user_list', Array.from(usuariosConectados.values()));
        }
    });

    // Evento: Erro
    socket.on('error', (erro) => {
        console.error(`[ERRO] ${socket.id}: ${erro}`);
    });
});

// INICIALIZAÇÃO
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🦆 PatoChat Server rodando na porta ${PORT}`);
});

// Tratamento de erros global
process.on('uncaughtException', (erro) => {
    console.error('[ERRO CRÍTICO]', erro);
});

process.on('unhandledRejection', (razao) => {
    console.error('[PROMISE REJEITADA]', razao);
});
