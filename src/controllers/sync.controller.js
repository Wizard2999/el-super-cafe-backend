const { query, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const socketEvents = require('../services/socketEvents');
const StockService = require('../services/StockService');

/**
 * Emitir evento order:update con items incluidos
 * Se llama DESPUÉS de que los items estén sincronizados
 */
async function emitOrderUpdateWithItems(saleId, tableId) {
  try {
    const saleItems = await query(
      'SELECT id, sale_id, product_id, product_name, quantity, unit_price FROM sale_items WHERE sale_id = ?',
      [saleId]
    );

    socketEvents.emitOrderUpdate({
      tableId,
      saleId,
      items: saleItems,
      status: 'pending',
    });
  } catch (error) {
    console.error(`Error emitiendo order:update para venta ${saleId}:`, error);
  }
}

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
    // También rastrear si hay un turno abierto existente para informar al cliente
    let existingOpenShift = null;
    let linkedSalesInfo = null;

    for (const shift of shifts) {
      try {
        const shiftResult = await syncShift(shift);
        if (shiftResult && shiftResult.existingShift) {
          existingOpenShift = shiftResult.existingShift;
        }
        // Capture linked sales info for Transit State handover
        if (shiftResult && shiftResult.linkedSalesCount > 0) {
          linkedSalesInfo = {
            shiftId: shift.id,
            linkedSalesCount: shiftResult.linkedSalesCount,
            linkedTables: shiftResult.linkedTables || [],
          };
        }
        results.shifts.synced++;
      } catch (error) {
        results.shifts.errors.push({
          id: shift.id,
          error: error.message,
        });
      }
    }

    // Si hay un turno abierto existente, incluirlo en la respuesta
    if (existingOpenShift) {
      results.existingOpenShift = existingOpenShift;
    }

    // Si se vincularon ventas huérfanas (Transit State), incluirlo en la respuesta
    if (linkedSalesInfo) {
      results.linkedSalesInfo = linkedSalesInfo;
    }

    // Sincronizar ventas y rastrear las que necesitan descuento de inventario
    const salesNeedingInventoryDeduction = [];
    for (const sale of sales) {
      try {
        const needsInventoryDeduction = await syncSale(sale);
        results.sales.synced++;
        // Si necesita descuento de inventario, marcarla
        if (needsInventoryDeduction) {
          salesNeedingInventoryDeduction.push(sale.id);
        }
      } catch (error) {
        results.sales.errors.push({
          id: sale.id,
          error: error.message,
        });
      }
    }

    // Sincronizar items de venta
    // ESTRATEGIA UPDATE: Agrupar por sale_id y reemplazar items para evitar duplicados
    // y recalcular el total real en el backend.
    const itemsBySaleId = new Map();
    for (const item of sale_items) {
      if (!itemsBySaleId.has(item.sale_id)) {
        itemsBySaleId.set(item.sale_id, []);
      }
      itemsBySaleId.get(item.sale_id).push(item);
    }

    for (const [saleId, items] of itemsBySaleId) {
      try {
        // 1. Limpiar items anteriores para esta venta (Opción A: Reemplazo total)
        await query('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);

        // 2. Insertar la nueva lista completa
        for (const item of items) {
          await syncSaleItem(item);
          results.sale_items.synced++;
        }

        // 3. Recalcular total en sales para asegurar consistencia
        const [totalResult] = await query(
          'SELECT SUM(quantity * unit_price) as total FROM sale_items WHERE sale_id = ?',
          [saleId]
        );
        const newTotal = totalResult.total || 0;
        
        await query('UPDATE sales SET total = ? WHERE id = ?', [newTotal, saleId]);
        
        console.log(`[Sync] Venta ${saleId}: Items reemplazados y total recalculado a ${newTotal}`);

      } catch (error) {
        console.error(`Error sincronizando items para venta ${saleId}:`, error);
        // Marcar error para cada item de esta venta
        for (const item of items) {
          results.sale_items.errors.push({
            id: item.id,
            error: error.message,
          });
        }
      }
    }

    // Emitir eventos de order:update para ventas pendientes DESPUÉS de que los items estén sincronizados
    for (const sale of sales) {
      if (sale.status === 'pending' && sale.table_id) {
        await emitOrderUpdateWithItems(sale.id, sale.table_id);
      }
    }

    // Procesar descuento de inventario para ventas que lo necesitan
    // (después de que los items estén sincronizados)
    for (const saleId of salesNeedingInventoryDeduction) {
      try {
        await processInventoryDeduction(saleId);
        results.inventory.processed++;
      } catch (error) {
        console.error(`Error procesando inventario para venta ${saleId}:`, error);
        results.inventory.errors.push({
          saleId,
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
 * Si se intenta crear un turno nuevo con status='open' pero ya existe otro turno abierto,
 * se devuelve el turno existente en lugar de crear uno nuevo (unicidad de turno)
 */
async function syncShift(shift) {
  // Verificar si es un turno nuevo o actualización
  const existing = await query('SELECT id, status FROM shifts WHERE id = ?', [shift.id]);
  const isNew = existing.length === 0;
  const previousStatus = existing.length > 0 ? existing[0].status : null;

  // VALIDACIÓN DE UNICIDAD: Si se intenta crear un nuevo turno abierto
  if (isNew && shift.status === 'open') {
    // Verificar si ya existe OTRO turno abierto
    const existingOpenShifts = await query(
      'SELECT id, opened_by_id, opened_by_name, start_time, initial_cash, status FROM shifts WHERE status = ? AND id != ?',
      ['open', shift.id]
    );

    if (existingOpenShifts.length > 0) {
      // Ya existe un turno abierto - emitir evento y devolver info del existente
      const openShift = existingOpenShifts[0];
      console.log(`[Shift] Ya existe turno abierto ${openShift.id}, no se crea duplicado`);

      // Emitir evento para notificar al dispositivo que ya hay un turno abierto
      socketEvents.emitShiftChange({
        shiftId: openShift.id,
        status: 'open',
        userName: openShift.opened_by_name,
      });

      // Retornar información del turno existente (el dispositivo debe usar este)
      return {
        existingShift: {
          id: openShift.id,
          opened_by_id: openShift.opened_by_id,
          opened_by_name: openShift.opened_by_name,
          start_time: openShift.start_time,
          initial_cash: parseFloat(openShift.initial_cash),
          status: openShift.status,
        }
      };
    }
  }

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

  // Emitir evento de WebSocket si el turno es nuevo o cambió de estado
  if (isNew || previousStatus !== shift.status) {
    socketEvents.emitShiftChange({
      shiftId: shift.id,
      status: shift.status,
      userName: shift.opened_by_name,
    });
  }

  // TRANSIT STATE: If a new shift is created with status 'open',
  // link any orphan sales assigned to this user
  if (isNew && shift.status === 'open' && shift.opened_by_id) {
    const linkResult = await linkOrphanSalesToShift(shift.opened_by_id, shift.id);
    if (linkResult.count > 0) {
      console.log(`[Shift] Linked ${linkResult.count} orphan sales to new shift ${shift.id}`);
      return {
        linkedSalesCount: linkResult.count,
        linkedTables: linkResult.tables,
      };
    }
  }
}

/**
 * Sincronizar una venta
 * @returns {boolean} true si la venta es nueva y completada (o pasó a completada por primera vez)
 */
async function syncSale(sale) {
  // Verificar si la venta ya existe
  const existing = await query('SELECT id, status FROM sales WHERE id = ?', [sale.id]);
  const isNew = existing.length === 0;
  const previousStatus = existing.length > 0 ? existing[0].status : null;

  // Determinar si necesita descuento de inventario:
  // - Venta nueva con status completed
  // - O venta existente que cambia a completed por primera vez
  const needsInventoryDeduction =
    (isNew && sale.status === 'completed') ||
    (!isNew && previousStatus !== 'completed' && sale.status === 'completed');

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

  // Emitir eventos de socket según el estado
  if (sale.status === 'completed' && previousStatus !== 'completed') {
    // Venta completada - emitir evento de venta y liberar mesa
    socketEvents.emitSaleComplete({
      saleId: sale.id,
      tableId: sale.table_id,
      total: sale.total,
      paymentMethod: sale.payment_method,
      status: sale.status,
    });

    // Si la venta tiene una mesa asociada, liberarla
    if (sale.table_id) {
      await query(
        `UPDATE cafe_tables SET status = 'free', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [sale.table_id]
      );
      const tableInfo = await query('SELECT name FROM cafe_tables WHERE id = ?', [sale.table_id]);
      socketEvents.emitTableStatusChange({
        tableId: sale.table_id,
        tableName: tableInfo[0]?.name || 'Mesa',
        status: 'free',
      });
    }
  } else if (sale.status === 'pending' && isNew && sale.table_id) {
    // Nuevo pedido pendiente en mesa - ocupar mesa
    await query(
      `UPDATE cafe_tables SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sale.table_id]
    );
    const tableInfo = await query('SELECT name FROM cafe_tables WHERE id = ?', [sale.table_id]);
    socketEvents.emitTableStatusChange({
      tableId: sale.table_id,
      tableName: tableInfo[0]?.name || 'Mesa',
      status: 'occupied',
      currentSaleId: sale.id,
    });
    // NOTA: El evento order:update se emite después de sincronizar los items
  }
  // Para ventas pendientes, el evento order:update se emite después de sincronizar los items

  return needsInventoryDeduction;
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
      const previousStock = product.stock_current;
      const newStock = Math.max(0, previousStock - quantity);

      await query(
        `UPDATE products
         SET stock_current = GREATEST(0, stock_current - ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [quantity, product_id]
      );

      // Emitir evento de cambio de stock
      const productInfo = await query('SELECT name FROM products WHERE id = ?', [product_id]);
      socketEvents.emitStockChange({
        productId: product_id,
        productName: productInfo[0]?.name || 'Producto',
        previousStock,
        newStock,
        reason: 'sale',
      });
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

        // Obtener stock actual del insumo
        const ingredientInfo = await query(
          'SELECT name, stock_current FROM products WHERE id = ?',
          [ingredient_id]
        );

        if (ingredientInfo.length > 0) {
          const previousStock = ingredientInfo[0].stock_current;
          const newStock = Math.max(0, previousStock - totalToDeduct);

          // Descontar del insumo
          await query(
            `UPDATE products
             SET stock_current = GREATEST(0, stock_current - ?),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [totalToDeduct, ingredient_id]
          );

          // Emitir evento de cambio de stock del insumo
          socketEvents.emitStockChange({
            productId: ingredient_id,
            productName: ingredientInfo[0].name,
            previousStock,
            newStock,
            reason: 'recipe_deduction',
          });
        }
      }
    }
  }
}

/**
 * Sincronizar un movimiento
 */
async function syncMovement(movement) {
  // Verificar si es nuevo
  const existing = await query('SELECT id FROM movements WHERE id = ?', [movement.id]);
  const isNew = existing.length === 0;

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

  // Emitir evento si es nuevo
  if (isNew) {
    socketEvents.emitMovementCreate({
      movementId: movement.id,
      type: movement.type,
      amount: movement.amount,
      description: movement.description,
      shiftId: movement.shift_id || null,
    });
  }
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
 * Sincronizar ventas con validación de stock
 *
 * IMPORTANTE: Si una venta es nueva y status='completed', se valida stock ANTES de guardar.
 * Si no hay stock suficiente, se retorna error 400 y la venta NO se registra.
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

    // Agrupar items por sale_id para validación
    const itemsBySaleId = new Map();
    for (const item of sale_items) {
      if (!itemsBySaleId.has(item.sale_id)) {
        itemsBySaleId.set(item.sale_id, []);
      }
      itemsBySaleId.get(item.sale_id).push(item);
    }

    // Procesar cada venta
    for (const sale of sales) {
      try {
        // Verificar si la venta ya existe
        const existing = await query('SELECT id, status FROM sales WHERE id = ?', [sale.id]);
        const isNew = existing.length === 0;
        const previousStatus = existing.length > 0 ? existing[0].status : null;

        // Determinar si necesita validación de stock:
        // - Venta nueva con status completed
        // - O venta existente que cambia a completed por primera vez
        const needsStockValidation =
          (isNew && sale.status === 'completed') ||
          (!isNew && previousStatus !== 'completed' && sale.status === 'completed');

        const saleItems = itemsBySaleId.get(sale.id) || [];

        if (needsStockValidation && saleItems.length > 0) {
          // === VALIDACIÓN DE STOCK ANTES DE PROCESAR ===
          const stockValidation = await StockService.validateStockForItems(saleItems);

          if (!stockValidation.isValid) {
            // Stock insuficiente - retornar error 400 inmediatamente
            const errorMessage = StockService.formatValidationErrors(stockValidation.errors);
            console.warn(`[syncSales] Stock insuficiente para venta ${sale.id}:`, errorMessage);

            return res.status(400).json({
              success: false,
              error: errorMessage,
              stockErrors: stockValidation.errors,
              saleId: sale.id,
            });
          }

          // === TRANSACCIÓN: Crear venta + items + descontar stock atómicamente ===
          await transaction(async (conn) => {
            // 1. Crear/actualizar la venta
            await conn.execute(
              `INSERT INTO sales (
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
                updated_at = CURRENT_TIMESTAMP`,
              [
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
              ]
            );

            // 2. Crear items de la venta (REPLACE STRATEGY)
            // Borrar items anteriores para evitar duplicados y asegurar consistencia
            await conn.execute('DELETE FROM sale_items WHERE sale_id = ?', [sale.id]);

            for (const item of saleItems) {
              await conn.execute(
                `INSERT INTO sale_items (
                  id, sale_id, product_id, product_name, quantity, unit_price, is_synced
                ) VALUES (?, ?, ?, ?, ?, ?, 1)
                ON DUPLICATE KEY UPDATE
                  quantity = VALUES(quantity),
                  unit_price = VALUES(unit_price),
                  is_synced = 1,
                  updated_at = CURRENT_TIMESTAMP`,
                [item.id, item.sale_id, item.product_id, item.product_name, item.quantity, item.unit_price]
              );
            }

            // 3. Recalcular total real desde items
            const [totalRes] = await conn.execute(
              'SELECT SUM(quantity * unit_price) as total FROM sale_items WHERE sale_id = ?',
              [sale.id]
            );
            const newTotal = totalRes[0].total || 0;
            await conn.execute('UPDATE sales SET total = ? WHERE id = ?', [newTotal, sale.id]);

            // 4. Descontar stock dentro de la misma transacción
            // (Usamos los saleItems que acabamos de insertar/validar)
            await StockService.deductStockForItems(conn, saleItems);

            // 5. Liberar mesa si aplica
            if (sale.table_id) {
              await conn.execute(
                `UPDATE cafe_tables SET status = 'free', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [sale.table_id]
              );
            }
          });

          results.sales.synced++;
          results.inventory.processed++;

          // Emitir eventos de socket
          socketEvents.emitSaleComplete({
            saleId: sale.id,
            tableId: sale.table_id,
            total: sale.total,
            paymentMethod: sale.payment_method,
            status: sale.status,
          });

          if (sale.table_id) {
            const tableInfo = await query('SELECT name FROM cafe_tables WHERE id = ?', [sale.table_id]);
            socketEvents.emitTableStatusChange({
              tableId: sale.table_id,
              tableName: tableInfo[0]?.name || 'Mesa',
              status: 'free',
            });
          }

          // Marcar items como sincronizados en results
          results.sale_items.synced += saleItems.length;
        } else {
          // Venta pendiente o sin cambio a completed - procesar normalmente (sin validación de stock)
          const needsInventoryDeduction = await syncSale(sale);
          results.sales.synced++;

          // Sincronizar items de esta venta (REPLACE STRATEGY)
          // 1. Limpiar items anteriores
          await query('DELETE FROM sale_items WHERE sale_id = ?', [sale.id]);

          // 2. Insertar nuevos items
          for (const item of saleItems) {
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

          // 3. Recalcular total real
          try {
            const [totalRes] = await query(
              'SELECT SUM(quantity * unit_price) as total FROM sale_items WHERE sale_id = ?',
              [sale.id]
            );
            const newTotal = totalRes.total || 0;
            await query('UPDATE sales SET total = ? WHERE id = ?', [newTotal, sale.id]);
          } catch (error) {
            console.error(`Error recalculando total para venta ${sale.id}:`, error);
          }

          // Emitir order:update para ventas pendientes
          if (sale.status === 'pending' && sale.table_id) {
            await emitOrderUpdateWithItems(sale.id, sale.table_id);
          }

          // Procesar descuento de inventario si es necesario (para compatibilidad con flujo anterior)
          if (needsInventoryDeduction) {
            try {
              await processInventoryDeduction(sale.id);
              results.inventory.processed++;
            } catch (error) {
              console.error(`Error procesando inventario para venta ${sale.id}:`, error);
              results.inventory.errors.push({
                saleId: sale.id,
                error: error.message,
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error sincronizando venta ${sale.id}:`, error);
        results.sales.errors.push({
          id: sale.id,
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

/**
 * PATCH /api/sync/shifts/handover
 * Traspasar ventas pendientes de un turno a otro
 * Body: { sale_ids: string[], new_shift_id: string }
 */
async function handoverPendingSales(req, res) {
  try {
    const { sale_ids, new_shift_id } = req.body;

    // Validar parámetros
    if (!sale_ids || !Array.isArray(sale_ids) || sale_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere un array de sale_ids',
      });
    }

    if (!new_shift_id) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere new_shift_id',
      });
    }

    // Verificar que el turno destino existe y está abierto
    const targetShift = await query(
      'SELECT id, status, opened_by_name FROM shifts WHERE id = ?',
      [new_shift_id]
    );

    if (targetShift.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'El turno destino no existe',
      });
    }

    if (targetShift[0].status !== 'open') {
      return res.status(400).json({
        success: false,
        error: 'El turno destino no está abierto',
      });
    }

    // Verificar que todas las ventas existen y están pendientes
    const placeholders = sale_ids.map(() => '?').join(',');
    const sales = await query(
      `SELECT id, status, shift_id, table_id FROM sales WHERE id IN (${placeholders})`,
      sale_ids
    );

    if (sales.length !== sale_ids.length) {
      return res.status(400).json({
        success: false,
        error: 'Algunas ventas no existen',
      });
    }

    const nonPendingSales = sales.filter(s => s.status !== 'pending');
    if (nonPendingSales.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Solo se pueden traspasar ventas pendientes',
        invalidSales: nonPendingSales.map(s => s.id),
      });
    }

    // Actualizar el shift_id de las ventas
    await query(
      `UPDATE sales SET shift_id = ?, is_synced = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
      [new_shift_id, ...sale_ids]
    );

    // Emitir evento de WebSocket para notificar a todos los dispositivos
    const updatedSales = await query(
      `SELECT s.id, s.table_id, t.name as table_name
       FROM sales s
       LEFT JOIN cafe_tables t ON s.table_id = t.id
       WHERE s.id IN (${placeholders})`,
      sale_ids
    );

    // Notificar cambio de turno
    socketEvents.broadcast('sales:handover', {
      sale_ids,
      new_shift_id,
      target_shift_owner: targetShift[0].opened_by_name,
      tables: updatedSales.map(s => ({ id: s.table_id, name: s.table_name })),
    });

    res.json({
      success: true,
      message: `${sale_ids.length} venta(s) traspasada(s) al turno de ${targetShift[0].opened_by_name}`,
      data: {
        transferred_count: sale_ids.length,
        new_shift_id,
        new_shift_owner: targetShift[0].opened_by_name,
      },
    });
  } catch (error) {
    console.error('Error en handover de ventas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al traspasar las ventas',
    });
  }
}

/**
 * GET /api/sync/shifts/open
 * Obtener turnos abiertos (para seleccionar destino de traspaso)
 */
async function getOpenShifts(req, res) {
  try {
    const { exclude_shift_id } = req.query;

    let sql = `
      SELECT id, opened_by_id, opened_by_name, start_time, initial_cash, status
      FROM shifts
      WHERE status = 'open'
    `;
    const params = [];

    // Excluir el turno actual si se proporciona
    if (exclude_shift_id) {
      sql += ' AND id != ?';
      params.push(exclude_shift_id);
    }

    sql += ' ORDER BY start_time DESC';

    const shifts = await query(sql, params);

    res.json({
      success: true,
      data: shifts.map(s => ({
        id: s.id,
        opened_by_id: s.opened_by_id,
        opened_by_name: s.opened_by_name,
        start_time: s.start_time,
        initial_cash: parseFloat(s.initial_cash),
        status: s.status,
      })),
    });
  } catch (error) {
    console.error('Error obteniendo turnos abiertos:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo turnos abiertos',
    });
  }
}

/**
 * GET /api/sync/sales/pending
 * Obtener ventas pendientes (pedidos activos en mesas)
 * Útil para sincronizar pedidos entre dispositivos al reconectar
 */
async function getPendingSales(req, res) {
  try {
    // Obtener ventas pendientes con información de mesa
    const sales = await query(`
      SELECT s.id, s.total, s.payment_method, s.status, s.observation,
             s.shift_id, s.table_id, s.print_count, s.created_at,
             t.name as table_name
      FROM sales s
      LEFT JOIN cafe_tables t ON s.table_id = t.id
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC
    `);

    // Obtener items de todas las ventas pendientes
    let saleItems = [];
    if (sales.length > 0) {
      const saleIds = sales.map(s => s.id);
      const placeholders = saleIds.map(() => '?').join(',');
      saleItems = await query(
        `SELECT id, sale_id, product_id, product_name, quantity, unit_price
         FROM sale_items
         WHERE sale_id IN (${placeholders})`,
        saleIds
      );
    }

    // Obtener estado actual de mesas ocupadas
    const occupiedTables = await query(`
      SELECT id, name, status
      FROM cafe_tables
      WHERE status = 'occupied'
    `);

    res.json({
      success: true,
      data: {
        sales: sales.map(s => ({
          ...s,
          total: parseFloat(s.total),
          created_at: s.created_at,
        })),
        sale_items: saleItems.map(item => ({
          ...item,
          unit_price: parseFloat(item.unit_price),
        })),
        tables: occupiedTables,
      },
      count: {
        sales: sales.length,
        items: saleItems.length,
        tables: occupiedTables.length,
      },
    });
  } catch (error) {
    console.error('Error obteniendo ventas pendientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo ventas pendientes',
    });
  }
}

/**
 * POST /api/sync/shifts/handover-and-close
 * Orquesta el traspaso de todas las ventas pendientes de un turno
 * a un nuevo turno de un usuario receptor y cierra el turno actual.
 * Body: { current_shift_id: string, receiver_user_id: string, receiver_initial_cash: number }
 */
async function handoverAndCloseShift(req, res) {
  try {
    const { current_shift_id, receiver_user_id, receiver_initial_cash } = req.body;

    if (!current_shift_id || !receiver_user_id || typeof receiver_initial_cash !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Parámetros inválidos: current_shift_id, receiver_user_id y receiver_initial_cash son requeridos',
      });
    }

    // Validar turno actual
    const currentShiftRows = await query('SELECT id, status, opened_by_id, opened_by_name FROM shifts WHERE id = ?', [current_shift_id]);
    if (currentShiftRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Turno actual no encontrado' });
    }
    const currentShift = currentShiftRows[0];
    if (currentShift.status !== 'open') {
      return res.status(400).json({ success: false, error: 'El turno actual no está abierto' });
    }

    // Ventas pendientes del turno actual
    const pendingSales = await query(
      'SELECT id, table_id FROM sales WHERE shift_id = ? AND status = "pending"',
      [current_shift_id]
    );

    // Validar usuario receptor
    const receiverRows = await query('SELECT id, name FROM users WHERE id = ? AND is_active = 1', [receiver_user_id]);
    if (receiverRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario receptor no encontrado o inactivo' });
    }
    const receiver = receiverRows[0];

    // Crear nuevo turno para receptor
    const newShiftId = uuidv4();
    await query(
      `INSERT INTO shifts (id, opened_by_id, opened_by_name, start_time, initial_cash, status, is_synced)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 'open', 1)`,
      [newShiftId, receiver.id, receiver.name, receiver_initial_cash]
    );

    let transferredCount = 0;
    if (pendingSales.length > 0) {
      const saleIds = pendingSales.map(s => s.id);
      const placeholders = saleIds.map(() => '?').join(',');
      await query(
        `UPDATE sales SET shift_id = ?, is_synced = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        [newShiftId, ...saleIds]
      );
      transferredCount = saleIds.length;

      // Emitir handover de ventas (incluye mesas)
      const updatedSales = await query(
        `SELECT s.id, s.table_id, t.name as table_name
         FROM sales s
         LEFT JOIN cafe_tables t ON s.table_id = t.id
         WHERE s.id IN (${placeholders})`,
        saleIds
      );
      socketEvents.broadcast('sales:handover', {
        sale_ids: saleIds,
        new_shift_id: newShiftId,
        target_shift_owner: receiver.name,
        tables: updatedSales.map(s => ({ id: s.table_id, name: s.table_name })),
      });
    }

    // Cerrar turno actual
    const closedByName = req.user?.name || currentShift.opened_by_name;
    const closedById = req.user?.id || currentShift.opened_by_id;
    await query(
      `UPDATE shifts SET end_time = CURRENT_TIMESTAMP, status = 'closed', closed_by_id = ?, closed_by_name = ?, is_synced = 1 WHERE id = ?`,
      [closedById, closedByName, current_shift_id]
    );

    // Emitir eventos de cambio de turno
    socketEvents.emitShiftChange({ shiftId: current_shift_id, status: 'closed', userName: closedByName });
    socketEvents.emitShiftChange({ shiftId: newShiftId, status: 'open', userName: receiver.name });

    return res.json({
      success: true,
      message: 'Traspaso y cierre realizados correctamente',
      data: {
        transferred_count: transferredCount,
        new_shift_id: newShiftId,
        new_shift_owner: receiver.name,
        closed_shift_id: current_shift_id,
      },
    });
  } catch (error) {
    console.error('Error en handover-and-close:', error);
    return res.status(500).json({ success: false, error: 'Error en traspaso y cierre' });
  }
}

// POST /api/sync/handover
// Cierre atómico del turno A, creación del turno B con estado 'waiting_initial_cash',
// y traspaso de ventas pendientes de A a B en una sola transacción.
async function atomicShiftHandover(req, res) {
  try {
    const { current_shift_id, incoming_user_id, cash_final_reported, final_cash_reported } = req.body;
    const finalCash = typeof cash_final_reported !== 'undefined' ? cash_final_reported : final_cash_reported;

    // Validar parámetros mínimos
    if (!current_shift_id || !incoming_user_id) {
      return res.status(400).json({ success: false, error: 'Se requieren current_shift_id e incoming_user_id' });
    }

    // Validar turno actual
    const currentShiftRows = await query(
      'SELECT id, status, opened_by_id, opened_by_name FROM shifts WHERE id = ?',
      [current_shift_id]
    );
    if (currentShiftRows.length === 0) {
      return res.status(404).json({ success: false, error: 'El turno actual no existe' });
    }
    const currentShift = currentShiftRows[0];
    if (currentShift.status !== 'open') {
      return res.status(400).json({ success: false, error: 'El turno actual no está abierto' });
    }

    // Validar usuario receptor
    const receiverRows = await query(
      'SELECT id, name, is_active FROM users WHERE id = ?',
      [incoming_user_id]
    );
    if (receiverRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario receptor no existe' });
    }
    const receiver = receiverRows[0];
    if (parseInt(receiver.is_active) !== 1) {
      return res.status(400).json({ success: false, error: 'Usuario receptor no está activo' });
    }

    const newShiftId = uuidv4();

    // Ejecutar transacción atómica
    const txResult = await transaction(async (conn) => {
      const closedById = req.user?.id || currentShift.opened_by_id;
      const closedByName = req.user?.name || currentShift.opened_by_name;

      // Paso A: Cerrar turno A y guardar final_cash_reported
      await conn.execute(
        `UPDATE shifts
         SET end_time = CURRENT_TIMESTAMP,
             status = 'closed',
             final_cash_reported = ?,
             closed_by_id = ?,
             closed_by_name = ?,
             is_synced = 1
         WHERE id = ?`,
        [finalCash ?? null, closedById, closedByName, current_shift_id]
      );

      // Paso B: Crear turno B con estado 'waiting_initial_cash' e initial_cash = 0
      await conn.execute(
        `INSERT INTO shifts (id, opened_by_id, opened_by_name, start_time, initial_cash, status, is_synced)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0, 'waiting_initial_cash', 1)`,
        [newShiftId, receiver.id, receiver.name]
      );

      // Paso C: Traspasar ventas pendientes de A a B
      const [updateRes] = await conn.execute(
        `UPDATE sales SET shift_id = ? WHERE shift_id = ? AND status = 'pending'`,
        [newShiftId, current_shift_id]
      );

      const transferredCount = updateRes.affectedRows || 0;

      return { transferredCount, closedByName };
    });

    // Paso D: Emitir eventos de WebSocket
    socketEvents.emitShiftChange({ shiftId: current_shift_id, status: 'closed', userName: txResult.closedByName });
    socketEvents.emitShiftChange({ shiftId: newShiftId, status: 'waiting_initial_cash', userName: receiver.name });

    return res.json({
      success: true,
      message: 'Handover atómico completado',
      data: {
        new_shift_id: newShiftId,
        transferred_count: txResult.transferredCount,
      },
    });
  } catch (error) {
    console.error('Error en atomicShiftHandover:', error);
    return res.status(500).json({ success: false, error: 'Error en traspaso atómico' });
  }
}

/**
 * POST /api/sync/shifts/transfer-tables
 * Transit State: Transfer pending sales to a receiver user without creating their shift yet.
 * Sets shift_id = NULL and pending_receiver_user_id = receiver_user_id.
 * User A can then complete their shift closure normally.
 * When User B opens their shift, the sales will be automatically linked.
 * Body: { sale_ids: string[], receiver_user_id: string }
 */
async function transferTablesToUser(req, res) {
  try {
    const { sale_ids, receiver_user_id } = req.body;

    // Validate parameters
    if (!sale_ids || !Array.isArray(sale_ids) || sale_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere un array de sale_ids',
      });
    }

    if (!receiver_user_id) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere receiver_user_id',
      });
    }

    // Verify receiver user exists and is active
    const receiverUsers = await query(
      'SELECT id, name, is_active FROM users WHERE id = ?',
      [receiver_user_id]
    );

    if (receiverUsers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuario receptor no encontrado',
      });
    }

    if (!receiverUsers[0].is_active) {
      return res.status(400).json({
        success: false,
        error: 'Usuario receptor no está activo',
      });
    }

    const receiver = receiverUsers[0];

    // Verify all sales exist and are pending
    const placeholders = sale_ids.map(() => '?').join(',');
    const sales = await query(
      `SELECT id, status, shift_id, table_id FROM sales WHERE id IN (${placeholders})`,
      sale_ids
    );

    if (sales.length !== sale_ids.length) {
      return res.status(400).json({
        success: false,
        error: 'Algunas ventas no existen',
      });
    }

    const nonPendingSales = sales.filter(s => s.status !== 'pending');
    if (nonPendingSales.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Solo se pueden traspasar ventas pendientes',
        invalidSales: nonPendingSales.map(s => s.id),
      });
    }

    // Update sales: set shift_id = NULL and pending_receiver_user_id = receiver_user_id
    await query(
      `UPDATE sales
       SET shift_id = NULL,
           pending_receiver_user_id = ?,
           is_synced = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})`,
      [receiver_user_id, ...sale_ids]
    );

    // Get updated sales with table info for socket event
    const updatedSales = await query(
      `SELECT s.id, s.table_id, t.name as table_name
       FROM sales s
       LEFT JOIN cafe_tables t ON s.table_id = t.id
       WHERE s.id IN (${placeholders})`,
      sale_ids
    );

    // Emit socket event to notify devices about the transfer
    socketEvents.broadcast('sales:transfer', {
      sale_ids,
      receiver_user_id,
      receiver_name: receiver.name,
      tables: updatedSales.map(s => ({ id: s.table_id, name: s.table_name })),
    });

    res.json({
      success: true,
      message: `${sale_ids.length} mesa(s) traspasada(s) a ${receiver.name}. Esperando que abra su turno.`,
      data: {
        transferred_count: sale_ids.length,
        receiver_user_id,
        receiver_name: receiver.name,
        tables: updatedSales.map(s => ({ id: s.table_id, name: s.table_name })),
      },
    });
  } catch (error) {
    console.error('Error en transferTablesToUser:', error);
    res.status(500).json({
      success: false,
      error: 'Error al traspasar las mesas',
    });
  }
}

/**
 * Link orphan sales to a shift.
 * Called when a user opens a shift to link any pending sales assigned to them.
 * @param {string} userId - The user ID who is opening the shift
 * @param {string} shiftId - The new shift ID to link the sales to
 * @returns {Promise<{count: number, tables: Array<{id: string, name: string}>}>} - Linked sales info
 */
async function linkOrphanSalesToShift(userId, shiftId) {
  try {
    // Find orphan sales: status='pending', shift_id IS NULL, pending_receiver_user_id = userId
    const orphanSales = await query(
      `SELECT id, table_id FROM sales
       WHERE status = 'pending'
       AND shift_id IS NULL
       AND pending_receiver_user_id = ?`,
      [userId]
    );

    if (orphanSales.length === 0) {
      return { count: 0, tables: [] };
    }

    const saleIds = orphanSales.map(s => s.id);
    const placeholders = saleIds.map(() => '?').join(',');

    // Link sales to the new shift and clear pending_receiver_user_id
    await query(
      `UPDATE sales
       SET shift_id = ?,
           pending_receiver_user_id = NULL,
           is_synced = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})`,
      [shiftId, ...saleIds]
    );

    console.log(`[Handover] Linked ${saleIds.length} orphan sales to shift ${shiftId}`);

    // Get linked sales with table info
    const linkedSales = await query(
      `SELECT s.id, s.table_id, t.name as table_name
       FROM sales s
       LEFT JOIN cafe_tables t ON s.table_id = t.id
       WHERE s.id IN (${placeholders})`,
      saleIds
    );

    const tables = linkedSales
      .filter(s => s.table_id)
      .map(s => ({ id: s.table_id, name: s.table_name || 'Mesa' }));

    // Emit socket event to notify devices about the linked sales
    socketEvents.broadcast('sales:linked', {
      sale_ids: saleIds,
      shift_id: shiftId,
      tables,
    });

    return { count: saleIds.length, tables };
  } catch (error) {
    console.error('Error linking orphan sales:', error);
    return { count: 0, tables: [] };
  }
}

module.exports = {
  syncFromDevice,
  syncSales,
  syncMovements,
  getSyncStatus,
  syncUsersToDevice,
  processInventoryDeduction,
  handoverPendingSales,
  getOpenShifts,
  getPendingSales,
  handoverAndCloseShift,
  atomicShiftHandover,
  transferTablesToUser,
  linkOrphanSalesToShift,
};
