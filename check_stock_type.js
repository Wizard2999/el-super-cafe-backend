
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'el_super_cafe',
};

async function checkStockType() {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute("SHOW COLUMNS FROM products WHERE Field = 'stock_current'");
    console.log(rows[0].Type);
  } catch (error) {
    console.error(error);
  } finally {
    if (connection) await connection.end();
  }
}

checkStockType();
