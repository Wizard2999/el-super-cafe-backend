const express = require('express');
const router = express.Router();

const syncController = require('../controllers/sync.controller');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * POST /api/sync
 * Sincronización completa desde el dispositivo
 * Body: { sales: [], sale_items: [], movements: [], shifts: [] }
 * Headers: X-Device-ID (opcional)
 */
router.post('/', verifyToken, syncController.syncFromDevice);

/**
 * POST /api/sync/sales
 * Sincronizar solo ventas
 * Body: { sales: [], sale_items: [] }
 */
router.post('/sales', verifyToken, syncController.syncSales);

/**
 * POST /api/sync/movements
 * Sincronizar solo movimientos
 * Body: { movements: [] }
 */
router.post('/movements', verifyToken, syncController.syncMovements);

/**
 * GET /api/sync/status
 * Obtener estado de sincronización
 */
router.get('/status', verifyToken, syncController.getSyncStatus);

/**
 * GET /api/sync/users
 * Descargar usuarios al dispositivo (requiere autenticación)
 * Retorna usuarios con PIN para sincronización offline
 */
router.get('/users', verifyToken, syncController.syncUsersToDevice);

/**
 * GET /api/shifts/open
 * Obtener turnos abiertos (excluyendo el turno actual del dispositivo)
 * Query params: exclude_shift_id (opcional)
 */
router.get('/shifts/open', verifyToken, syncController.getOpenShifts);

/**
 * PATCH /api/shifts/handover
 * Traspasar ventas pendientes a otro turno
 * Body: { sale_ids: string[], new_shift_id: string }
 */
router.patch('/shifts/handover', verifyToken, syncController.handoverPendingSales);

module.exports = router;
