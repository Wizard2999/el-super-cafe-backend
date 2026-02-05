require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  console.log('Conectando a:', process.env.DB_HOST, '/', process.env.DB_NAME);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  console.log('Conexión exitosa!\n');

  const migrations = [
    '008_credit_system.sql',
    '009_add_address_to_customers.sql',
    '010_add_customer_id_to_sales.sql'
  ];

  for (const migration of migrations) {
    const filePath = path.join(__dirname, 'sql', 'migrations', migration);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  ${migration} no existe, saltando...`);
      continue;
    }

    console.log(`Ejecutando ${migration}...`);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      await connection.query(sql);
      console.log(`✅ ${migration} ejecutada correctamente\n`);
    } catch (error) {
      if (error.code === 'ER_DUP_COLUMN' || error.code === 'ER_DUP_KEYNAME' || error.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log(`⚠️  ${migration} - ya aplicada (${error.code}), continuando...\n`);
      } else {
        console.error(`❌ Error en ${migration}:`, error.message);
        // Continuar con las siguientes migraciones
      }
    }
  }

  await connection.end();
  console.log('Migraciones completadas!');
}

runMigrations().catch(console.error);
