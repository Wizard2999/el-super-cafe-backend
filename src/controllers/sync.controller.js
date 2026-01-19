const { query, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/sync
 * Sincronizar datos desde el dispositivo al servidor
 * Body: { sales: [], sale_items: [], movements: [], shifts: [] }
 */
async function syncFromDevice(req, res) {
  const deviceId = req.headers['x-device-id'] || 'unknown';

  try {
    const { sales = [], sale_items = [], movements = [], shifts = [] } = req.body;

    const results = {
      sales: { synced: 0, errors: [] },
      sale_items: { synced: 0, errors: [] },
      movements: { synced: 0, errors: [] },
      shifts: { synced: 0, errors: [] },
      inventory: { processed: 0, errors: [] },
    };

    // Sincronizar turnos primero (porque las ventas dependen de ellos)
    for (const shift of shifts) {
      try {
        await syncShift(shift);
        results.shifts.synced++;
      } catch (error) {
        results.shifts.errors.push({
          id: shift.id,
          error: error.message,
        });
      }
    }

    // Sincronizar ventas
    for (const sale of sales) {
      try {
        await syncSale(sale);
        results.sales.synced++;
      } catch (error) {
        results.sales.errors.push({
          id: sale.id,
          error: error.message,
        });
      }
    }

    // Sincronizar items de venta
    for (const item of sale_items) {
      try {
        await syncSaleItem(item);
        results.sale_items.synced++;
      } catch (error) {
        results.sale_items.errors.push({
          id: item.id,
          error: error.message,
        });
      }
    }

    // Sincronizar movimientos
    for (const movement of movements) {
      try {
        await syncMovement(movement);
        results.movements.synced++;
      } catch (error) {
        results.movements.errors.push({
          id: movement.id,
          error: error.message,
        });
      }
    }

    // Registrar en log de sincronización
    await logSync(deviceId, 'upload', results);

    res.json({
      success: true,
      message: 'Sincronización completada',
      data: results,
    });
  } catch (error) {
    console.error('Error en sincronización:', error);
    res.status(500).json({
      success: false,
      error: 'Error durante la sincronización',
      details: error.message,
    });
  }
}

/**
 * Sincronizar un turno
 */
async function syncShift(shift) {
  const sql = `
    INSERT INTO shifts (
      id, opened_by_id, opened_by_name, closed_by_id, closed_by_name,
      start_time, end_time, initial_cash, final_cash_reported,
      cash_difference, status, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      closed_by_id = VALUES(closed_by_id),
      closed_by_name = VALUES(closed_by_name),
      end_time = VALUES(end_time),
      final_cash_reported = VALUES(final_cash_reported),
      cash_difference = VALUES(cash_difference),
      status = VALUES(status),
      is_synced = 1,
      updated_at = CURRENT_TIMESTAMP
  `;

  await query(sql, [
    shift.id,
    shift.opened_by_id,
    shift.opened_by_name,
    shift.closed_by_id || null,
    shift.closed_by_name || null,
    new Date(shift.start_time),
    shift.end_time ? new Date(shift.end_time) : null,
    shift.initial_cash,
    shift.final_cash_reported || null,
    shift.cash_difference || null,
    shift.status,
  ]);
}

/**
 * Sincronizar una venta
 * @returns {boolean} true si es una venta nueva, false si ya existía
 */
async function syncSale(sale) {
  // Verificar si la venta ya existe
  const existing = await query('SELECT id FROM sales WHERE id = ?', [sale.id]);
  const isNew = existing.length === 0;

  const sql = `
    INSERT INTO sales (
      id, total, payment_method, status, observation,
      unpaid_authorized_by_id, shift_id, table_id, print_count,
      is_synced, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON DUPLICATE KEY UPDATE
      total = VALUES(total),
      payment_method = VALUES(payment_method),
      status = VALUES(status),
      observation = VALUES(observation),
      unpaid_authorized_by_id = VALUES(unpaid_authorized_by_id),
      print_count = VALUES(print_count),
      is_synced = 1,
      updated_at = CURRENT_TIMESTAMP
  `;

  await query(sql, [
    sale.id,
    sale.total,
    sale.payment_method,
    sale.status,
    sale.observation || null,
    sale.unpaid_authorized_by_id || null,
    sale.shift_id || null,
    sale.table_id || null,
    sale.print_count || 0,
    new Date(sale.created_at),
  ]);

  return isNew;
}

/**
 * Sincronizar un item de venta
 */
async function syncSaleItem(item) {
  const sql = `
    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, quantity, unit_price, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      quantity = VALUES(quantity),
      unit_price = VALUES(unit_price),
      is_synced = 1,
      updated_at = CURRENT_TIMESTAMP
  `;

  await query(sql, [
    item.id,
    item.sale_id,
    item.product_id,
    item.product_name,
    item.quantity,
    item.unit_price,
  ]);
}

/**
 * Procesar descuento de inventario para una venta
 * - Si manage_stock = 1: resta directamente del producto
 * - Si manage_stock = 0: busca receta y resta de los insumos
 */
async function processInventoryDeduction(saleId) {
  // Obtener todos los items de la venta
  const saleItems = await query(
    'SELECT product_id, quantity FROM sale_items WHERE sale_id = ?',
    [saleId]
  );

  if (saleItems.length === 0) {
    return;
  }

  for (const item of saleItems) {
    const { product_id, quantity } = item;

    // Obtener información del producto
    const products = await query(
      'SELECT id, manage_stock, stock_current FROM products WHERE id = ?',
      [product_id]
    );

    if (products.length === 0) {
      console.warn(`Producto no encontrado: ${product_id}`);
      continue;
    }

    const product = products[0];

    if (product.manage_stock === 1) {
      // Producto con stock directo: restar cantidad vendida
      await query(
        `UPDATE products
         SET stock_current = GREATEST(0, stock_current - ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [quantity, product_id]
      );
    } else {
      // Producto preparado: buscar receta y descontar insumos
      const recipes = await query(
        'SELECT ingredient_id, quantity_required FROM recipes WHERE product_id = ?',
        [product_id]
      );

      for (const recipe of recipes) {
        const { ingredient_id, quantity_required } = recipe;

        // Calcular cantidad total a descontar (cantidad vendida * cantidad por unidad)
        const totalToDeduct = quantity * quantity_required;

        // Descontar del insumo
        await query(
          `UPDATE products
           SET stock_current = GREATEST(0, stock_current - ?),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [totalToDeduct, ingredient_id]
        );
      }
    }
  }
}

/**
 * Sincronizar un movimiento
 */
async function syncMovement(movement) {
  const sql = `
    INSERT INTO movements (
      id, type, amount, description, shift_id, is_synced, created_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
    ON DUPLICATE KEY UPDATE
      amount = VALUES(amount),
      description = VALUES(description),
      is_synced = 1,
      updated_at = CURRENT_TIMESTAMP
  `;

  await query(sql, [
    movement.id,
    movement.type,
    movement.amount,
    movement.description,
    movement.shift_id || null,
    new Date(movement.created_at),
  ]);
}

/**
 * Registrar log de sincronización
 */
async function logSync(deviceId, syncType, results) {
  const totalRecords =
    results.sales.synced +
    results.sale_items.synced +
    results.movements.synced +
    results.shifts.synced;

  const totalErrors =
    results.sales.errors.length +
    results.sale_items.errors.length +
    results.movements.errors.length +
    results.shifts.errors.length +
    (results.inventory?.errors?.length || 0);

  const status = totalErrors === 0 ? 'success' : totalRecords > 0 ? 'partial' : 'failed';

  await query(
    `INSERT INTO sync_log (device_id, sync_type, table_name, records_count, status, error_message)
     VALUES (?, ?, 'all', ?, ?, ?)`,
    [deviceId, syncType, totalRecords, status, totalErrors > 0 ? JSON.stringify(results) : null]
  );
}

/**
 * POST /api/sync/sales
 * Sincronizar solo ventas
 */
async function syncSales(req, res) {
  const deviceId = req.headers['x-device-id'] || 'unknown';

  try {
    const { sales = [], sale_items = [] } = req.body;

    const results = {
      sales: { synced: 0, errors: [] },
      sale_items: { synced: 0, errors: [] },
      inventory: { processed: 0, errors: [] },
    };

    // Sincronizar ventas
    for (const sale of sales) {
      try {
        await syncSale(sale);
        results.sales.synced++;
      } catch (error) {
        results.sales.errors.push({
          id: sale.id,
          error: error.message,
        });
      }
    }

    // Sincronizar items
    for (const item of sale_items) {
      try {
        await syncSaleItem(item);
        results.sale_items.synced++;
      } catch (error) {
        results.sale_items.errors.push({
          id: item.id,
          error: error.message,
        });
      }
    }

    await query(
      `INSERT INTO sync_log (device_id, sync_type, table_name, records_count, status)
       VALUES (?, 'upload', 'sales', ?, ?)`,
      [deviceId, results.sales.synced, results.sales.errors.length === 0 ? 'success' : 'partial']
    );

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('Error sincronizando ventas:', error);
    res.status(500).json({
      success: false,
      error: 'Error sincronizando ventas',
    });
  }
}

/**
 * POST /api/sync/movements
 * Sincronizar solo movimientos
 */
async function syncMovements(req, res) {
  const deviceId = req.headers['x-device-id'] || 'unknown';

  try {
    const { movements = [] } = req.body;

    const results = {
      movements: { synced: 0, errors: [] },
    };

    for (const movement of movements) {
      try {
        await syncMovement(movement);
        results.movements.synced++;
      } catch (error) {
        results.movements.errors.push({
          id: movement.id,
          error: error.message,
        });
      }
    }

    await query(
      `INSERT INTO sync_log (device_id, sync_type, table_name, records_count, status)
       VALUES (?, 'upload', 'movements', ?, ?)`,
      [
        deviceId,
        results.movements.synced,
        results.movements.errors.length === 0 ? 'success' : 'partial',
      ]
    );

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('Error sincronizando movimientos:', error);
    res.status(500).json({
      success: false,
      error: 'Error sincronizando movimientos',
    });
  }
}

/**
 * GET /api/sync/status
 * Obtener estado de sincronización
 */
async function getSyncStatus(req, res) {
  const deviceId = req.headers['x-device-id'] || 'unknown';

  try {
    // Último sync exitoso
    const lastSync = await query(
      `SELECT * FROM sync_log
       WHERE device_id = ? AND status = 'success'
       ORDER BY created_at DESC LIMIT 1`,
      [deviceId]
    );

    // Conteo de registros
    const counts = await query(`
      SELECT
        (SELECT COUNT(*) FROM sales WHERE is_synced = 1) AS synced_sales,
        (SELECT COUNT(*) FROM movements WHERE is_synced = 1) AS synced_movements,
        (SELECT COUNT(*) FROM shifts WHERE is_synced = 1) AS synced_shifts
    `);

    res.json({
      success: true,
      data: {
        lastSync: lastSync[0] || null,
        counts: counts[0],
      },
    });
  } catch (error) {
    console.error('Error obteniendo estado de sync:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo estado',
    });
  }
}

/**
 * GET /api/sync/users
 * Descargar usuarios al dispositivo para sincronización offline
 * Requiere autenticación - solo usuarios autenticados pueden descargar
 */
async function syncUsersToDevice(req, res) {
  try {
    // Obtener todos los usuarios activos con PIN
    const users = await query(
      `SELECT id, name, username, pin_code, role, is_active
       FROM users
       WHERE is_active = 1
       ORDER BY name ASC`
    );

    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error('Error sincronizando usuarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo usuarios',
    });
  }
}

module.exports = {
  syncFromDevice,
  syncSales,
  syncMovements,
  getSyncStatus,
  syncUsersToDevice,
  processInventoryDeduction,
};
