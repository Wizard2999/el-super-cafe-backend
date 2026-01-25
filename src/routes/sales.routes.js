const express = require('express');
const router = express.Router();
const salesController = require('../controllers/sales.controller');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * DELETE /api/sales/:saleId/items/:productId
 * Eliminar item de venta
 */
router.delete('/:saleId/items/:productId', verifyToken, salesController.deleteSaleItem);

/**
 * POST /api/sales/:saleId/cancel
 * Anular venta
 */
router.post('/:saleId/cancel', verifyToken, salesController.cancelSale);

module.exports = router;
