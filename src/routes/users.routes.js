const express = require('express');
const router = express.Router();

const usersController = require('../controllers/users.controller');
const { verifyToken, requireAdmin } = require('../middleware/auth.middleware');

/**
 * GET /api/users
 * Obtener todos los usuarios
 * Requiere: autenticación + admin
 */
router.get('/', verifyToken, requireAdmin, usersController.getAllUsers);

/**
 * GET /api/users/:id
 * Obtener usuario por ID
 * Requiere: autenticación + admin
 */
router.get('/:id', verifyToken, requireAdmin, usersController.getUserById);

/**
 * POST /api/users
 * Crear nuevo usuario
 * Requiere: autenticación + admin
 */
router.post('/', verifyToken, requireAdmin, usersController.createUser);

/**
 * PUT /api/users/:id
 * Actualizar usuario
 * Requiere: autenticación + admin
 */
router.put('/:id', verifyToken, requireAdmin, usersController.updateUser);

/**
 * DELETE /api/users/:id
 * Eliminar usuario (soft delete)
 * Requiere: autenticación + admin
 */
router.delete('/:id', verifyToken, requireAdmin, usersController.deleteUser);

module.exports = router;
