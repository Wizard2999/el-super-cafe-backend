const express = require('express');
const router = express.Router();
const creditController = require('../controllers/credit.controller');

// Customer routes
router.get('/customers', creditController.getCustomers);
router.get('/customers/:id', creditController.getCustomerById);
router.post('/customers', creditController.createCustomer);
router.put('/customers/:id', creditController.updateCustomer);

// Transaction routes
router.post('/payment', creditController.registerPayment);
router.post('/opening-balance', creditController.createOpeningBalance);

// Reporting routes
router.get('/portfolio', creditController.getPortfolio);

module.exports = router;
