const http = require('http');
const { Server } = require('socket.io');

// Cria um servidor básico para a Render não dar erro de porta
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor do PatoChat está rodando! 🦆');
});

// Configura o Socket.io com permissão para o seu site acessar (CORS)
const io = new Server(server, {
    cors: {
        origin: "*", // Permite que qualquer site (como seu Pato Hub) se conecte
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Um usuário se conectou! ID:', socket.id);

    // Quando o servidor recebe uma mensagem de alguém
    socket.on('chat message', (msg) => {
        console.log('Mensagem recebida: ' + msg);
        // Envia para TODOS os outros usuários conectados
        socket.broadcast.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectou.');
    });
});

// A Render define a porta automaticamente, por isso usamos process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
