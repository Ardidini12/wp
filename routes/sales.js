var express = require('express');
var router = express.Router();
var { SalesImport } = require('../models');
const salesApi = require('../utils/salesApi');

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// GET sales page
router.get('/sales', isAuthenticated, async (req, res) => {
  try {
    // Get recent imports
    const recentImports = await salesApi.getRecentImports();
    
    // Get sync status
    const syncInfo = salesApi.getLastSyncInfo();
    
    res.render('sales', { 
      recentImports,
      syncInfo,
      currentPage: 'sales'
    });
  } catch (err) {
    console.error('Error loading sales page:', err);
    res.status(500).send('Error loading sales page');
  }
});

// GET view sales import
router.get('/sales/view/:id', isAuthenticated, async (req, res) => {
  try {
    const importId = req.params.id;
    const importRecord = await salesApi.getImportById(importId);
    
    if (!importRecord) {
      return res.status(404).send('Import record not found');
    }
    
    const responseData = importRecord.responseData ? JSON.parse(importRecord.responseData) : null;
    
    res.render('salesView', {
      importRecord,
      salesData: responseData,
      currentPage: 'sales'
    });
  } catch (err) {
    console.error('Error viewing sales data:', err);
    res.status(500).send(`Error viewing sales data: ${err.message}`);
  }
});

// POST delete sales import
router.post('/sales/delete/:id', isAuthenticated, async (req, res) => {
  try {
    const importId = req.params.id;
    console.log(`Attempting to delete import with ID: ${importId}`);
    
    const importRecord = await SalesImport.findByPk(importId);
    
    if (!importRecord) {
      console.log(`Import record not found with ID: ${importId}`);
      return res.status(404).json({
        success: false,
        message: 'Import record not found'
      });
    }
    
    // Delete the record
    await importRecord.destroy();
    console.log(`Successfully deleted import with ID: ${importId}`);
    
    // Always return JSON response for consistency
    return res.json({
      success: true,
      message: 'Sales import deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting sales import:', err);
    
    // Always return JSON error
    return res.status(500).json({
      success: false,
      message: `Error deleting sales import: ${err.message}`
    });
  }
});

module.exports = router;
