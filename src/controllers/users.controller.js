const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

/**
 * GET /api/users
 * Obtener todos los usuarios
 */
async function getAllUsers(req, res) {
  try {
    const users = await query(
      `SELECT id, name, username, role, is_active, created_at, updated_at
       FROM users ORDER BY name ASC`
    );

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo usuarios',
    });
  }
}

/**
 * GET /api/users/:id
 * Obtener usuario por ID
 */
async function getUserById(req, res) {
  try {
    const { id } = req.params;

    const users = await query(
      `SELECT id, name, username, role, is_active, created_at, updated_at
       FROM users WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    res.json({
      success: true,
      data: users[0],
    });
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo usuario',
    });
  }
}

/**
 * POST /api/users
 * Crear nuevo usuario
 */
async function createUser(req, res) {
  try {
    const { name, username, pin_code, role = 'employee' } = req.body;

    // Validaciones
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

    // Verificar username único
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

    // Hashear el PIN antes de guardar
    const hashedPin = await bcrypt.hash(pin_code, 10);

    await query(
      `INSERT INTO users (id, name, username, pin_code, role, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, name.trim(), username.toLowerCase().trim(), hashedPin, role]
    );

    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente',
      data: {
        id,
        name: name.trim(),
        username: username.toLowerCase().trim(),
        role,
        is_active: true,
      },
    });
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error creando usuario',
    });
  }
}

/**
 * PUT /api/users/:id
 * Actualizar usuario
 */
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { name, username, pin_code, role, is_active } = req.body;

    // Verificar que existe
    const existing = await query('SELECT id FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    // Construir query dinámico
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim());
    }

    if (username !== undefined) {
      // Verificar username único (excepto el actual)
      const duplicate = await query('SELECT id FROM users WHERE username = ? AND id != ?', [
        username.toLowerCase().trim(),
        id,
      ]);

      if (duplicate.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'El nombre de usuario ya existe',
        });
      }

      updates.push('username = ?');
      values.push(username.toLowerCase().trim());
    }

    if (pin_code !== undefined) {
      if (!/^\d{4}$/.test(pin_code)) {
        return res.status(400).json({
          success: false,
          error: 'El PIN debe ser de 4 dígitos',
        });
      }
      // Hashear el nuevo PIN
      const hashedPin = await bcrypt.hash(pin_code, 10);
      updates.push('pin_code = ?');
      values.push(hashedPin);
    }

    if (role !== undefined) {
      updates.push('role = ?');
      values.push(role);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay campos para actualizar',
      });
    }

    values.push(id);

    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({
      success: true,
      message: 'Usuario actualizado exitosamente',
    });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando usuario',
    });
  }
}

/**
 * DELETE /api/users/:id
 * Eliminar usuario (soft delete - desactivar)
 */
async function deleteUser(req, res) {
  try {
    const { id } = req.params;

    // Verificar que existe
    const existing = await query('SELECT id, username FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    // No permitir eliminar si tiene turno abierto
    const openShift = await query(
      `SELECT id FROM shifts WHERE opened_by_id = ? AND status = 'open'`,
      [id]
    );

    if (openShift.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar un usuario con turno abierto',
      });
    }

    // Soft delete
    await query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Usuario desactivado exitosamente',
    });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando usuario',
    });
  }
}

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};
