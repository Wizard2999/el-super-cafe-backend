
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

    const migrationPath = path.join(__dirname, 'sql', 'migrations', '005_add_portions_and_yield.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Applying migration 005_add_portions_and_yield.sql...');
    
    // Check if columns already exist to avoid errors if run multiple times
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'yield_per_unit'
    `, [dbConfig.database]);

    if (columns.length > 0) {
      console.log('Migration already applied (columns exist). Skipping ADD COLUMN.');
      // Still need to check if we need to modify recipe precision
       await connection.query(`
        ALTER TABLE recipes
        MODIFY COLUMN quantity_required DECIMAL(10, 4) NOT NULL DEFAULT 0.0000;
      `);
      console.log('Recipe quantity precision ensured.');
    } else {
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
