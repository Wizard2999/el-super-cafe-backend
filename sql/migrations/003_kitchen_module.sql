-- Migration: Kitchen Module & Auxiliary Role
-- 1. Add preparation_status to sale_items
-- 2. Update users role enum

-- 1. Add preparation_status to sale_items
-- status: pending (recién pedido), preparing (en cocina), ready (listo para servir), delivered (entregado al cliente)
ALTER TABLE sale_items
ADD COLUMN preparation_status ENUM('pending', 'preparing', 'ready', 'delivered') NOT NULL DEFAULT 'pending'
AFTER unit_price;

-- 2. Update users role enum to include 'auxiliar_inventario' and 'kitchen'
ALTER TABLE users
MODIFY COLUMN role ENUM('admin', 'employee', 'kitchen', 'auxiliar_inventario') NOT NULL DEFAULT 'employee';

-- 3. Add index for efficient kitchen lookup
CREATE INDEX idx_sale_items_status ON sale_items (preparation_status);
