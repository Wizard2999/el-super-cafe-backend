const { query } = require('../config/database');
const socketEvents = require('../services/socketEvents');

/**
 * DELETE /api/sales/:saleId/items/:itemId
 * Eliminar un item de una venta por su ID único (sale_items.id)
 */
async function deleteSaleItem(req, res) {
  try {
    const { saleId, itemId } = req.params;

    // 1. Eliminar el item por ID único
    const result = await query(
      'DELETE FROM sale_items WHERE sale_id = ? AND id = ?',
      [saleId, itemId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Item no encontrado en la venta',
      });
    }

    // 2. Recalcular total de la venta (opcional pero recomendado)
    // Obtenemos los items restantes
    const remainingItems = await query(
      'SELECT * FROM sale_items WHERE sale_id = ?',
      [saleId]
    );

    // 3. Emitir actualización por socket
    // Necesitamos el tableId para el evento order:update
    const sale = await query('SELECT table_id, status FROM sales WHERE id = ?', [saleId]);
    
    if (sale.length > 0) {
      const tableId = sale[0].table_id;
      const status = sale[0].status;

      socketEvents.emitOrderUpdate({
        tableId,
        saleId,
        items: remainingItems.map(item => {
          let modifiers = item.modifiers;
          if (typeof modifiers === 'string') {
            try {
              modifiers = JSON.parse(modifiers);
            } catch (e) {
              modifiers = [];
            }
          }
          return {
            id: item.id,
            sale_id: item.sale_id,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            modifiers,
            is_synced: 1
          };
        }),
        status,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Item eliminado',
    });
  } catch (error) {
    console.error('Error eliminando item de venta:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando item',
    });
  }
}

/**
 * PATCH /api/sales/:saleId/items/:itemId/status
 * Actualizar estado de preparación de un item
 */
async function updateItemStatus(req, res) {
  try {
    const { saleId, itemId } = req.params;
    const { status } = req.body;

    if (!['pending', 'preparing', 'ready', 'delivered'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado inválido' });
    }

    // 1. Actualizar estado
    const result = await query(
      'UPDATE sale_items SET preparation_status = ? WHERE id = ? AND sale_id = ?',
      [status, itemId, saleId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Item no encontrado' });
    }

    // 2. Obtener info para socket
    const itemData = await query(
      `SELECT si.product_name, s.table_id 
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       WHERE si.id = ?`,
      [itemId]
    );

    if (itemData.length > 0) {
      const { product_name, table_id } = itemData[0];
      
      // 3. Emitir evento de cocina
      socketEvents.emitKitchenUpdate({
        saleId,
        itemId,
        status,
        tableId: table_id,
        productName: product_name
      });
    }

    res.json({ success: true, status });
  } catch (error) {
    console.error('Error actualizando estado de item:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
}

/**
 * POST /api/sales/:saleId/cancel
 * Anular una venta completa
 */
async function cancelSale(req, res) {
  try {
    const { saleId } = req.params;

    // 1. Verificar si la venta existe
    const saleCheck = await query('SELECT table_id FROM sales WHERE id = ?', [saleId]);
    if (saleCheck.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Venta no encontrada',
      });
    }
    const tableId = saleCheck[0].table_id;

    // 2. Eliminar todos los sale_items (según requerimiento)
    await query('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);

    // 3. Actualizar estado de la venta a 'cancelled'
    await query(
      "UPDATE sales SET status = 'cancelled', is_synced = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [saleId]
    );

    // 4. Emitir evento de actualización (venta cancelada)
    // Enviamos items vacíos
    if (tableId) {
      socketEvents.emitOrderUpdate({
        tableId,
        saleId,
        items: [],
        status: 'cancelled',
        timestamp: new Date().toISOString()
      });

      // Nuevo evento para limpieza global de mesa
      socketEvents.emitTableCleaned({ tableId });
    }

    res.json({
      success: true,
      message: 'Venta anulada',
    });
  } catch (error) {
    console.error('Error anulando venta:', error);
    res.status(500).json({
      success: false,
      error: 'Error anulando venta',
    });
  }
}

module.exports = {
  deleteSaleItem,
  cancelSale,
  updateItemStatus,
};
