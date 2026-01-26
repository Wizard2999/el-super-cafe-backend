
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'el_super_cafe',
};

async function testPortionsLogic() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected.');

    // 1. Get Valid Category
    const [categories] = await connection.execute('SELECT id FROM categories LIMIT 1');
    let categoryId;
    if (categories.length > 0) {
      categoryId = categories[0].id;
    } else {
      // Insert one if not exists
      categoryId = 'test_cat';
      await connection.execute("INSERT IGNORE INTO categories (id, name, is_synced) VALUES ('test_cat', 'Test Category', 1)");
    }

    // 1. Create Test Ingredients
    const tomatoId = uuidv4();
    const saladId = uuidv4();

    console.log('Creating test products...');
    
    // Tomato: 10 units stock, 600 cost, 6 portions yield
    await connection.execute(`
      INSERT INTO products (id, name, category_id, price, manage_stock, stock_current, cost_unit, unit, yield_per_unit, portion_name, is_synced)
      VALUES (?, 'Tomate Test', ?, 0, 1, 10.000, 600, 'unid', 6.000, 'rodajas', 1)
    `, [tomatoId, categoryId]);

    // Salad: 5000 price, recipe product
    await connection.execute(`
      INSERT INTO products (id, name, category_id, price, manage_stock, stock_current, is_synced)
      VALUES (?, 'Ensalada Test', ?, 5000, 0, 0, 1)
    `, [saladId, categoryId]);

    // 2. Create Recipe
    // 1 portion of tomato = 1/6 = 0.1666666... -> let's use 0.1667
    // Frontend is expected to send this value.
    const qtyRequired = 0.1667;
    await connection.execute(`
      INSERT INTO recipes (id, product_id, ingredient_id, quantity_required, is_synced)
      VALUES (?, ?, ?, ?, 1)
    `, [uuidv4(), saladId, tomatoId, qtyRequired]);

    console.log(`Recipe created: Ensalada requires ${qtyRequired} of Tomate`);

    // 3. Simulate Logic from StockService/SyncController
    // We want to calculate Cost and Deduct Stock.

    // A. Cost Calculation Logic (mimicking calculateSaleCost from math.js)
    console.log('--- Testing Cost Calculation ---');
    const [ingredients] = await connection.execute(
        'SELECT cost_unit FROM products WHERE id = ?',
        [tomatoId]
    );
    const ingredientCost = Number(ingredients[0].cost_unit);
    const calculatedCost = ingredientCost * qtyRequired;
    console.log(`Ingredient Cost (Unit): ${ingredientCost}`);
    console.log(`Quantity Required: ${qtyRequired}`);
    console.log(`Calculated Portion Cost: ${calculatedCost}`);
    
    if (Math.abs(calculatedCost - 100.02) < 0.1) {
        console.log('✅ Cost calculation is proportional (approx 100 for 1/6 of 600).');
    } else {
        console.log('❌ Cost calculation mismatch.');
    }

    // B. Stock Deduction Logic (mimicking processInventoryDeduction)
    console.log('--- Testing Stock Deduction ---');
    
    // Simulate selling 2 salads
    const quantitySold = 2;
    const totalToDeduct = quantitySold * qtyRequired; // 2 * 0.1667 = 0.3334
    
    console.log(`Selling ${quantitySold} Salads. Total to deduct: ${totalToDeduct}`);

    const [stockResult] = await connection.execute(
        'SELECT stock_current FROM products WHERE id = ?',
        [tomatoId]
    );
    const initialStock = Number(stockResult[0].stock_current);
    console.log(`Initial Stock: ${initialStock}`);

    // Perform Update
    await connection.execute(
        `UPDATE products
         SET stock_current = GREATEST(0, stock_current - ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [totalToDeduct, tomatoId]
    );

    // Verify
    const [finalStockResult] = await connection.execute(
        'SELECT stock_current FROM products WHERE id = ?',
        [tomatoId]
    );
    const finalStock = Number(finalStockResult[0].stock_current);
    console.log(`Final Stock: ${finalStock}`);

    const expectedStock = initialStock - totalToDeduct;
    if (Math.abs(finalStock - expectedStock) < 0.0001) {
        console.log(`✅ Stock deducted correctly. Expected: ${expectedStock}, Got: ${finalStock}`);
    } else {
        console.log(`❌ Stock deduction mismatch. Expected: ${expectedStock}, Got: ${finalStock}`);
    }

    // Cleanup
    console.log('Cleaning up test data...');
    await connection.execute('DELETE FROM recipes WHERE product_id = ?', [saladId]);
    await connection.execute('DELETE FROM products WHERE id IN (?, ?)', [saladId, tomatoId]);
    console.log('Done.');

  } catch (error) {
    console.error('Test Failed:', error);
  } finally {
    if (connection) await connection.end();
  }
}

testPortionsLogic();
