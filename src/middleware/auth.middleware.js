const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'el-super-cafe-secret-key-cambiar';

/**
 * Middleware para verificar token JWT
 */
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token no proporcionado',
      });
    }

    const token = authHeader.substring(7);

    const decoded = jwt.verify(token, JWT_SECRET);

    // Verificar que el usuario siga existiendo y activo
    const users = await query(
      'SELECT id, name, username, role, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Usuario desactivado',
      });
    }

    // Agregar usuario al request
    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expirado',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Token inválido',
      });
    }

    console.error('Error verificando token:', error);
    return res.status(500).json({
      success: false,
      error: 'Error de autenticación',
    });
  }
}

/**
 * Middleware para verificar rol de admin
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'No autenticado',
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Acceso denegado. Se requiere rol de administrador.',
    });
  }

  next();
}

/**
 * Middleware para verificar acceso a inventario (admin o auxiliar_inventario)
 */
function requireInventoryAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'No autenticado',
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'auxiliar_inventario') {
    return res.status(403).json({
      success: false,
      error: 'Acceso denegado. Se requiere acceso a inventario.',
    });
  }

  next();
}

/**
 * Middleware para verificar acceso a cocina (admin o kitchen)
 */
function requireKitchenAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'No autenticado',
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'kitchen') {
    return res.status(403).json({
      success: false,
      error: 'Acceso denegado. Se requiere acceso a cocina.',
    });
  }

  next();
}

/**
 * Genera un token JWT para el usuario
 */
function generateToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
}

module.exports = {
  verifyToken,
  requireAdmin,
  requireInventoryAccess,
  requireKitchenAccess,
  generateToken,
};
