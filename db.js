const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'NirmaDB',
    password: 'root',
    port: 5432
});


pool.connect()
    .then(() => console.log('✅ PostgreSQL connected successfully!'))
    .catch(err => console.error('❌ Connection error:', err.stack));

module.exports = pool;
