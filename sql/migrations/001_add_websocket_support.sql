-- ============================================
-- SOLUCIÓN MIGRACIÓN 001 - EL SUPER CAFE
-- ============================================

-- 1. Agregar la columna directamente
-- Si te da error de "Duplicate column", simplemente ignora este paso y pasa al 2
ALTER TABLE cafe_tables
ADD COLUMN current_sale_id VARCHAR(36) DEFAULT NULL
AFTER status;

-- 2. Crear el índice (Aquí usamos la sintaxis estándar)
CREATE INDEX idx_cafe_tables_status_sale
ON cafe_tables(status, current_sale_id);

-- 3. Vincular mesas ocupadas con sus ventas (Lógica de negocio)
UPDATE cafe_tables ct
SET ct.current_sale_id = (
    SELECT s.id
    FROM sales s
    WHERE s.table_id = ct.id
      AND s.status = 'pending'
    ORDER BY s.created_at DESC
    LIMIT 1
)
WHERE ct.status = 'occupied'
  AND ct.current_sale_id IS NULL;

-- 4. Crear tabla de logs para WebSockets
CREATE TABLE IF NOT EXISTS websocket_events_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    event_data JSON,
    source_device VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_event_type (event_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;