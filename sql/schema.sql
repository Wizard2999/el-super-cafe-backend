-- ============================================
-- EL SUPER CAFE - SCHEMA SQL FINAL (CORREGIDO PARA CPANEL)
-- ============================================

-- 1. TABLAS BASE (Con IF NOT EXISTS es seguro)
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) DEFAULT '',
    pin_code VARCHAR(60) NOT NULL,  -- VARCHAR(60) para hashes bcrypt
    role ENUM('admin', 'employee', 'kitchen', 'auxiliar_inventario') NOT NULL DEFAULT 'employee',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category_id VARCHAR(36) NOT NULL,
    price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    manage_stock TINYINT(1) NOT NULL DEFAULT 0,
    stock_current DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    unit ENUM('g', 'ml', 'unid', 'oz') NOT NULL DEFAULT 'unid',
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_category_id (category_id),
    INDEX idx_name (name),
    INDEX idx_manage_stock (manage_stock)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipes (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    ingredient_id VARCHAR(36) NOT NULL,
    quantity_required DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_product_id (product_id),
    INDEX idx_ingredient_id (ingredient_id),
    UNIQUE KEY unique_recipe (product_id, ingredient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cafe_tables (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    status ENUM('free', 'occupied') NOT NULL DEFAULT 'free',
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shifts (
    id VARCHAR(36) PRIMARY KEY,
    opened_by_id VARCHAR(36) NOT NULL,
    opened_by_name VARCHAR(100) NOT NULL,
    closed_by_id VARCHAR(36) DEFAULT NULL,
    closed_by_name VARCHAR(100) DEFAULT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME DEFAULT NULL,
    initial_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    final_cash_reported DECIMAL(12, 2) DEFAULT NULL,
    cash_difference DECIMAL(12, 2) DEFAULT NULL,
    status ENUM('open', 'waiting_initial_cash', 'closed') NOT NULL DEFAULT 'open',
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (opened_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_status (status),
    INDEX idx_start_time (start_time),
    INDEX idx_opened_by_id (opened_by_id),
    INDEX idx_is_synced (is_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS sales (
    id VARCHAR(36) PRIMARY KEY,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('efectivo', 'transferencia', 'credito') NOT NULL DEFAULT 'efectivo',
    status ENUM('pending', 'completed', 'unpaid_debt', 'cancelled') NOT NULL DEFAULT 'pending',
    observation TEXT DEFAULT NULL,
    unpaid_authorized_by_id VARCHAR(36) DEFAULT NULL,
    shift_id VARCHAR(36) DEFAULT NULL,
    table_id VARCHAR(36) DEFAULT NULL,
    customer_id VARCHAR(36) DEFAULT NULL,
    print_count INT NOT NULL DEFAULT 0,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (table_id) REFERENCES cafe_tables(id) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (unpaid_authorized_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_status (status),
    INDEX idx_shift_id (shift_id),
    INDEX idx_table_id (table_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_payment_method (payment_method),
    INDEX idx_created_at (created_at),
    INDEX idx_is_synced (is_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS sale_items (
    id VARCHAR(36) PRIMARY KEY,
    sale_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
    unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    preparation_status ENUM('pending', 'preparing', 'ready', 'delivered') NOT NULL DEFAULT 'pending',
    modifiers TEXT DEFAULT NULL,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_sale_id (sale_id),
    INDEX idx_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movements (
    id VARCHAR(36) PRIMARY KEY,
    type ENUM('ingreso', 'gasto', 'abono') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    description VARCHAR(255) NOT NULL,
    shift_id VARCHAR(36) DEFAULT NULL,
    is_synced TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_type (type),
    INDEX idx_shift_id (shift_id),
    INDEX idx_created_at (created_at),
    INDEX idx_is_synced (is_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(100) DEFAULT NULL,
    sync_type ENUM('upload', 'download') NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    records_count INT NOT NULL DEFAULT 0,
    status ENUM('success', 'partial', 'failed') NOT NULL DEFAULT 'success',
    error_message TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_id (device_id),
    INDEX idx_sync_type (sync_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. VISTAS (DROP + CREATE es la forma segura)
-- ============================================

DROP VIEW IF EXISTS v_shift_summary;
CREATE VIEW v_shift_summary AS
SELECT
    s.id AS shift_id,
    s.opened_by_name,
    s.start_time,
    s.end_time,
    s.initial_cash,
    s.status AS shift_status,
    COALESCE(SUM(CASE WHEN sa.status = 'completed' AND sa.payment_method = 'efectivo' THEN sa.total ELSE 0 END), 0) AS sales_cash,
    COALESCE(SUM(CASE WHEN sa.status = 'completed' AND sa.payment_method = 'transferencia' THEN sa.total ELSE 0 END), 0) AS sales_transfer,
    COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.total ELSE 0 END), 0) AS total_sales,
    COALESCE((SELECT SUM(m.amount) FROM movements m WHERE m.shift_id = s.id AND m.type = 'gasto'), 0) AS total_expenses,
    s.initial_cash + COALESCE(SUM(CASE WHEN sa.status = 'completed' AND sa.payment_method = 'efectivo' THEN sa.total ELSE 0 END), 0) - COALESCE((SELECT SUM(m.amount) FROM movements m WHERE m.shift_id = s.id AND m.type = 'gasto'), 0) AS expected_cash
FROM shifts s
LEFT JOIN sales sa ON sa.shift_id = s.id
GROUP BY s.id;

DROP VIEW IF EXISTS v_unpaid_debts;
CREATE VIEW v_unpaid_debts AS
SELECT
    s.id AS sale_id,
    s.total,
    s.observation,
    s.created_at,
    u.name AS authorized_by,
    sh.opened_by_name AS shift_opened_by
FROM sales s
LEFT JOIN users u ON s.unpaid_authorized_by_id = u.id
LEFT JOIN shifts sh ON s.shift_id = sh.id
WHERE s.status = 'unpaid_debt';

DROP VIEW IF EXISTS v_top_products;
CREATE VIEW v_top_products AS
SELECT
    si.product_id,
    si.product_name,
    SUM(si.quantity) AS total_quantity,
    SUM(si.quantity * si.unit_price) AS total_revenue,
    COUNT(DISTINCT si.sale_id) AS times_sold
FROM sale_items si
JOIN sales s ON si.sale_id = s.id
WHERE s.status = 'completed'
GROUP BY si.product_id, si.product_name
ORDER BY total_quantity DESC;

-- 3. PROCEDIMIENTOS (Sin IF NOT EXISTS en CREATE)
-- ============================================

DELIMITER //

DROP PROCEDURE IF EXISTS sp_sales_summary //
CREATE PROCEDURE sp_sales_summary(
    IN p_start_date DATE,
    IN p_end_date DATE
)
BEGIN
    SELECT
        DATE(s.created_at) AS sale_date,
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN s.payment_method = 'efectivo' THEN s.total ELSE 0 END) AS cash_sales,
        SUM(CASE WHEN s.payment_method = 'transferencia' THEN s.total ELSE 0 END) AS transfer_sales,
        SUM(s.total) AS total_sales
    FROM sales s
    WHERE s.status = 'completed'
      AND DATE(s.created_at) BETWEEN p_start_date AND p_end_date
    GROUP BY DATE(s.created_at)
    ORDER BY sale_date DESC;
END //

DROP PROCEDURE IF EXISTS sp_sync_sale //
CREATE PROCEDURE sp_sync_sale(
    IN p_id VARCHAR(36),
    IN p_total DECIMAL(12,2),
    IN p_payment_method VARCHAR(20),
    IN p_status VARCHAR(20),
    IN p_observation TEXT,
    IN p_shift_id VARCHAR(36),
    IN p_table_id VARCHAR(36),
    IN p_print_count INT,
    IN p_created_at DATETIME
)
BEGIN
    INSERT INTO sales (id, total, payment_method, status, observation, shift_id, table_id, print_count, is_synced, created_at)
    VALUES (p_id, p_total, p_payment_method, p_status, p_observation, p_shift_id, p_table_id, p_print_count, 1, p_created_at)
    ON DUPLICATE KEY UPDATE
        total = p_total,
        payment_method = p_payment_method,
        status = p_status,
        observation = p_observation,
        print_count = p_print_count,
        is_synced = 1,
        updated_at = CURRENT_TIMESTAMP;
END //

DELIMITER ;

-- 4. ÍNDICES (Corregidos sin IF NOT EXISTS)
-- ============================================

CREATE INDEX idx_sales_date_status ON sales (created_at, status);
CREATE INDEX idx_sales_sync_pending ON sales (is_synced, created_at);
CREATE INDEX idx_movements_sync_pending ON movements (is_synced, created_at);
CREATE INDEX idx_shifts_sync_pending ON shifts (is_synced, start_time);

-- 5. DATOS INICIALES (IDs fijos para evitar duplicados en re-ejecución)
-- ============================================

INSERT IGNORE INTO users (id, name, username, password_hash, pin_code, role, is_active) VALUES
('u1-soporte-001', 'Soporte Técnico', 'soporte', '', '2908', 'admin', 1),
('u2-admin-002', 'Administrador Café', 'admincafe', '', '1234', 'admin', 1),
('u3-cajero-003', 'Cajero', 'cajero', '', '0000', 'employee', 1);

INSERT IGNORE INTO categories (id, name, color) VALUES
('c1-calientes', 'Bebidas Calientes', '#D97706'),
('c2-frias', 'Bebidas Frías', '#0891B2'),
('c3-panaderia', 'Panadería', '#CA8A04'),
('c4-snacks', 'Snacks', '#16A34A'),
('c5-insumos', 'Insumos', '#6B7280');