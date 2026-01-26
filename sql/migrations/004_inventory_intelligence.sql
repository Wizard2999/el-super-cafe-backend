-- Migration: Inventory Intelligence
-- 1. Add cost_unit and stock_min to products for profit calculation and low stock alerts
-- 2. Add stock_adjustments table for entry/exit tracking

-- 1. Add cost and minimum stock fields to products
ALTER TABLE products
ADD COLUMN cost_unit DECIMAL(12, 2) NOT NULL DEFAULT 0.00
AFTER price;

ALTER TABLE products
ADD COLUMN stock_min DECIMAL(12, 2) NOT NULL DEFAULT 0.00
AFTER stock_current;

-- 2. Create stock adjustments table for inventory control
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    type ENUM('entrada', 'salida') NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    reason ENUM('compra', 'merma', 'dano', 'correccion', 'otro') NOT NULL DEFAULT 'otro',
    description VARCHAR(255) DEFAULT NULL,
    previous_stock DECIMAL(12, 2) NOT NULL,
    new_stock DECIMAL(12, 2) NOT NULL,
    created_by_id VARCHAR(36) NOT NULL,
    created_by_name VARCHAR(100) NOT NULL,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_product_id (product_id),
    INDEX idx_type (type),
    INDEX idx_reason (reason),
    INDEX idx_created_at (created_at),
    INDEX idx_created_by (created_by_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Add gross_profit column to sales for profit tracking
ALTER TABLE sales
ADD COLUMN gross_profit DECIMAL(12, 2) DEFAULT NULL
AFTER total;

-- 4. Add index for low stock queries
CREATE INDEX idx_products_low_stock ON products (manage_stock, stock_current, stock_min);
