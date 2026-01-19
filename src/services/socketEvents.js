/**
 * Socket Events Service
 * Servicio para emitir eventos WebSocket desde los controladores
 */

let ioInstance = null;

/**
 * Inicializa el servicio con la instancia de Socket.io
 * @param {import('socket.io').Server} io
 */
function initialize(io) {
  ioInstance = io;
  console.log('Socket Events Service inicializado');
}

/**
 * Obtiene la instancia de io
 * @returns {import('socket.io').Server | null}
 */
function getIO() {
  return ioInstance;
}

/**
 * Emite un evento a todos los clientes conectados
 * @param {string} event - Nombre del evento
 * @param {object} data - Datos del evento
 */
function broadcast(event, data) {
  if (ioInstance) {
    ioInstance.emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }
}

// ============================================
// EVENTOS ESPECÍFICOS
// ============================================

/**
 * Emite cuando se actualiza un pedido en una mesa
 * @param {object} params
 * @param {string} params.tableId - ID de la mesa
 * @param {string} params.saleId - ID de la venta/pedido
 * @param {Array} params.items - Items del pedido
 * @param {string} params.status - Estado del pedido
 */
function emitOrderUpdate({ tableId, saleId, items, status }) {
  broadcast('order:update', { tableId, saleId, items, status });
}

/**
 * Emite cuando cambia el stock de un producto
 * @param {object} params
 * @param {string} params.productId - ID del producto
 * @param {string} params.productName - Nombre del producto
 * @param {number} params.previousStock - Stock anterior
 * @param {number} params.newStock - Stock nuevo
 * @param {string} params.reason - Razón del cambio (venta, ajuste, etc.)
 */
function emitStockChange({ productId, productName, previousStock, newStock, reason }) {
  broadcast('stock:change', { productId, productName, previousStock, newStock, reason });
}

/**
 * Emite cuando se completa una venta
 * @param {object} params
 * @param {string} params.saleId - ID de la venta
 * @param {string} params.tableId - ID de la mesa (si aplica)
 * @param {number} params.total - Total de la venta
 * @param {string} params.paymentMethod - Método de pago
 * @param {string} params.status - Estado de la venta
 */
function emitSaleComplete({ saleId, tableId, total, paymentMethod, status }) {
  broadcast('sale:complete', { saleId, tableId, total, paymentMethod, status });
}

/**
 * Emite cuando cambia el estado de una mesa
 * @param {object} params
 * @param {string} params.tableId - ID de la mesa
 * @param {string} params.tableName - Nombre de la mesa
 * @param {string} params.status - Nuevo estado ('free' | 'occupied')
 * @param {string} [params.currentSaleId] - ID de la venta actual (si ocupada)
 */
function emitTableStatusChange({ tableId, tableName, status, currentSaleId }) {
  broadcast('table:status_change', { tableId, tableName, status, currentSaleId });
}

/**
 * Emite cuando se crea un nuevo movimiento (gasto/ingreso)
 * @param {object} params
 * @param {string} params.movementId - ID del movimiento
 * @param {string} params.type - Tipo ('ingreso' | 'gasto')
 * @param {number} params.amount - Monto
 * @param {string} params.description - Descripción
 */
function emitMovementCreate({ movementId, type, amount, description }) {
  broadcast('movement:create', { movementId, type, amount, description });
}

/**
 * Emite cuando se actualiza el catálogo
 * @param {object} params
 * @param {string} params.type - Tipo de cambio ('product' | 'category' | 'recipe' | 'table')
 * @param {string} params.action - Acción ('create' | 'update' | 'delete')
 * @param {string} params.id - ID del elemento
 * @param {object} [params.data] - Datos actualizados
 */
function emitCatalogUpdate({ type, action, id, data }) {
  broadcast('catalog:update', { type, action, id, data });
}

/**
 * Emite cuando un turno se abre o cierra
 * @param {object} params
 * @param {string} params.shiftId - ID del turno
 * @param {string} params.status - Estado ('open' | 'closed')
 * @param {string} params.userName - Nombre del usuario
 */
function emitShiftChange({ shiftId, status, userName }) {
  broadcast('shift:change', { shiftId, status, userName });
}

/**
 * Solicita a todos los clientes que sincronicen
 * Útil después de cambios masivos en el catálogo
 */
function requestFullSync() {
  broadcast('sync:required', { reason: 'server_update' });
}

/**
 * Emite un error de escritura a todos los clientes
 * Útil para notificar fallos de sincronización
 * @param {object} params
 * @param {string} params.event - Evento que falló
 * @param {string} params.error - Mensaje de error
 * @param {object} [params.data] - Datos originales del evento
 * @param {string} [params.socketId] - ID del socket que originó el evento (para responder solo a él)
 */
function emitWriteError({ event, error, data, socketId }) {
  const errorData = {
    event,
    error,
    data,
    timestamp: new Date().toISOString(),
  };

  if (socketId && ioInstance) {
    // Enviar solo al cliente que originó el evento
    ioInstance.to(socketId).emit('error:write', errorData);
  } else {
    // Broadcast a todos
    broadcast('error:write', errorData);
  }
}

/**
 * Emite confirmación de escritura exitosa
 * @param {object} params
 * @param {string} params.event - Evento procesado
 * @param {string} params.id - ID del recurso creado/actualizado
 * @param {string} [params.socketId] - ID del socket que originó el evento
 */
function emitWriteSuccess({ event, id, socketId }) {
  const successData = {
    event,
    id,
    timestamp: new Date().toISOString(),
  };

  if (socketId && ioInstance) {
    ioInstance.to(socketId).emit('success:write', successData);
  }
}

module.exports = {
  initialize,
  getIO,
  broadcast,
  emitOrderUpdate,
  emitStockChange,
  emitSaleComplete,
  emitTableStatusChange,
  emitMovementCreate,
  emitCatalogUpdate,
  emitShiftChange,
  requestFullSync,
  emitWriteError,
  emitWriteSuccess,
};
