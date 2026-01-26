const { query } = require('../config/database');
const socketEvents = require('../services/socketEvents');

// ============================================
// CATEGORÍAS
// ============================================

/**
 * GET /api/catalog/categories
 * Descargar todas las categorías (cualquier usuario autenticado)
 */
async function getCategories(req, res) {
  try {
    const categories = await query(
      'SELECT id, name, color FROM categories ORDER BY name ASC'
    );

    res.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (error) {
    console.error('Error obteniendo categorías:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo categorías',
    });
  }
}

/**
 * POST /api/catalog/categories
 * Crear o actualizar categoría (solo admin)
 */
async function upsertCategory(req, res) {
  try {
    const { id, name, color } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere id y name',
      });
    }

    // Verificar si existe para determinar acción
    const existing = await query('SELECT id FROM categories WHERE id = ?', [id]);
    const action = existing.length > 0 ? 'update' : 'create';

    await query(
      `INSERT INTO categories (id, name, color, is_synced)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         color = VALUES(color),
         is_synced = 1,
         updated_at = CURRENT_TIMESTAMP`,
      [id, name, color || '#6B7280']
    );

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({
      type: 'category',
      action,
      id,
      data: { id, name, color: color || '#6B7280' },
    });

    res.json({
      success: true,
      message: 'Categoría guardada',
    });
  } catch (error) {
    console.error('Error guardando categoría:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando categoría',
    });
  }
}

/**
 * DELETE /api/catalog/categories/:id
 * Eliminar categoría (solo admin)
 */
async function deleteCategory(req, res) {
  try {
    const { id } = req.params;

    // Verificar si hay productos usando esta categoría
    const products = await query(
      'SELECT COUNT(*) as count FROM products WHERE category_id = ?',
      [id]
    );

    if (products[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar: hay productos usando esta categoría',
      });
    }

    await query('DELETE FROM categories WHERE id = ?', [id]);

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({ type: 'category', action: 'delete', id });

    res.json({
      success: true,
      message: 'Categoría eliminada',
    });
  } catch (error) {
    console.error('Error eliminando categoría:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando categoría',
    });
  }
}

// ============================================
// PRODUCTOS
// ============================================

/**
 * GET /api/catalog/products
 * Descargar todos los productos (cualquier usuario autenticado)
 */
async function getProducts(req, res) {
  try {
    const products = await query(
      `SELECT id, name, category_id, price, cost_unit, manage_stock, stock_current, unit, yield_per_unit, portion_name
       FROM products
       ORDER BY name ASC`
    );

    res.json({
      success: true,
      data: products,
      count: products.length,
    });
  } catch (error) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo productos',
    });
  }
}

/**
 * POST /api/catalog/products
 * Crear o actualizar producto (solo admin)
 */
async function upsertProduct(req, res) {
  try {
    const { id, name, category_id, price, cost_unit, manage_stock, stock_current, unit, yield_per_unit, portion_name } = req.body;

    if (!id || !name || !category_id) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere id, name y category_id',
      });
    }

    // Obtener producto existente para determinar acción y comparar stock
    const existing = await query(
      'SELECT id, name, manage_stock, stock_current FROM products WHERE id = ?',
      [id]
    );
    const action = existing.length > 0 ? 'update' : 'create';
    const previousStock = existing.length > 0 ? Number(existing[0].stock_current) : 0;
    const previousName = existing.length > 0 ? existing[0].name : name;

    await query(
      `INSERT INTO products (id, name, category_id, price, cost_unit, manage_stock, stock_current, unit, yield_per_unit, portion_name, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         category_id = VALUES(category_id),
         price = VALUES(price),
         cost_unit = VALUES(cost_unit),
         manage_stock = VALUES(manage_stock),
         stock_current = VALUES(stock_current),
         unit = VALUES(unit),
         yield_per_unit = VALUES(yield_per_unit),
         portion_name = VALUES(portion_name),
         is_synced = 1,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        name,
        category_id,
        price || 0,
        cost_unit || 0,
        manage_stock ? 1 : 0,
        stock_current || 0,
        unit || 'unid',
        yield_per_unit || null,
        portion_name || null
      ]
    );

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({
      type: 'product',
      action,
      id,
      data: {
        id,
        name,
        category_id,
        price: price || 0,
        cost_unit: cost_unit || 0,
        manage_stock: manage_stock ? 1 : 0,
        stock_current: stock_current || 0,
        unit: unit || 'unid',
        yield_per_unit: yield_per_unit || null,
        portion_name: portion_name || null
      },
    });

    // Emitir cambio de stock si aplica
    const newStock = Number(stock_current || 0);
    if ((manage_stock ? 1 : 0) === 1 && previousStock !== newStock) {
      socketEvents.emitStockChange({
        productId: id,
        productName: previousName,
        previousStock,
        newStock,
        reason: action === 'create' ? 'initial_stock' : 'admin_update',
      });
    }

    res.json({
      success: true,
      message: 'Producto guardado',
    });
  } catch (error) {
    console.error('Error guardando producto:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando producto',
    });
  }
}

/**
 * DELETE /api/catalog/products/:id
 * Eliminar producto (solo admin)
 */
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;

    // Verificar si hay ventas usando este producto
    const saleItems = await query(
      'SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?',
      [id]
    );

    if (saleItems[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar: hay ventas con este producto',
      });
    }

    // Eliminar recetas asociadas primero
    await query('DELETE FROM recipes WHERE product_id = ? OR ingredient_id = ?', [id, id]);

    // Eliminar producto
    await query('DELETE FROM products WHERE id = ?', [id]);

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({ type: 'product', action: 'delete', id });

    res.json({
      success: true,
      message: 'Producto eliminado',
    });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando producto',
    });
  }
}

// ============================================
// RECETAS
// ============================================

/**
 * GET /api/catalog/recipes
 * Descargar todas las recetas (cualquier usuario autenticado)
 */
async function getRecipes(req, res) {
  try {
    const recipes = await query(
      `SELECT id, product_id, ingredient_id, quantity_required
       FROM recipes
       ORDER BY product_id ASC`
    );

    res.json({
      success: true,
      data: recipes,
      count: recipes.length,
    });
  } catch (error) {
    console.error('Error obteniendo recetas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo recetas',
    });
  }
}

/**
 * POST /api/catalog/recipes
 * Crear o actualizar receta (solo admin)
 */
async function upsertRecipe(req, res) {
  try {
    const { id, product_id, ingredient_id, quantity_required } = req.body;

    if (!id || !product_id || !ingredient_id) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere id, product_id e ingredient_id',
      });
    }

    // Verificar si existe para determinar acción
    const existing = await query('SELECT id FROM recipes WHERE id = ?', [id]);
    const action = existing.length > 0 ? 'update' : 'create';

    await query(
      `INSERT INTO recipes (id, product_id, ingredient_id, quantity_required, is_synced)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         product_id = VALUES(product_id),
         ingredient_id = VALUES(ingredient_id),
         quantity_required = VALUES(quantity_required),
         is_synced = 1,
         updated_at = CURRENT_TIMESTAMP`,
      [id, product_id, ingredient_id, quantity_required || 0]
    );

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({
      type: 'recipe',
      action,
      id,
      data: { id, product_id, ingredient_id, quantity_required: quantity_required || 0 },
    });

    res.json({
      success: true,
      message: 'Receta guardada',
    });
  } catch (error) {
    console.error('Error guardando receta:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando receta',
    });
  }
}

/**
 * DELETE /api/catalog/recipes/:id
 * Eliminar receta (solo admin)
 */
async function deleteRecipe(req, res) {
  try {
    const { id } = req.params;

    await query('DELETE FROM recipes WHERE id = ?', [id]);

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({ type: 'recipe', action: 'delete', id });

    res.json({
      success: true,
      message: 'Receta eliminada',
    });
  } catch (error) {
    console.error('Error eliminando receta:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando receta',
    });
  }
}

// ============================================
// MESAS
// ============================================

/**
 * GET /api/catalog/tables
 * Descargar todas las mesas (cualquier usuario autenticado)
 */
async function getTables(req, res) {
  try {
    const tables = await query(
      `SELECT t.id, t.name, t.status,
              COALESCE(s.total, 0) as current_total,
              (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
       FROM cafe_tables t
       LEFT JOIN sales s ON s.table_id = t.id AND s.status = 'pending'
       ORDER BY t.name ASC`
    );

    res.json({
      success: true,
      data: tables,
      count: tables.length,
    });
  } catch (error) {
    console.error('Error obteniendo mesas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo mesas',
    });
  }
}

/**
 * POST /api/catalog/tables
 * Crear o actualizar mesa (solo admin)
 */
async function upsertTable(req, res) {
  try {
    const { id, name, status } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere id y name',
      });
    }

    // Obtener estado anterior para comparar
    const existing = await query('SELECT status FROM cafe_tables WHERE id = ?', [id]);
    const previousStatus = existing.length > 0 ? existing[0].status : null;
    const newStatus = status || 'free';

    await query(
      `INSERT INTO cafe_tables (id, name, status, is_synced)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         status = VALUES(status),
         is_synced = 1,
         updated_at = CURRENT_TIMESTAMP`,
      [id, name, newStatus]
    );

    // Emitir evento de socket si el estado cambió
    if (previousStatus !== newStatus) {
      socketEvents.emitTableStatusChange({
        tableId: id,
        tableName: name,
        status: newStatus,
      });
    }

    // Emitir actualización de catálogo
    socketEvents.emitCatalogUpdate({
      type: 'table',
      action: previousStatus ? 'update' : 'create',
      id,
      data: { id, name, status: newStatus },
    });

    res.json({
      success: true,
      message: 'Mesa guardada',
    });
  } catch (error) {
    console.error('Error guardando mesa:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando mesa',
    });
  }
}

/**
 * PATCH /api/catalog/tables/:id/status
 * Cambiar solo el estado de una mesa
 */
async function updateTableStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, currentSaleId } = req.body;

    if (!status || !['free', 'occupied'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere status válido (free | occupied)',
      });
    }

    // Obtener información actual de la mesa
    const existing = await query('SELECT id, name, status FROM cafe_tables WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Mesa no encontrada',
      });
    }

    const table = existing[0];

    // Actualizar estado
    await query(
      `UPDATE cafe_tables
       SET status = ?, is_synced = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, id]
    );

    // Emitir evento de cambio de estado
    socketEvents.emitTableStatusChange({
      tableId: id,
      tableName: table.name,
      status,
      currentSaleId,
    });

    res.json({
      success: true,
      message: `Mesa ${table.name} ahora está ${status === 'free' ? 'disponible' : 'ocupada'}`,
      data: { id, name: table.name, status },
    });
  } catch (error) {
    console.error('Error actualizando estado de mesa:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando estado de mesa',
    });
  }
}

/**
 * GET /api/catalog/tables/:id/current-order
 * Obtener el pedido actual de una mesa ocupada
 */
async function getCurrentOrder(req, res) {
  try {
    const { id } = req.params;

    // Verificar que la mesa existe y está ocupada
    const table = await query('SELECT id, name, status FROM cafe_tables WHERE id = ?', [id]);

    if (table.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Mesa no encontrada',
      });
    }

    if (table[0].status !== 'occupied') {
      return res.json({
        success: true,
        data: null,
        message: 'Mesa disponible, sin pedido activo',
      });
    }

    // Buscar venta pendiente en esta mesa
    const sale = await query(
      `SELECT s.*,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'id', si.id,
                  'product_id', si.product_id,
                  'product_name', si.product_name,
                  'quantity', si.quantity,
                  'unit_price', si.unit_price
                )
              ) as items
       FROM sales s
       LEFT JOIN sale_items si ON s.id = si.sale_id
       WHERE s.table_id = ? AND s.status = 'pending'
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [id]
    );

    if (sale.length === 0) {
      return res.json({
        success: true,
        data: null,
        message: 'Mesa ocupada pero sin pedido pendiente encontrado',
      });
    }

    // Parsear items del JSON
    const order = sale[0];
    order.items = order.items ? JSON.parse(order.items) : [];
    // Filtrar items nulos (cuando no hay items)
    order.items = order.items.filter(item => item.id !== null);

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('Error obteniendo pedido actual:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo pedido actual',
    });
  }
}

/**
 * DELETE /api/catalog/tables/:id
 * Eliminar mesa (solo admin)
 */
async function deleteTable(req, res) {
  try {
    const { id } = req.params;

    // Verificar si hay ventas pendientes en esta mesa
    const pendingSales = await query(
      `SELECT COUNT(*) as count FROM sales WHERE table_id = ? AND status = 'pending'`,
      [id]
    );

    if (pendingSales[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar: hay ventas pendientes en esta mesa',
      });
    }

    await query('DELETE FROM cafe_tables WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Mesa eliminada',
    });
  } catch (error) {
    console.error('Error eliminando mesa:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando mesa',
    });
  }
}

// ============================================
// SINCRONIZACIÓN COMPLETA DEL CATÁLOGO
// ============================================

/**
 * GET /api/catalog/full
 * Descargar todo el catálogo de una vez (cualquier usuario autenticado)
 */
async function getFullCatalog(req, res) {
  try {
    const [categories, products, recipes, tables] = await Promise.all([
      query('SELECT id, name, color FROM categories ORDER BY name ASC'),
      query('SELECT id, name, category_id, price, manage_stock, stock_current, unit, yield_per_unit, portion_name FROM products ORDER BY name ASC'),
      query('SELECT id, product_id, ingredient_id, quantity_required FROM recipes ORDER BY product_id ASC'),
      query('SELECT id, name, status FROM cafe_tables ORDER BY name ASC'),
    ]);

    res.json({
      success: true,
      data: {
        categories,
        products,
        recipes,
        tables,
      },
    });
  } catch (error) {
    console.error('Error obteniendo catálogo completo:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo catálogo completo' });
  }
}

/**
 * POST /api/catalog/sync
 * Sincronizar catálogo completo desde dispositivo (solo admin)
 * Body: { categories: [], products: [], recipes: [], tables: [] }
 */
async function syncCatalog(req, res) {
  try {
    const { categories = [], products = [], recipes = [], tables = [] } = req.body;

    const results = {
      categories: { synced: 0, errors: [] },
      products: { synced: 0, errors: [] },
      recipes: { synced: 0, errors: [] },
      tables: { synced: 0, errors: [] },
    };

    // Sincronizar categorías primero (productos dependen de ellas)
    for (const cat of categories) {
      try {
        await query(
          `INSERT INTO categories (id, name, color, is_synced)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             color = VALUES(color),
             is_synced = 1,
             updated_at = CURRENT_TIMESTAMP`,
          [cat.id, cat.name, cat.color || '#6B7280']
        );
        results.categories.synced++;
      } catch (error) {
        results.categories.errors.push({ id: cat.id, error: error.message });
      }
    }

    // Sincronizar productos
    for (const prod of products) {
      try {
        await query(
          `INSERT INTO products (id, name, category_id, price, cost_unit, manage_stock, stock_current, unit, yield_per_unit, portion_name, is_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             category_id = VALUES(category_id),
             price = VALUES(price),
             cost_unit = VALUES(cost_unit),
             manage_stock = VALUES(manage_stock),
             stock_current = VALUES(stock_current),
             unit = VALUES(unit),
             yield_per_unit = VALUES(yield_per_unit),
             portion_name = VALUES(portion_name),
             is_synced = 1,
             updated_at = CURRENT_TIMESTAMP`,
          [
            prod.id,
            prod.name,
            prod.category_id,
            prod.price || 0,
            prod.cost_unit || 0,
            prod.manage_stock ? 1 : 0,
            prod.stock_current || 0,
            prod.unit || 'unid',
            prod.yield_per_unit || null,
            prod.portion_name || null
          ]
        );
        results.products.synced++;
      } catch (error) {
        results.products.errors.push({ id: prod.id, error: error.message });
      }
    }

    // Sincronizar recetas
    for (const recipe of recipes) {
      try {
        await query(
          `INSERT INTO recipes (id, product_id, ingredient_id, quantity_required, is_synced)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             product_id = VALUES(product_id),
             ingredient_id = VALUES(ingredient_id),
             quantity_required = VALUES(quantity_required),
             is_synced = 1,
             updated_at = CURRENT_TIMESTAMP`,
          [recipe.id, recipe.product_id, recipe.ingredient_id, recipe.quantity_required || 0]
        );
        results.recipes.synced++;
      } catch (error) {
        results.recipes.errors.push({ id: recipe.id, error: error.message });
      }
    }

    // Sincronizar mesas
    for (const table of tables) {
      try {
        await query(
          `INSERT INTO cafe_tables (id, name, status, is_synced)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             status = VALUES(status),
             is_synced = 1,
             updated_at = CURRENT_TIMESTAMP`,
          [table.id, table.name, table.status || 'free']
        );
        results.tables.synced++;
      } catch (error) {
        results.tables.errors.push({ id: table.id, error: error.message });
      }
    }

    res.json({
      success: true,
      message: 'Catálogo sincronizado',
      data: results,
    });
  } catch (error) {
    console.error('Error sincronizando catálogo:', error);
    res.status(500).json({
      success: false,
      error: 'Error sincronizando catálogo',
    });
  }
}

module.exports = {
  // Categorías
  getCategories,
  upsertCategory,
  deleteCategory,
  // Productos
  getProducts,
  upsertProduct,
  deleteProduct,
  // Recetas
  getRecipes,
  upsertRecipe,
  deleteRecipe,
  // Mesas
  getTables,
  upsertTable,
  updateTableStatus,
  getCurrentOrder,
  deleteTable,
  // Catálogo completo
  getFullCatalog,
  syncCatalog,
};
