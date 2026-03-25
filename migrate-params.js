const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function main() {
    try {
        console.log('Connecting to database...');
        await pool.query('ALTER TABLE tool_parameters ADD COLUMN IF NOT EXISTS item_type VARCHAR(50);');
        await pool.query('ALTER TABLE tool_parameters ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tool_parameters(id) ON DELETE CASCADE;');
        console.log('Database schema updated successfully');
        process.exit(0);
    } catch (err) {
        console.error('Error updating schema:', err);
        process.exit(1);
    }
}

main();
