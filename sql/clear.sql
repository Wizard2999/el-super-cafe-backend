-- ============================================
-- SCRIPT DE LIMPIEZA TOTAL (RESET)
-- ============================================

-- Desactivar revisión de llaves foráneas para poder borrar todo sin errores
SET FOREIGN_KEY_CHECKS = 0;

-- Borrar Vistas
DROP VIEW IF EXISTS v_top_products;
DROP VIEW IF EXISTS v_unpaid_debts;
DROP VIEW IF EXISTS v_shift_summary;

-- Borrar Procedimientos
DROP PROCEDURE IF EXISTS sp_sync_sale;
DROP PROCEDURE IF EXISTS sp_sales_summary;

-- Borrar Tablas (en orden inverso de dependencia)
DROP TABLE IF EXISTS sync_log;
DROP TABLE IF EXISTS movements;
DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS cafe_tables;
DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- Reactivar revisión de llaves foráneas
SET FOREIGN_KEY_CHECKS = 1;