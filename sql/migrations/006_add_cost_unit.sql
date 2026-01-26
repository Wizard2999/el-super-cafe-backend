-- Migration: Add cost_unit to products
ALTER TABLE products
ADD COLUMN cost_unit DECIMAL(10, 2) DEFAULT 0.00 AFTER price;
