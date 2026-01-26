-- Increase stock_current precision for exact portion deduction
ALTER TABLE products
MODIFY COLUMN stock_current DECIMAL(12, 4) DEFAULT 0.0000;
