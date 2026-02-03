const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const getCustomers = async (req, res) => {
  try {
    const [customers] = await pool.query(
      'SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC'
    );
    res.json(customers);
  } catch (error) {
    console.error('Error getting customers:', error);
    res.status(500).json({ error: 'Error getting customers' });
  }
};

const getCustomerById = async (req, res) => {
  const { id } = req.params;
  try {
    const [customers] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    
    if (customers.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    const [transactions] = await pool.query(
      'SELECT * FROM credit_transactions WHERE customer_id = ? ORDER BY created_at DESC', 
      [id]
    );

    res.json({
      ...customers[0],
      transactions
    });
  } catch (error) {
    console.error('Error getting customer details:', error);
    res.status(500).json({ error: 'Error getting customer details' });
  }
};

const createCustomer = async (req, res) => {
  const { name, phone, address, identification, email } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const id = uuidv4();
  
  try {
    await pool.query(
      'INSERT INTO customers (id, name, phone, address, identification, email, credit_limit, current_debt, is_active) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1)',
      [id, name, phone, address, identification, email]
    );
    
    const [newCustomer] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    
    // Emit socket event (handled in index.js)
    if (req.io) {
      req.io.emit('credit:customer_update', newCustomer[0]);
    }
    
    res.status(201).json(newCustomer[0]);
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Error creating customer' });
  }
};

const updateCustomer = async (req, res) => {
  const { id } = req.params;
  const { name, phone, address, identification, email, credit_limit, is_active } = req.body;
  
  try {
    // Only update fields that are provided
    let updates = [];
    let values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (address !== undefined) { updates.push('address = ?'); values.push(address); }
    if (identification !== undefined) { updates.push('identification = ?'); values.push(identification); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (credit_limit !== undefined) { updates.push('credit_limit = ?'); values.push(credit_limit); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    
    await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    const [updatedCustomer] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    
    if (req.io) {
      req.io.emit('credit:customer_update', updatedCustomer[0]);
    }
    
    res.json(updatedCustomer[0]);
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Error updating customer' });
  }
};

const registerPayment = async (req, res) => {
  const { customer_id, amount, shift_id, description } = req.body;
  
  if (!customer_id || !amount || amount <= 0 || !shift_id) {
    return res.status(400).json({ error: 'Invalid payment data' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 1. Get customer
    const [customers] = await connection.query('SELECT * FROM customers WHERE id = ? FOR UPDATE', [customer_id]);
    if (customers.length === 0) {
      throw new Error('Customer not found');
    }
    const customer = customers[0];
    
    // 2. Get unpaid charges (FIFO)
    const [charges] = await connection.query(
      `SELECT * FROM credit_transactions 
       WHERE customer_id = ? 
       AND type IN ('charge', 'opening_balance') 
       AND remaining > 0 
       ORDER BY created_at ASC`,
      [customer_id]
    );
    
    let remainingPayment = parseFloat(amount);
    let paymentsCreated = [];
    
    // 3. Create movement (Abono)
    const movementId = uuidv4();
    await connection.query(
      'INSERT INTO movements (id, type, amount, description, shift_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [movementId, 'abono', amount, description || `Abono cliente ${customer.name}`, shift_id]
    );
    
    // 4. Distribute payment across charges
    for (const charge of charges) {
      if (remainingPayment <= 0) break;
      
      const chargeRemaining = parseFloat(charge.remaining);
      const paymentAmount = Math.min(remainingPayment, chargeRemaining);
      
      // Update charge remaining
      await connection.query(
        'UPDATE credit_transactions SET remaining = remaining - ? WHERE id = ?',
        [paymentAmount, charge.id]
      );
      
      // Create payment transaction linked to charge
      const paymentId = uuidv4();
      const paymentTx = {
        id: paymentId,
        customer_id,
        type: 'payment',
        amount: paymentAmount,
        related_charge_id: charge.id,
        movement_id: movementId,
        shift_id,
        description: `Pago a ${charge.type === 'opening_balance' ? 'Saldo Inicial' : 'Venta'}`,
        created_at: new Date()
      };
      
      await connection.query(
        'INSERT INTO credit_transactions (id, customer_id, type, amount, related_charge_id, movement_id, shift_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [paymentId, customer_id, 'payment', paymentAmount, charge.id, movementId, shift_id, paymentTx.description, paymentTx.created_at]
      );
      
      paymentsCreated.push(paymentTx);
      remainingPayment -= paymentAmount;
    }
    
    // If there is still remaining payment (overpayment), we could either reject or store as credit balance.
    // For now, assuming strict debt payment, but if they pay more than debt, it's weird.
    // Let's assume frontend validates max payment amount = current_debt.
    // If backend receives more, we might have an issue. 
    // Plan says "max = current_balance".
    // If remainingPayment > 0 here, it means they paid more than what they owed on tracked charges.
    // We will just update the customer debt by the total amount paid, potentially making it negative (credit in favor).
    
    // 5. Update customer balance
    await connection.query(
      'UPDATE customers SET current_debt = current_debt - ? WHERE id = ?',
      [amount, customer_id]
    );
    
    await connection.commit();
    
    const [updatedCustomer] = await pool.query('SELECT * FROM customers WHERE id = ?', [customer_id]);
    
    // Emit events
    if (req.io) {
      req.io.emit('credit:payment', { 
        customer_id, 
        amount, 
        payments: paymentsCreated,
        updated_customer: updatedCustomer[0] 
      });
      req.io.emit('credit:customer_update', updatedCustomer[0]);
    }
    
    res.json({ 
      success: true, 
      customer: updatedCustomer[0], 
      payments: paymentsCreated 
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error registering payment:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

const createOpeningBalance = async (req, res) => {
  const { customer_id, amount, description, created_by_id, created_by_name } = req.body;
  
  if (!customer_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid opening balance data' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const id = uuidv4();
    
    // Create transaction
    await connection.query(
      `INSERT INTO credit_transactions 
       (id, customer_id, type, amount, remaining, description, created_by_id, created_by_name) 
       VALUES (?, ?, 'opening_balance', ?, ?, ?, ?, ?)`,
      [id, customer_id, amount, amount, description || 'Saldo Inicial', created_by_id, created_by_name]
    );
    
    // Update customer debt
    await connection.query(
      'UPDATE customers SET current_debt = current_debt + ? WHERE id = ?',
      [amount, customer_id]
    );
    
    await connection.commit();
    
    const [updatedCustomer] = await pool.query('SELECT * FROM customers WHERE id = ?', [customer_id]);
    
    if (req.io) {
      req.io.emit('credit:customer_update', updatedCustomer[0]);
    }
    
    res.json({ success: true, customer: updatedCustomer[0] });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating opening balance:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

const getPortfolio = async (req, res) => {
  try {
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_customers,
        SUM(CASE WHEN current_debt > 0 THEN 1 ELSE 0 END) as debtors_count,
        SUM(current_debt) as total_debt
      FROM customers 
      WHERE is_active = 1
    `);
    
    const [topDebtors] = await pool.query(`
      SELECT * FROM customers 
      WHERE is_active = 1 AND current_debt > 0 
      ORDER BY current_debt DESC 
      LIMIT 10
    `);
    
    res.json({
      summary: summary[0],
      top_debtors: topDebtors
    });
  } catch (error) {
    console.error('Error getting portfolio:', error);
    res.status(500).json({ error: 'Error getting portfolio' });
  }
};

module.exports = {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  registerPayment,
  createOpeningBalance,
  getPortfolio
};
