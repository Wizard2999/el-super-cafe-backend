
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

async function applyMigration() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected.');

    const migrationPath = path.join(__dirname, 'sql', 'migrations', '006_add_cost_unit.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Check if column already exists
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cost_unit'
    `, [dbConfig.database]);

    if (columns.length > 0) {
      console.log('Migration already applied (cost_unit exists). Skipping.');
    } else {
      console.log('Applying migration 006_add_cost_unit.sql...');
      await connection.query(migrationSql);
      console.log('Migration applied successfully.');
    }

  } catch (error) {
    console.error('Error applying migration:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

applyMigration();
