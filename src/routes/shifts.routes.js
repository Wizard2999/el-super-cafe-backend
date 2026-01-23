const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middleware/auth.middleware');
const shiftsController = require('../controllers/shifts.controller');

/**
 * GET /api/shifts/active
 * Estado de turno relevante para el login
 */
router.get('/active', verifyToken, shiftsController.getActiveShift);

/**
 * PATCH /api/shifts/:id/activate
 * Activar turno en estado waiting_initial_cash
 */
router.patch('/:id/activate', verifyToken, shiftsController.activateShift);

module.exports = router;