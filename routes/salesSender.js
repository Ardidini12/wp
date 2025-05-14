var express = require('express');
var router = express.Router();
var { SalesSenderMessage, SalesSenderSettings, SalesImport } = require('../models');
const salesSender = require('../utils/salesSender');
const { Sequelize, Op } = require('sequelize');

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// GET sales sender page
router.get('/sales-sender', isAuthenticated, async (req, res) => {
  try {
    // Get settings
    let settings = await SalesSenderSettings.findOne();
    
    // Initialize settings if they don't exist
    if (!settings) {
      await salesSender.initializeSettings();
      settings = await SalesSenderSettings.findOne();
    }
    
    // Get messages stats
    const stats = await salesSender.getSalesMessagesStats();
    
    // Get recent messages for display
    const initialMessages = await SalesSenderMessage.findAll({
      where: { isFollowup: false },
      order: [['scheduledTime', 'DESC']],
      limit: 50
    });
    
    const followupMessages = await SalesSenderMessage.findAll({
      where: { isFollowup: true },
      order: [['scheduledTime', 'DESC']],
      limit: 50
    });
    
    // Get recent sales data for reference
    const recentSales = await SalesImport.findAll({
      where: { status: 'completed' },
      order: [['importDate', 'DESC']],
      limit: 5
    });
    
    // Parse response data for sales
    const salesData = [];
    for (const sale of recentSales) {
      if (sale.responseData) {
        try {
          const data = JSON.parse(sale.responseData);
          if (Array.isArray(data) && data.length > 0) {
            // Add just the first few records to avoid overwhelming the UI
            salesData.push(...data.slice(0, 10));
          }
        } catch (error) {
          console.error('Error parsing sales data:', error);
        }
      }
    }
    
    res.render('salesSender', {
      settings,
      stats,
      initialMessages,
      followupMessages,
      salesData,
      currentPage: 'sales-sender'
    });
  } catch (err) {
    console.error('Error loading sales sender page:', err);
    res.status(500).send('Error loading sales sender page');
  }
});

// POST update settings
router.post('/sales-sender/settings', isAuthenticated, async (req, res) => {
  try {
    const {
      initialMessageTemplate,
      followupMessageTemplate,
      initialMessageDelay,
      followupMessageDelay,
      autoSend,
      isActive
    } = req.body;
    
    // Validate inputs
    if (!initialMessageTemplate || !followupMessageTemplate) {
      return res.status(400).json({
        success: false,
        message: 'Message templates cannot be empty'
      });
    }
    
    // Find or create settings
    let settings = await SalesSenderSettings.findOne();
    
    if (!settings) {
      settings = await SalesSenderSettings.create({
        initialMessageTemplate,
        followupMessageTemplate,
        initialMessageDelay: parseInt(initialMessageDelay) || 120,
        followupMessageDelay: parseInt(followupMessageDelay) || 259200,
        autoSend: autoSend === 'on' || autoSend === true,
        isActive: isActive === 'on' || isActive === true
      });
    } else {
      // Update existing settings
      await settings.update({
        initialMessageTemplate,
        followupMessageTemplate,
        initialMessageDelay: parseInt(initialMessageDelay) || 120,
        followupMessageDelay: parseInt(followupMessageDelay) || 259200,
        autoSend: autoSend === 'on' || autoSend === true,
        isActive: isActive === 'on' || isActive === true
      });
    }
    
    // Restart queue processing with new settings
    salesSender.stopProcessingQueue();
    salesSender.startProcessingQueue();
    
    return res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating settings: ' + err.message
    });
  }
});

// GET messages data (for AJAX refresh)
router.get('/sales-sender/messages', isAuthenticated, async (req, res) => {
  try {
    const { type } = req.query;
    
    let where = {};
    if (type === 'initial') {
      where.isFollowup = false;
    } else if (type === 'followup') {
      where.isFollowup = true;
    }
    
    const messages = await SalesSenderMessage.findAll({
      where,
      order: [['scheduledTime', 'DESC']],
      limit: 100
    });
    
    const stats = await salesSender.getSalesMessagesStats();
    
    res.json({
      success: true,
      messages,
      stats
    });
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages'
    });
  }
});

// POST delete message
router.post('/sales-sender/delete/:id', isAuthenticated, async (req, res) => {
  try {
    const messageId = req.params.id;
    
    const message = await SalesSenderMessage.findByPk(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }
    
    await message.destroy();
    
    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting message'
    });
  }
});

// POST refresh message status
router.post('/sales-sender/refresh', isAuthenticated, async (req, res) => {
  try {
    const stats = await salesSender.getSalesMessagesStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('Error refreshing message status:', err);
    res.status(500).json({
      success: false,
      message: 'Error refreshing message status'
    });
  }
});

// POST process sales data manually
router.post('/sales-sender/process-sales', isAuthenticated, async (req, res) => {
  try {
    const { importId } = req.body;
    
    if (!importId) {
      return res.status(400).json({
        success: false,
        message: 'Import ID is required'
      });
    }
    
    const importRecord = await SalesImport.findByPk(importId);
    if (!importRecord || importRecord.status !== 'completed') {
      return res.status(404).json({
        success: false,
        message: 'Import record not found or not completed'
      });
    }
    
    // Parse sales data
    let salesData = [];
    if (importRecord.responseData) {
      try {
        salesData = JSON.parse(importRecord.responseData);
      } catch (error) {
        console.error('Error parsing sales data:', error);
        return res.status(500).json({
          success: false,
          message: 'Error parsing sales data'
        });
      }
    }
    
    // Process sales data for messaging
    const result = await salesSender.processSalesData(salesData);
    
    res.json({
      success: true,
      processed: result.processed,
      message: `Processed ${result.processed} sales for messaging`
    });
  } catch (err) {
    console.error('Error processing sales data:', err);
    res.status(500).json({
      success: false,
      message: 'Error processing sales data: ' + err.message
    });
  }
});

module.exports = router; 