const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalog.controller');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * PUT /api/tables/:id/status
 * Actualizar estado de mesa (usando controlador existente de catálogo)
 */
router.put('/:id/status', verifyToken, catalogController.updateTableStatus);

module.exports = router;
