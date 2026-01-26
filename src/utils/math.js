/**
 * Sanitiza un valor numérico para evitar NaN o errores de cálculo.
 * Convierte null, undefined, o strings no numéricos a 0.
 * @param {any} value Valor a sanitizar
 * @returns {number} Número válido (0 si la entrada es inválida)
 */
const safePrice = (value) => {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

/**
 * Calcula el total de un ítem incluyendo modificadores (extras).
 * Fórmula: (Precio Unitario + Costo Extras) * Cantidad
 * @param {number} unitPrice Precio base del producto
 * @param {number} quantity Cantidad de productos
 * @param {Array} modifiers Lista de modificadores (opcional)
 * @returns {number} Total calculado
 */
const calculateItemTotal = (unitPrice, quantity, modifiers = []) => {
  const safeUnitPrice = safePrice(unitPrice);
  const safeQuantity = safePrice(quantity);

  // Parsear modifiers si es string
  let parsedModifiers = modifiers;
  if (typeof modifiers === 'string') {
    try {
      parsedModifiers = JSON.parse(modifiers);
    } catch (e) {
      parsedModifiers = [];
    }
  }
  if (!Array.isArray(parsedModifiers)) parsedModifiers = [];

  const modifiersCost = parsedModifiers.reduce((sum, mod) => {
    return sum + safePrice(mod.price_adjustment);
  }, 0);

  return (safeUnitPrice + modifiersCost) * safeQuantity;
};

/**
 * Calcula el total de un pedido/venta sumando todos sus items.
 * @param {Array} items Lista de items de venta con unit_price, quantity y modifiers
 * @returns {number} Total del pedido
 */
const calculateOrderTotal = (items = []) => {
  if (!Array.isArray(items)) return 0;

  return items.reduce((sum, item) => {
    return sum + calculateItemTotal(item.unit_price, item.quantity, item.modifiers);
  }, 0);
};

/**
 * Calcula el costo total de una venta basado en recetas e ingredientes.
 * @param {Array} items Lista de items de venta con product_id, quantity y modifiers
 * @param {Function} queryFn Función de query para consultar la base de datos
 * @returns {Promise<number>} Costo total de los insumos
 */
const calculateSaleCost = async (items = [], queryFn) => {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let totalCost = 0;

  for (const item of items) {
    const { product_id, quantity } = item;
    const safeQuantity = safePrice(quantity);

    // Obtener información del producto
    const products = await queryFn(
      'SELECT id, manage_stock, cost_unit FROM products WHERE id = ?',
      [product_id]
    );

    if (products.length === 0) continue;
    const product = products[0];

    if (product.manage_stock === 1) {
      // Producto directo: cost_unit * quantity
      totalCost += safePrice(product.cost_unit) * safeQuantity;
    } else {
      // Producto con receta: sumar costo de ingredientes
      const recipes = await queryFn(
        'SELECT ingredient_id, quantity_required FROM recipes WHERE product_id = ?',
        [product_id]
      );

      for (const recipe of recipes) {
        const { ingredient_id, quantity_required } = recipe;

        // Calcular multiplicador por modificadores
        let quantityMultiplier = 1;

        if (item.modifiers) {
          let parsedModifiers = item.modifiers;
          if (typeof parsedModifiers === 'string') {
            try {
              parsedModifiers = JSON.parse(parsedModifiers);
            } catch (e) {
              parsedModifiers = [];
            }
          }
          if (Array.isArray(parsedModifiers)) {
            const modifier = parsedModifiers.find(m => m.ingredient_id === ingredient_id);
            if (modifier?.type === 'excluded') {
              quantityMultiplier = 0;
            } else if (modifier?.type === 'extra') {
              quantityMultiplier = 1 + (Number(modifier.extra_count) || 1);
            }
          }
        }

        if (quantityMultiplier === 0) continue;

        // Obtener costo del ingrediente
        const ingredients = await queryFn(
          'SELECT cost_unit, yield_per_unit FROM products WHERE id = ?',
          [ingredient_id]
        );

        if (ingredients.length > 0) {
          const ingredientCost = safePrice(ingredients[0].cost_unit);
          const yieldPerUnit = Number(ingredients[0].yield_per_unit) || 1;
          
          // Usar Number() para asegurar precisión decimal en quantity_required
          // Si tiene rendimiento, la cantidad requerida es en porciones, convertir a unidades
          let ingredientQuantity = Number(quantity_required) * safeQuantity * quantityMultiplier;
          
          if (yieldPerUnit > 1) {
            ingredientQuantity = ingredientQuantity / yieldPerUnit;
          }

          totalCost += ingredientCost * ingredientQuantity;
        }
      }
    }
  }

  return totalCost;
};

/**
 * Calcula la utilidad bruta de una venta.
 * @param {number} total Total de la venta
 * @param {number} cost Costo de los insumos
 * @returns {number} Utilidad bruta (puede ser negativa)
 */
const calculateGrossProfit = (total, cost) => {
  return safePrice(total) - safePrice(cost);
};

module.exports = {
  safePrice,
  calculateItemTotal,
  calculateOrderTotal,
  calculateSaleCost,
  calculateGrossProfit
};
