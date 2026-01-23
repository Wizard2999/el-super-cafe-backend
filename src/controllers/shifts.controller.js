const { query } = require('../config/database');
const socketEvents = require('../services/socketEvents');

/**
 * GET /api/shifts/active
 * Determina el estado de turno relevante para el usuario autenticado.
 * Prioridad:
 * 1) Si el usuario tiene un turno en estado 'waiting_initial_cash' -> devolver ese estado
 * 2) Si existe un turno 'open' global -> devolver ese turno
 * 3) Si no hay turno -> devolver null
 */
async function getActiveShift(req, res) {
  try {
    const userId = req.user?.id;

    // 1) Turno en espera de efectivo inicial para el usuario autenticado
    const waitingRows = await query(
      `SELECT id, opened_by_id, opened_by_name, start_time, initial_cash, status
       FROM shifts
       WHERE status = 'waiting_initial_cash' AND opened_by_id = ?
       ORDER BY start_time DESC
       LIMIT 1`,
      [userId]
    );

    if (waitingRows.length > 0) {
      const s = waitingRows[0];
      return res.json({
        success: true,
        data: {
          status: 'waiting_initial_cash',
          shift: {
            id: s.id,
            opened_by_id: s.opened_by_id,
            opened_by_name: s.opened_by_name,
            start_time: s.start_time,
            initial_cash: parseFloat(s.initial_cash),
            status: s.status,
          },
        },
      });
    }

    // 2) Turno global abierto (único)
    const openRows = await query(
      `SELECT id, opened_by_id, opened_by_name, start_time, initial_cash, status
       FROM shifts
       WHERE status = 'open'
       ORDER BY start_time DESC
       LIMIT 1`
    );

    if (openRows.length > 0) {
      const s = openRows[0];
      return res.json({
        success: true,
        data: {
          status: 'open',
          shift: {
            id: s.id,
            opened_by_id: s.opened_by_id,
            opened_by_name: s.opened_by_name,
            start_time: s.start_time,
            initial_cash: parseFloat(s.initial_cash),
            status: s.status,
          },
        },
      });
    }

    // 3) No hay turno
    return res.json({ success: true, data: { status: null } });
  } catch (error) {
    console.error('Error en getActiveShift:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo estado de turno' });
  }
}

/**
 * PATCH /api/shifts/:id/activate
 * Activa un turno en estado 'waiting_initial_cash' asignado al usuario autenticado
 * Body: { initial_cash: number }
 */
async function activateShift(req, res) {
  try {
    const { id } = req.params;
    const { initial_cash } = req.body;

    if (!id || typeof initial_cash !== 'number') {
      return res.status(400).json({ success: false, error: 'Parámetros inválidos' });
    }

    // Validar turno
    const rows = await query(
      `SELECT id, status, opened_by_id, opened_by_name, start_time, initial_cash
       FROM shifts WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Turno no encontrado' });
    }

    const shift = rows[0];
    if (shift.status !== 'waiting_initial_cash') {
      return res.status(400).json({ success: false, error: 'El turno no está en espera de efectivo inicial' });
    }

    if (shift.opened_by_id !== req.user?.id) {
      return res.status(403).json({ success: false, error: 'No autorizado para activar este turno' });
    }

    // Activar turno: establecer efectivo inicial y estado 'open'
    await query(
      `UPDATE shifts
       SET initial_cash = ?, status = 'open', start_time = COALESCE(start_time, CURRENT_TIMESTAMP), is_synced = 1
       WHERE id = ?`,
      [initial_cash, id]
    );

    // Emitir evento de cambio de turno
    socketEvents.emitShiftChange({ shiftId: id, status: 'open', userName: shift.opened_by_name });

    return res.json({
      success: true,
      data: {
        id,
        opened_by_id: shift.opened_by_id,
        opened_by_name: shift.opened_by_name,
        start_time: shift.start_time,
        initial_cash: initial_cash,
        status: 'open',
      },
    });
  } catch (error) {
    console.error('Error en activateShift:', error);
    res.status(500).json({ success: false, error: 'Error activando turno' });
  }
}

module.exports = { getActiveShift, activateShift };