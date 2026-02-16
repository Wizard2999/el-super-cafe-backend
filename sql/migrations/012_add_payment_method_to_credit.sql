-- Migration: Add payment_method to credit_transactions and movements
-- 1. Update credit_transactions table
ALTER TABLE credit_transactions 
ADD COLUMN payment_method ENUM('efectivo', 'transferencia') NULL AFTER amount;

-- 2. Update movements table
ALTER TABLE movements 
ADD COLUMN payment_method ENUM('efectivo', 'transferencia') NULL AFTER amount;

-- 3. Set default for existing payments (assuming cash)
UPDATE credit_transactions SET payment_method = 'efectivo' WHERE type = 'payment';
UPDATE movements SET payment_method = 'efectivo' WHERE type = 'abono';
