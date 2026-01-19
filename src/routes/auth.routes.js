const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * POST /api/auth/login
 * Login con userId + pin
 * Body: { userId: string, pin: string }
 */
router.post('/login', authController.login);

/**
 * POST /api/auth/login-username
 * Login alternativo con username + pin
 * Body: { username: string, pin: string }
 */
router.post('/login-username', authController.loginByUsername);

/**
 * GET /api/auth/users
 * Obtener lista de usuarios activos (para pantalla de login)
 * No requiere autenticación
 */
router.get('/users', authController.getActiveUsers);

/**
 * GET /api/auth/verify
 * Verificar token actual
 * Requiere autenticación
 */
router.get('/verify', verifyToken, authController.verifyCurrentToken);

router.post('/register-emergency', authController.registerEmergency);

module.exports = router;
