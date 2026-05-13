const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('pg');

// Configuração única do banco de dados
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Conecta e cria a tabela automaticamente se não existir
db.connect().then(() => {
    console.log("Banco conectado com sucesso! 🪙");
    db.query('CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, nome TEXT UNIQUE, senha TEXT)');
}).catch(err => {
    console.error("Erro ao conectar no Postgres:", err);
});

// Cria o servidor HTTP para a Render
const server = http.createServer((req, res) => {
    res.end('PatoChat On!');
});

// Configura o Socket.io com CORS liberado
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('Um usuário se conectou: ' + socket.id);

    // Lógica de Cadastro
    socket.on('novo usuario', async (dados) => {
        try {
            await db.query('INSERT INTO usuarios (nome, senha) VALUES ($1, $2)', [dados.user, dados.pass]);
            socket.emit('cadastro sucesso');
        } catch (e) {
            console.error(e);
            socket.emit('erro', 'Usuário já existe ou erro no banco.');
        }
    });

    // Lógica de Login
    socket.on('tentar login', async (dados) => {
        try {
            const res = await db.query('SELECT * FROM usuarios WHERE nome = $1 AND senha = $2', [dados.user, dados.pass]);
            if (res.rows.length > 0) {
                socket.emit('login sucesso');
            } else {
                socket.emit('erro', 'Usuário ou senha incorretos.');
            }
        } catch (e) {
            console.error(e);
            socket.emit('erro', 'Erro interno no servidor.');
        }
    });
});

// Render define a porta automaticamente, se não tiver usa a 3000
server.listen(process.env.PORT || 3000, () => {
    console.log("Servidor rodando liso!");
});
