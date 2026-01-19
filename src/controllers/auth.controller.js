const { query } = require('../config/database');
const { generateToken } = require('../middleware/auth.middleware');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/auth/login
 * Login con PIN code
 */
async function login(req, res) {
  try {
    const { userId, pin } = req.body;

    // Validar campos requeridos
    if (!userId || !pin) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere userId y pin',
      });
    }

    // Validar formato de PIN (4 dígitos)
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: 'El PIN debe ser de 4 dígitos',
      });
    }

    // Buscar usuario por ID
    const users = await query(
      'SELECT id, name, username, pin_code, role, is_active FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    const user = users[0];

    // Verificar si está activo
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Usuario desactivado',
      });
    }

    // Verificar PIN (soporta hash bcrypt y texto plano para migración)
    let pinValid = false;

    if (user.pin_code.startsWith('$2')) {
      // PIN hasheado con bcrypt
      pinValid = await bcrypt.compare(pin, user.pin_code);
    } else {
      // PIN en texto plano (migración automática)
      pinValid = user.pin_code === pin;
      if (pinValid) {
        // Auto-migrar: hashear el PIN
        const hashedPin = await bcrypt.hash(pin, 10);
        await query('UPDATE users SET pin_code = ? WHERE id = ?', [hashedPin, user.id]);
      }
    }

    if (!pinValid) {
      return res.status(401).json({
        success: false,
        error: 'PIN incorrecto',
      });
    }

    // Generar token
    const token = generateToken(user);

    // Respuesta exitosa
    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
}

/**
 * POST /api/auth/login-username
 * Login alternativo con username + pin
 */
async function loginByUsername(req, res) {
  try {
    const { username, pin } = req.body;

    // Validar campos requeridos
    if (!username || !pin) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere username y pin',
      });
    }

    // Buscar usuario por username
    const users = await query(
      'SELECT id, name, username, pin_code, role, is_active FROM users WHERE username = ?',
      [username.toLowerCase().trim()]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    const user = users[0];

    // Verificar si está activo
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Usuario desactivado',
      });
    }

    // Verificar PIN (soporta hash bcrypt y texto plano para migración)
    let pinValid = false;

    if (user.pin_code.startsWith('$2')) {
      // PIN hasheado con bcrypt
      pinValid = await bcrypt.compare(pin, user.pin_code);
    } else {
      // PIN en texto plano (migración automática)
      pinValid = user.pin_code === pin;
      if (pinValid) {
        // Auto-migrar: hashear el PIN
        const hashedPin = await bcrypt.hash(pin, 10);
        await query('UPDATE users SET pin_code = ? WHERE id = ?', [hashedPin, user.id]);
      }
    }

    if (!pinValid) {
      return res.status(401).json({
        success: false,
        error: 'PIN incorrecto',
      });
    }

    // Generar token
    const token = generateToken(user);

    // Respuesta exitosa
    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
}

/**
 * GET /api/auth/users
 * Obtener lista de usuarios activos (para pantalla de login)
 */
async function getActiveUsers(req, res) {
  try {
    const users = await query(
      'SELECT id, name, username, role FROM users WHERE is_active = 1 ORDER BY name ASC'
    );

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
}

/**
 * GET /api/auth/verify
 * Verificar token actual
 */
async function verifyCurrentToken(req, res) {
  // Si llegó aquí es porque pasó el middleware verifyToken
  res.json({
    success: true,
    message: 'Token válido',
    data: {
      user: req.user,
    },
  });
}

async function registerEmergency(req, res) {
  try {
    const { name, username, role = 'admin', pin_code } = req.body;

    if (!name || !username || !pin_code) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren: name, username, pin_code',
      });
    }

    if (!/^\d{4}$/.test(pin_code)) {
      return res.status(400).json({
        success: false,
        error: 'El PIN debe ser de 4 dígitos',
      });
    }

    const existing = await query('SELECT id FROM users WHERE username = ?', [
      username.toLowerCase().trim(),
    ]);

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'El nombre de usuario ya existe',
      });
    }

    const id = uuidv4();
    const hashedPin = await bcrypt.hash(pin_code, 10);

    await query(
      `INSERT INTO users (id, name, username, pin_code, role, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, name.trim(), username.toLowerCase().trim(), hashedPin, role]
    );

    res.status(201).json({
      success: true,
      message: 'Usuario de emergencia creado exitosamente',
      data: {
        id,
        name: name.trim(),
        username: username.toLowerCase().trim(),
        role,
        is_active: true,
      },
    });
  } catch (error) {
    console.error('Error creando usuario de emergencia:', error);
    res.status(500).json({
      success: false,
      error: 'Error creando usuario de emergencia',
    });
  }
}

module.exports = {
  login,
  loginByUsername,
  getActiveUsers,
  verifyCurrentToken,
  registerEmergency,
};
