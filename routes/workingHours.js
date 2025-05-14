var express = require('express');
var router = express.Router();
var { WorkingHours } = require('../models');

// Middleware to check if user is logged in (reuse from index.js)
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// GET working hours settings page
router.get('/settings/working-hours', isAuthenticated, async (req, res) => {
  try {
    // Get current working hours settings - always get the first row
    let workingHours = await WorkingHours.findOne();
    
    // If no settings exist, create default settings
    if (!workingHours) {
      workingHours = await WorkingHours.create({
        openTime: '10:00',
        closeTime: '20:00',
        timezone: 'Europe/Tirane',
        isActive: true
      });
      console.log('Created default working hours settings:', workingHours.toJSON());
    } else {
      console.log('Found existing working hours settings:', workingHours.toJSON());
    }
    
    res.render('workingHours', { 
      workingHours, 
      currentPage: 'settings' 
    });
  } catch (err) {
    console.error('Error loading working hours settings:', err);
    res.status(500).send('Error loading working hours settings');
  }
});

// POST update working hours settings
router.post('/settings/working-hours', isAuthenticated, async (req, res) => {
  try {
    console.log('Received form data:', req.body);
    const { timezone, openTime, closeTime } = req.body;
    
    // Handle checkbox - it will be undefined when not checked
    const isActive = req.body.isActive === 'true';
    
    console.log('Processing form values:', {
      timezone,
      openTime,
      closeTime,
      isActive: !!req.body.isActive // Convert to boolean - false if undefined
    });
    
    // Validate times
    if (!openTime || !closeTime) {
      return res.status(400).send('Opening and closing times are required');
    }
    
    // Convert to 24-hour format if needed
    const openTimeParts = openTime.split(':');
    const closeTimeParts = closeTime.split(':');
    
    // Basic validation
    if (parseInt(openTimeParts[0]) > parseInt(closeTimeParts[0]) || 
        (parseInt(openTimeParts[0]) === parseInt(closeTimeParts[0]) && 
         parseInt(openTimeParts[1]) >= parseInt(closeTimeParts[1]))) {
      return res.status(400).send('Opening time must be earlier than closing time');
    }
    
    // First, check if there are multiple rows and delete all except the first one
    const allSettings = await WorkingHours.findAll();
    console.log(`Found ${allSettings.length} working hours settings in database`);
    
    if (allSettings.length > 1) {
      // Keep the first row, delete the rest
      for (let i = 1; i < allSettings.length; i++) {
        await allSettings[i].destroy();
        console.log(`Deleted duplicate working hours setting with ID ${allSettings[i].id}`);
      }
    }
    
    // Now get or create the single record
    let [workingHours, created] = await WorkingHours.findOrCreate({
      where: {},
      defaults: {
        openTime: '10:00',
        closeTime: '20:00',
        timezone: 'Europe/Tirane',
        isActive: true
      }
    });
    
    // Update with new values
    await workingHours.update({
      openTime,
      closeTime,
      timezone: timezone || 'Europe/Tirane',
      isActive: !!req.body.isActive // Convert to boolean - false if undefined
    });
    
    console.log('Updated working hours settings:', workingHours.toJSON());
    
    res.redirect('/settings/working-hours');
  } catch (err) {
    console.error('Error updating working hours settings:', err);
    res.status(500).send(`Error updating working hours settings: ${err.message}`);
  }
});

module.exports = router;