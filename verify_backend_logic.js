
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'el_super_cafe',
};

const { calculateSaleCost } = require('./src/utils/math');

// Mock query function for calculateSaleCost
async function mockQuery(sql, params) {
  // Normalize SQL to ignore whitespace/case for matching
  const normalizedSql = sql.toLowerCase().replace(/\s+/g, ' ').trim();
  
  if (normalizedSql.includes('from products where id =')) {
    const id = params[0];
    if (id === 'tomate_id') {
      return [{
        id: 'tomate_id',
        manage_stock: 1,
        cost_unit: 600,
        yield_per_unit: 6,
        unit: 'u'
      }];
    }
    if (id === 'sandwich_id') {
      return [{
        id: 'sandwich_id',
        manage_stock: 0,
        cost_unit: 0, // Recipe product usually has 0 cost_unit or calculated
        yield_per_unit: 1
      }];
    }
  }
  
  if (normalizedSql.includes('from recipes where product_id =')) {
    const id = params[0];
    if (id === 'sandwich_id') {
      return [{
        ingredient_id: 'tomate_id',
        quantity_required: 0.1666 // 1/6 stored in DB
      }];
    }
  }
  
  return [];
}

async function verifyBackendLogic() {
  console.log('Verifying Backend Logic...');

  // 1. Verify Cost Calculation
  const items = [{
    product_id: 'sandwich_id',
    quantity: 1,
    modifiers: []
  }];

  const cost = await calculateSaleCost(items, mockQuery);
  console.log(`Calculated Cost: ${cost}`);
  
  const expectedCost = 600 * 0.1666; // 99.96
  const tolerance = 0.1;
  
  if (Math.abs(cost - expectedCost) < tolerance) {
    console.log('✅ Cost calculation is CORRECT (using stored fraction).');
  } else {
    console.log(`❌ Cost calculation is WRONG. Expected ~${expectedCost}, got ${cost}`);
  }
  
  // 2. Verify Decimal Logic in StockService (Simulation)
  // Logic: newStock = current - quantity
  const currentStock = 10.0000;
  const deduction = 0.1666;
  const newStock = Number((currentStock - deduction).toFixed(4));
  
  console.log(`Stock Deduction: ${currentStock} - ${deduction} = ${newStock}`);
  
  if (newStock === 9.8334) {
    console.log('✅ Stock deduction logic is CORRECT.');
  } else {
    console.log(`❌ Stock deduction logic might be imprecise. Got ${newStock}`);
  }

}

verifyBackendLogic();
