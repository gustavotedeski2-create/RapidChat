const { Client } = require('pg');

// Essa variável a gente vai configurar na Render depois
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log("Conectado ao banco de dados! 🪙"))
  .catch(err => console.error("Erro ao conectar no banco:", err));
