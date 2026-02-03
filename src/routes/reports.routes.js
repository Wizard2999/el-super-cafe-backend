const express = require('express');
const router = express.Router();

const reportsController = require('../controllers/reports.controller');
const { verifyToken, requireAdmin } = require('../middleware/auth.middleware');

/**
 * GET /api/reports/summary
 * Resumen general de ventas
 * Query: start_date, end_date, period (day|week|month|year)
 */
router.get('/summary', verifyToken, requireAdmin, reportsController.getSalesSummary);

/**
 * GET /api/reports/sales-by-day
 * Ventas agrupadas por día
 * Query: days (default: 30)
 */
router.get('/sales-by-day', verifyToken, requireAdmin, reportsController.getSalesByDay);

/**
 * GET /api/reports/top-products
 * Productos más vendidos
 * Query: limit (default: 10), start_date, end_date
 */
router.get('/top-products', verifyToken, requireAdmin, reportsController.getTopProducts);

/**
 * GET /api/reports/shifts
 * Historial de turnos
 * Query: limit (default: 20), status (open|closed)
 */
router.get('/shifts', verifyToken, requireAdmin, reportsController.getShiftsHistory);

/**
 * GET /api/reports/shift/:id
 * Detalle de un turno específico
 */
router.get('/shift/:id', verifyToken, requireAdmin, reportsController.getShiftDetail);

/**
 * GET /api/reports/debts
 * Listado de deudas pendientes
 */
router.get('/debts', verifyToken, requireAdmin, reportsController.getPendingDebts);

/**
 * GET /api/reports/detailed-sales
 * Ventas detalladas (Excel)
 */
router.get('/detailed-sales', verifyToken, requireAdmin, reportsController.getDetailedSales);

/**
 * GET /api/reports/low-rotation
 * Productos con baja rotación
 */
router.get('/low-rotation', verifyToken, requireAdmin, reportsController.getLowRotationProducts);

/**
 * GET /api/reports/expenses-detailed
 * Gastos detallados
 */
router.get('/expenses-detailed', verifyToken, requireAdmin, reportsController.getExpensesDetailed);

module.exports = router;
