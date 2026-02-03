-- Migration 008: Credit System
-- Created: 2024-05-23

-- 1. Create customers table
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    identification VARCHAR(50),
    phone VARCHAR(20),
    address VARCHAR(255),
    email VARCHAR(100),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    current_debt DECIMAL(12,2) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_is_synced (is_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Create credit_transactions table
CREATE TABLE IF NOT EXISTS credit_transactions (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    type ENUM('charge','payment','opening_balance') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    remaining DECIMAL(12,2),
    sale_id VARCHAR(36),
    related_charge_id VARCHAR(36),
    movement_id VARCHAR(36),
    shift_id VARCHAR(36),
    created_by_id VARCHAR(36),
    created_by_name VARCHAR(100),
    description VARCHAR(255),
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_customer_id (customer_id),
    INDEX idx_type (type),
    INDEX idx_is_synced (is_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Update sales table
-- Add customer_id column
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sales' AND COLUMN_NAME = 'customer_id' AND TABLE_SCHEMA = DATABASE());
SET @sql := IF(@exist = 0, 'ALTER TABLE sales ADD COLUMN customer_id VARCHAR(36) NULL AFTER table_id', 'SELECT "Column customer_id already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key for customer_id
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_NAME = 'sales' AND CONSTRAINT_NAME = 'fk_sales_customer' AND TABLE_SCHEMA = DATABASE());
SET @sql := IF(@exist = 0, 'ALTER TABLE sales ADD CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT "Constraint fk_sales_customer already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Modify payment_method enum
ALTER TABLE sales MODIFY COLUMN payment_method ENUM('efectivo', 'transferencia', 'credito') NOT NULL DEFAULT 'efectivo';

-- 4. Update movements table
ALTER TABLE movements MODIFY COLUMN type ENUM('ingreso', 'gasto', 'abono') NOT NULL;
