const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'el_super_cafe',
  multipleStatements: true
};

async function applyMigrations() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected.');

    const migrations = [
      '008_credit_system.sql',
      '009_add_address_to_customers.sql'
    ];

    for (const migration of migrations) {
      const migrationPath = path.join(__dirname, 'sql', 'migrations', migration);
      if (!fs.existsSync(migrationPath)) {
        console.error(`Migration file not found: ${migration}`);
        continue;
      }
      
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      console.log(`Applying migration ${migration}...`);
      
      try {
        await connection.query(migrationSql);
        console.log(`Migration ${migration} applied successfully.`);
      } catch (err) {
        // Simple check for duplicate column errors or table exists
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR' || err.message.includes('Duplicate column name')) {
          console.log(`Migration ${migration} seemingly already applied (columns/tables exist).`);
        } else {
          console.error(`Error applying ${migration}:`, err.message);
        }
      }
    }

  } catch (error) {
    console.error('Error connecting or applying migrations:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

applyMigrations();
