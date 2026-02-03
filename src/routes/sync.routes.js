const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const syncController = require('../controllers/sync.controller');

/**
 * POST /api/sync
 * Sincronización completa desde el dispositivo
 * Body: { sales: [], sale_items: [], movements: [], shifts: [] }
 */
router.post('/', verifyToken, syncController.syncFromDevice);

/**
 * POST /api/sync/sales
 * Sincronización de ventas
 */
router.post('/sales', verifyToken, syncController.syncSales);

/**
 * POST /api/sync/movements
 * Sincronización de movimientos
 */
router.post('/movements', verifyToken, syncController.syncMovements);

/**
 * POST /api/sync/customers
 * Sincronización de clientes
 */
router.post('/customers', verifyToken, syncController.syncCustomers);

/**
 * POST /api/sync/credit-transactions
 * Sincronización de transacciones de crédito
 */
router.post('/credit-transactions', verifyToken, syncController.syncCreditTransactions);

/**
 * GET /api/sync/status
 * Estado de sincronización
 */
router.get('/status', verifyToken, syncController.getSyncStatus);

/**
 * GET /api/sync/users
 * Descargar usuarios activos al dispositivo
 */
router.get('/users', verifyToken, syncController.syncUsersToDevice);

/**
 * GET /api/sync/shifts/open
 * Obtener turnos abiertos
 */
router.get('/shifts/open', verifyToken, syncController.getOpenShifts);

/**
 * PATCH /api/sync/shifts/handover
 * Traspasar ventas pendientes a otro turno
 */
router.patch('/shifts/handover', verifyToken, syncController.handoverPendingSales);

/**
 * POST /api/sync/shifts/handover-and-close
 * Crea un nuevo turno para el receptor, traspasa las ventas pendientes
 * del turno actual y cierra el turno actual.
 * Body: { current_shift_id: string, receiver_user_id: string, receiver_initial_cash: number }
 */
router.post('/shifts/handover-and-close', verifyToken, syncController.handoverAndCloseShift);

/**
 * POST /api/sync/handover
 * Cierra el turno actual, crea el siguiente con estado 'waiting_initial_cash'
 * y traspasa las ventas pendientes de forma atómica.
 * Body: { current_shift_id: string, incoming_user_id: string, cash_final_reported?: number }
 */
router.post('/handover', verifyToken, syncController.atomicShiftHandover);

/**
 * POST /api/sync/shifts/transfer-tables
 * Transit State: Traspasa ventas pendientes a un usuario receptor sin crear su turno.
 * El receptor recibirá las mesas cuando abra su turno.
 * Body: { sale_ids: string[], receiver_user_id: string }
 */
router.post('/shifts/transfer-tables', verifyToken, syncController.transferTablesToUser);

/**
 * GET /api/sync/sales/pending
 * Obtener ventas pendientes
 */
router.get('/sales/pending', verifyToken, syncController.getPendingSales);

module.exports = router;
