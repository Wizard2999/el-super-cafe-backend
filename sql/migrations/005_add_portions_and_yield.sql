-- Migration: Add Portions and Yield support
-- 1. Add yield_per_unit and portion_name to products table
-- 2. Update recipes quantity_required precision to support fractional units

-- 1. Add yield and portion name columns
ALTER TABLE products
ADD COLUMN yield_per_unit DECIMAL(10, 3) DEFAULT NULL AFTER unit,
ADD COLUMN portion_name VARCHAR(50) DEFAULT NULL AFTER yield_per_unit;

-- 2. Modify recipes quantity precision
ALTER TABLE recipes
MODIFY COLUMN quantity_required DECIMAL(10, 4) NOT NULL DEFAULT 0.0000;
