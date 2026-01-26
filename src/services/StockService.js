/**
 * StockService - Servicio de validación y descuento de stock
 *
 * Lógica:
 * 1. Si el producto tiene manage_stock = 1 → valida/descuenta directamente su stock
 * 2. Si el producto tiene receta → valida/descuenta los ingredientes de la receta
 * 3. Si no tiene ninguno → no valida/descuenta nada (producto sin control de stock)
 *
 * Protección: No permite que el stock quede en negativo
 */

const { query } = require('../config/database');

/**
 * Calcula el multiplicador de cantidad basado en modificadores
 * @param {Array|string} modifiers - Modificadores del item
 * @param {string} ingredientId - ID del ingrediente
 * @returns {number} Multiplicador (0 = excluido, 1 = normal, 2 = extra)
 */
function getModifierMultiplier(modifiers, ingredientId) {
  if (!modifiers) return 1;
  
  let parsedModifiers = modifiers;
  if (typeof modifiers === 'string') {
    try {
      parsedModifiers = JSON.parse(modifiers);
    } catch (e) {
      return 1;
    }
  }
  
  if (!Array.isArray(parsedModifiers)) return 1;
  
  const modifier = parsedModifiers.find(m => m.ingredient_id === ingredientId);
  
  if (!modifier) return 1;
  
  if (modifier.type === 'excluded') return 0;
  if (modifier.type === 'extra') {
      // Original (1) + Extra Count (N)
      // Example: extra_count = 1 => 1 (base) + 1 (extra) = 2
      const extraCount = Number(modifier.extra_count) || 1;
      return 1 + extraCount; 
  }
  
  return 1;
}

/**
 * Resultado de validación de stock
 * @typedef {Object} StockValidationResult
 * @property {boolean} isValid - Si hay stock suficiente
 * @property {Array<{productName: string, ingredientName?: string, required: number, available: number, unit: string}>} errors
 */

/**
 * Valida si hay stock suficiente para una lista de items de venta
 * @param {Array<{product_id: string, quantity: number}>} items - Items a validar
 * @returns {Promise<StockValidationResult>}
 */
async function validateStockForItems(items) {
  const errors = [];

  // Acumular requerimientos de ingredientes (para evitar validar el mismo ingrediente múltiples veces)
  const ingredientRequirements = new Map();

  for (const item of items) {
    const { product_id, quantity } = item;

    // Obtener información del producto
    const products = await query(
      'SELECT id, name, manage_stock, stock_current, unit FROM products WHERE id = ?',
      [product_id]
    );

    if (products.length === 0) {
      console.warn(`[StockService] Producto no encontrado: ${product_id}`);
      continue;
    }

    const product = products[0];

    if (product.manage_stock === 1) {
      // Producto con stock directo - validar cantidad
      if (product.stock_current < quantity) {
        errors.push({
          productName: product.name,
          required: quantity,
          available: product.stock_current,
          unit: product.unit || 'unid',
        });
      }
    } else {
      // Producto con receta - acumular requerimientos de ingredientes
      const recipes = await query(
        'SELECT ingredient_id, quantity_required FROM recipes WHERE product_id = ?',
        [product_id]
      );

      for (const recipe of recipes) {
        const quantityMultiplier = getModifierMultiplier(item.modifiers, recipe.ingredient_id);
        
        if (quantityMultiplier === 0) continue;

        const requiredQty = Number(recipe.quantity_required) * quantity * quantityMultiplier;
        const existing = ingredientRequirements.get(recipe.ingredient_id);

        if (existing) {
          existing.quantity += requiredQty;
          existing.productNames.add(product.name);
        } else {
          ingredientRequirements.set(recipe.ingredient_id, {
            quantity: requiredQty,
            productNames: new Set([product.name]),
          });
        }
      }
    }
  }

  // Validar todos los ingredientes acumulados
  for (const [ingredientId, requirement] of ingredientRequirements) {
    const ingredients = await query(
      'SELECT id, name, manage_stock, stock_current, unit, yield_per_unit FROM products WHERE id = ?',
      [ingredientId]
    );

    if (ingredients.length === 0) {
      console.warn(`[StockService] Ingrediente no encontrado: ${ingredientId}`);
      continue;
    }

    const ingredient = ingredients[0];

    // Solo validar si el ingrediente tiene control de stock
    if (ingredient.manage_stock !== 1) continue;

    // Calcular requerimiento en unidades de stock (considerando rendimiento/porciones)
    const yieldPerUnit = Number(ingredient.yield_per_unit) || 1;
    const requiredInStockUnits = (yieldPerUnit > 1) 
      ? requirement.quantity / yieldPerUnit 
      : requirement.quantity;

    if (Number(ingredient.stock_current) < requiredInStockUnits) {
      // Para el mensaje de error, mostrar en porciones si aplica
      const requiredDisplay = (yieldPerUnit > 1) ? requirement.quantity : requiredInStockUnits;
      const availableDisplay = (yieldPerUnit > 1) 
        ? Math.floor(Number(ingredient.stock_current) * yieldPerUnit) 
        : Number(ingredient.stock_current);
      const unitDisplay = (yieldPerUnit > 1) ? 'porciones' : (ingredient.unit || 'unid');

      errors.push({
        productName: Array.from(requirement.productNames).join(', '),
        ingredientName: ingredient.name,
        required: Number(requiredDisplay.toFixed(2)),
        available: Number(availableDisplay.toFixed(2)),
        unit: unitDisplay,
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Descuenta el stock para una lista de items de venta
 * IMPORTANTE: Esta función debe llamarse dentro de una transacción SQL
 * @param {Object} conn - Conexión de MySQL (transacción)
 * @param {Array<{product_id: string, quantity: number}>} items - Items vendidos
 */
async function deductStockForItems(conn, items) {
  for (const item of items) {
    const { product_id, quantity } = item;

    // Obtener información del producto
    const [products] = await conn.execute(
      'SELECT id, name, manage_stock, stock_current FROM products WHERE id = ?',
      [product_id]
    );

    if (products.length === 0) {
      console.warn(`[StockService] Producto no encontrado para descuento: ${product_id}`);
      continue;
    }

    const product = products[0];

    if (product.manage_stock === 1) {
      // Producto con stock directo - descontar
      const previousStock = Number(product.stock_current);
      const newStock = Math.max(0, previousStock - quantity);

      await conn.execute(
        `UPDATE products
         SET stock_current = GREATEST(0, stock_current - ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [quantity, product_id]
      );

      console.log(
        `[StockService] Descontado ${quantity} de "${product.name}": ${previousStock.toFixed(4)} -> ${newStock.toFixed(4)}`
      );
    } else {
      // Producto con receta - descontar ingredientes
      // VERIFICACIÓN DE INTEGRIDAD: (Base * Cantidad) + (Extras * Cantidad)
      // La fórmula usada es: Cantidad * Requerido * (1 + ExtraCount)
      // Esto es matemáticamente equivalente a: (Cantidad * Requerido) + (Cantidad * Requerido * ExtraCount)
      // Donde (Cantidad * Requerido) es la Base y (Cantidad * Requerido * ExtraCount) son los Extras.
      const [recipes] = await conn.execute(
        'SELECT ingredient_id, quantity_required FROM recipes WHERE product_id = ?',
        [product_id]
      );

      for (const recipe of recipes) {
        const { ingredient_id, quantity_required } = recipe;
        
        const quantityMultiplier = getModifierMultiplier(item.modifiers, ingredient_id);
        
        if (quantityMultiplier === 0) continue;

        const totalToDeduct = quantity * Number(quantity_required) * quantityMultiplier;

        // Obtener info del ingrediente
        const [ingredientInfo] = await conn.execute(
          'SELECT name, stock_current, yield_per_unit FROM products WHERE id = ?',
          [ingredient_id]
        );

        if (ingredientInfo.length > 0) {
          const previousStock = Number(ingredientInfo[0].stock_current);
          
          // Calcular descuento en unidades de stock (considerando rendimiento)
          const yieldPerUnit = Number(ingredientInfo[0].yield_per_unit) || 1;
          const deductionInStockUnits = (yieldPerUnit > 1) 
            ? totalToDeduct / yieldPerUnit 
            : totalToDeduct;
          
          const newStock = Math.max(0, previousStock - deductionInStockUnits);

          await conn.execute(
            `UPDATE products
             SET stock_current = GREATEST(0, stock_current - ?),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [deductionInStockUnits, ingredient_id]
          );

          console.log(
            `[StockService] Descontado ${deductionInStockUnits.toFixed(4)} (${totalToDeduct} porciones) de "${ingredientInfo[0].name}": ${previousStock.toFixed(4)} -> ${newStock.toFixed(4)}`
          );
        }
      }
    }
  }
}

/**
 * Formatea los errores de validación para respuesta HTTP
 * @param {Array} errors - Array de errores de validación
 * @returns {string} Mensaje formateado
 */
function formatValidationErrors(errors) {
  if (errors.length === 0) return '';

  const messages = errors.map((error) => {
    if (error.ingredientName) {
      return `${error.ingredientName}: necesitas ${error.required} ${error.unit}, solo hay ${error.available} ${error.unit} (para ${error.productName})`;
    }
    return `${error.productName}: necesitas ${error.required} ${error.unit}, solo hay ${error.available} ${error.unit}`;
  });

  return `Stock insuficiente:\n${messages.join('\n')}`;
}

/**
 * Valida y descuenta stock en una sola operación transaccional
 * Si la validación falla, retorna error sin modificar nada
 * @param {Object} conn - Conexión de MySQL (transacción)
 * @param {Array<{product_id: string, quantity: number}>} items - Items vendidos
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function validateAndDeductStock(conn, items) {
  // Primero validar (usando query normal, no la conexión de transacción)
  const validation = await validateStockForItems(items);

  if (!validation.isValid) {
    return {
      success: false,
      error: formatValidationErrors(validation.errors),
      errors: validation.errors,
    };
  }

  // Si la validación pasa, descontar usando la conexión de transacción
  await deductStockForItems(conn, items);

  return { success: true };
}

module.exports = {
  validateStockForItems,
  deductStockForItems,
  validateAndDeductStock,
  formatValidationErrors,
  getModifierMultiplier,
};
