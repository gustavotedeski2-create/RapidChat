const { Client } = require('pg');

// Essa variável a gente vai configurar na Render depois
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log("Conectado ao banco de dados! 🪙"))
  .catch(err => console.error("Erro ao conectar no banco:", err));
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('pg');

const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect().then(() => {
    console.log("Banco conectado! 🪙");
    // Cria a tabela se não existir
    db.query('CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, nome TEXT UNIQUE, senha TEXT)');
});

const server = http.createServer((req, res) => { res.end('PatoChat On!'); });
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    // Lógica de Cadastro
    socket.on('novo usuario', async (dados) => {
        try {
            await db.query('INSERT INTO usuarios (nome, senha) VALUES ($1, $2)', [dados.user, dados.pass]);
            socket.emit('cadastro sucesso');
        } catch (e) {
            socket.emit('erro', 'Usuário já existe ou erro no banco.');
        }
    });

    // Lógica de Login
    socket.on('tentar login', async (dados) => {
        const res = await db.query('SELECT * FROM usuarios WHERE nome = $1 AND senha = $2', [dados.user, dados.pass]);
        if (res.rows.length > 0) {
            socket.emit('login sucesso');
        } else {
            socket.emit('erro', 'Usuário ou senha incorretos.');
        }
    });
});

server.listen(process.env.PORT || 3000);
