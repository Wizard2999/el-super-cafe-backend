const express = require('express');
const router = express.Router();
const salesController = require('../controllers/sales.controller');
const { verifyToken, requireKitchenAccess } = require('../middleware/auth.middleware');

/**
 * DELETE /api/sales/:saleId/items/:itemId
 * Eliminar item de venta
 */
router.delete('/:saleId/items/:itemId', verifyToken, salesController.deleteSaleItem);

/**
 * PATCH /api/sales/:saleId/items/:itemId/status
 * Actualizar estado de item
 */
router.patch('/:saleId/items/:itemId/status', verifyToken, requireKitchenAccess, salesController.updateItemStatus);

/**
 * POST /api/sales/:saleId/cancel
 * Anular venta
 */
router.post('/:saleId/cancel', verifyToken, salesController.cancelSale);

module.exports = router;
