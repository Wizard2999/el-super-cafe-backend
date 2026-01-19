const express = require('express');
const router = express.Router();

const catalogController = require('../controllers/catalog.controller');
const { verifyToken, requireAdmin } = require('../middleware/auth.middleware');

// Catálogo completo
router.get('/full', verifyToken, catalogController.getFullCatalog);
router.post('/sync', verifyToken, requireAdmin, catalogController.syncCatalog);

// Categorías
router.get('/categories', verifyToken, catalogController.getCategories);
router.post('/categories', verifyToken, requireAdmin, catalogController.upsertCategory);
router.delete('/categories/:id', verifyToken, requireAdmin, catalogController.deleteCategory);

// Productos
router.get('/products', verifyToken, catalogController.getProducts);
router.post('/products', verifyToken, requireAdmin, catalogController.upsertProduct);
router.delete('/products/:id', verifyToken, requireAdmin, catalogController.deleteProduct);

// Recetas
router.get('/recipes', verifyToken, catalogController.getRecipes);
router.post('/recipes', verifyToken, requireAdmin, catalogController.upsertRecipe);
router.delete('/recipes/:id', verifyToken, requireAdmin, catalogController.deleteRecipe);

// Mesas
router.get('/tables', verifyToken, catalogController.getTables);
router.post('/tables', verifyToken, requireAdmin, catalogController.upsertTable);
router.patch('/tables/:id/status', verifyToken, catalogController.updateTableStatus);
router.get('/tables/:id/current-order', verifyToken, catalogController.getCurrentOrder);
router.delete('/tables/:id', verifyToken, requireAdmin, catalogController.deleteTable);

module.exports = router;

