-- Migration: Add support for mixed payments
-- 1. Update sales table payment_method enum
ALTER TABLE sales MODIFY COLUMN payment_method ENUM('efectivo', 'transferencia', 'credito', 'multiple') NOT NULL DEFAULT 'efectivo';

-- 2. Create sale_payments table
CREATE TABLE IF NOT EXISTS sale_payments (
    id VARCHAR(36) PRIMARY KEY,
    sale_id VARCHAR(36) NOT NULL,
    payment_method ENUM('efectivo', 'transferencia', 'credito') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_sale_id (sale_id),
    INDEX idx_payment_method (payment_method),
    INDEX idx_is_synced (is_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
