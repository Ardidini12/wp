const { Client } = require('whatsapp-web.js');
const { Contact, Template, ScheduledMessage, WorkingHours } = require('../models');
const { client, isConnected } = require('./whatsappClient');
const { Sequelize } = require('sequelize');

// Configuration
const CHECK_INTERVAL_MS = 10000; // 10 seconds in milliseconds
const ERROR_RETRY_MS = 30000; // 30 seconds in milliseconds
const BATCH_SIZE = 500; // Process 500 contacts at a time
const DAILY_LIMIT = 1000; // Maximum number of messages scheduled per day

let isSending = false;
let timeoutId = null;

// Check if current time is within working hours
async function isWithinWorkingHours() {
  try {
    // Get working hours settings - always use the first row
    const workingHours = await WorkingHours.findOne();
    
    // If no working hours are set or restrictions are disabled, allow sending
    if (!workingHours || !workingHours.isActive) {
      console.log('Working hours restrictions are disabled. Messages can be sent at any time.');
      return true;
    }
    
    // Get current time in selected timezone
    const now = new Date().toLocaleString('en-US', { timeZone: workingHours.timezone });
    const currentTime = new Date(now);
    
    // Extract hours and minutes
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    
    // Parse working hours
    const [openHour, openMinute] = workingHours.openTime.split(':').map(Number);
    const [closeHour, closeMinute] = workingHours.closeTime.split(':').map(Number);
    
    // Convert to minutes for easier comparison
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    const openTimeMinutes = openHour * 60 + openMinute;
    const closeTimeMinutes = closeHour * 60 + closeMinute;
    
    // Format time for logging
    const format12Hour = (h, m) => {
      const period = h < 12 ? 'AM' : 'PM';
      const hour12 = h % 12 || 12; // Convert 0 to 12 for 12 AM
      return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
    };
    
    const openTimeFormatted = format12Hour(openHour, openMinute);
    const closeTimeFormatted = format12Hour(closeHour, closeMinute);
    const currentTimeFormatted = format12Hour(currentHour, currentMinute);
    
    // Check if current time is within working hours
    const isWithin = currentTimeMinutes >= openTimeMinutes && currentTimeMinutes <= closeTimeMinutes;
    
    if (isWithin) {
      console.log(`Current time (${currentTimeFormatted}) is within working hours (${openTimeFormatted} - ${closeTimeFormatted}). Messages will be sent.`);
    } else {
      console.log(`Current time (${currentTimeFormatted}) is outside working hours (${openTimeFormatted} - ${closeTimeFormatted}). Messages will be queued until ${currentTimeMinutes < openTimeMinutes ? 'today' : 'tomorrow'} at ${openTimeFormatted}.`);
    }
    
    return isWithin;
  } catch (error) {
    console.error('Error checking working hours:', error);
    // In case of error, allow sending to prevent complete system halt
    return true;
  }
}

// Calculate next valid schedule time based on working hours
async function calculateNextValidScheduleTime(baseTime) {
  try {
    // Get working hours settings - always use the first row
    const workingHours = await WorkingHours.findOne();
    
    // If no working hours are set or restrictions are disabled, use the base time
    if (!workingHours || !workingHours.isActive) {
      console.log('Working hours restrictions are disabled. Using original scheduled time.');
      return baseTime;
    }
    
    // Parse working hours
    const [openHour, openMinute] = workingHours.openTime.split(':').map(Number);
    const [closeHour, closeMinute] = workingHours.closeTime.split(':').map(Number);
    
    // Format time for logging
    const format12Hour = (h, m) => {
      const period = h < 12 ? 'AM' : 'PM';
      const hour12 = h % 12 || 12; // Convert 0 to 12 for 12 AM
      return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
    };
    
    const openTimeFormatted = format12Hour(openHour, openMinute);
    const closeTimeFormatted = format12Hour(closeHour, closeMinute);
    
    // Get current time in selected timezone
    const nowInSelectedTimezone = new Date(baseTime.toLocaleString('en-US', { timeZone: workingHours.timezone }));
    const baseTimeFormatted = format12Hour(nowInSelectedTimezone.getHours(), nowInSelectedTimezone.getMinutes());
    
    // Check if within working hours
    const nowHour = nowInSelectedTimezone.getHours();
    const nowMinute = nowInSelectedTimezone.getMinutes();
    
    const nowTimeMinutes = nowHour * 60 + nowMinute;
    const openTimeMinutes = openHour * 60 + openMinute;
    const closeTimeMinutes = closeHour * 60 + closeMinute;
    
    if (nowTimeMinutes >= openTimeMinutes && nowTimeMinutes <= closeTimeMinutes) {
      // Within working hours, use the base time
      console.log(`Scheduled time (${baseTimeFormatted}) is within working hours (${openTimeFormatted} - ${closeTimeFormatted}). Message will be sent as scheduled.`);
      return baseTime;
    }
    
    // Outside working hours, schedule for next working day opening time
    let nextWorkingTime = new Date(nowInSelectedTimezone);
    
    if (nowTimeMinutes < openTimeMinutes) {
      // It's before opening time today
      nextWorkingTime.setHours(openHour, openMinute, 0, 0);
      console.log(`Scheduled time (${baseTimeFormatted}) is before working hours. Rescheduling to today at ${openTimeFormatted}.`);
    } else {
      // It's after closing time, schedule for tomorrow's opening
      nextWorkingTime.setDate(nextWorkingTime.getDate() + 1);
      nextWorkingTime.setHours(openHour, openMinute, 0, 0);
      console.log(`Scheduled time (${baseTimeFormatted}) is after working hours. Rescheduling to tomorrow at ${openTimeFormatted}.`);
    }
    
    // Adjust for timezone
    const nextWorkingTimeUTC = new Date(nextWorkingTime.toLocaleString('en-US', { timeZone: 'UTC' }));
    return nextWorkingTimeUTC;
  } catch (error) {
    console.error('Error calculating next valid schedule time:', error);
    // In case of error, use the base time
    return baseTime;
  }
}

async function processQueue() {
  try {
    // Get working hours settings
    const workingHours = await WorkingHours.findOne();
    
    // Only check working hours if they are enabled
    if (workingHours && workingHours.isActive) {
      const withinWorkingHours = await isWithinWorkingHours();
      if (!withinWorkingHours) {
        console.log('Outside working hours. Messages will resume during business hours.');
        timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
        return;
      }
    } else {
      console.log('Working hours restrictions are disabled. Messages will be sent at any time.');
    }
    
    const now = new Date();
    const pendingMessages = await ScheduledMessage.findAll({
      where: {
        status: 'pending',
        scheduledTime: { [Sequelize.Op.lte]: now },
        retryCount: { [Sequelize.Op.lt]: 3 } // Don't retry more than 3 times
      },
      order: [['scheduledTime', 'ASC']],
      limit: 1
    });

    if (pendingMessages.length === 0) {
      timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
      return;
    }

    const message = pendingMessages[0];
    const whatsappId = `${message.phoneNumber.replace(/\D/g, '').replace(/^0+/, '')}@c.us`;
    
    try {
      // Check client connection
      if (!isConnected()) {
        console.log('WhatsApp client disconnected. Attempting reconnection...');
        timeoutId = setTimeout(processQueue, ERROR_RETRY_MS);
        return;
      }
      
      await client.sendMessage(whatsappId, message.message);
      await message.update({
        status: 'sent',
        sentTime: new Date()
      });
      console.log(`Message sent to ${message.phoneNumber} successfully.`);
    } catch (error) {
      console.error(`Failed to send message to ${message.phoneNumber}:`, error);
      
      // Update retry count and error message
      await message.update({ 
        retryCount: message.retryCount + 1,
        lastError: error.message || 'Unknown error',
        status: message.retryCount >= 2 ? 'failed' : 'pending' // Mark as failed after 3 attempts
      });
    }

    // Get the interval from the message record
    const interval = message.interval || 45000;
    timeoutId = setTimeout(processQueue, interval);
  } catch (error) {
    console.error('Error processing message queue:', error);
    timeoutId = setTimeout(processQueue, ERROR_RETRY_MS);
  }
}

async function scheduleBulkMessages(req, res) {
  try {
    const { template, interval } = req.body;
    const intervalMs = parseInt(interval) * 1000; // Convert seconds to milliseconds
    const batchId = Date.now().toString(); // Simple batch ID based on timestamp

    // Validate interval
    if (!interval || isNaN(intervalMs) || intervalMs < 15000) {
      return res.status(400).send('Please select a valid interval (minimum 15 seconds)');
    }

    const contactIds = Object.values(req.body)
      .flatMap(source => Array.isArray(source) ? source : [source])
      .filter(id => !isNaN(id));

    if (contactIds.length === 0) {
      return res.status(400).send('No contacts selected');
    }

    if (!template) {
      return res.status(400).send('No template selected');
    }

    const templateData = await Template.findByPk(template);
    if (!templateData) {
      return res.status(404).send('Template not found');
    }

    // Check if the number of selected contacts is too large
    if (contactIds.length > 10000) {
      return res.status(400).send('Too many contacts selected. Please select fewer than 10,000 contacts.');
    }

    // Check daily limit
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    const scheduledToday = await ScheduledMessage.count({
      where: {
        scheduledTime: {
          [Sequelize.Op.between]: [startOfDay, endOfDay]
        }
      }
    });
    
    if (scheduledToday + contactIds.length > DAILY_LIMIT) {
      return res.status(400).send(`Daily limit of ${DAILY_LIMIT} messages would be exceeded. Please select fewer contacts or try again tomorrow.`);
    }

    // Get working hours to estimate completion time
    const workingHours = await WorkingHours.findOne({ where: { isActive: true } });
    let estimatedTimeHours = (contactIds.length * intervalMs / 3600000);
    let estimatedWorkingDays = 1;
    
    if (workingHours && workingHours.isActive) {
      const [openHour, openMinute] = workingHours.openTime.split(':').map(Number);
      const [closeHour, closeMinute] = workingHours.closeTime.split(':').map(Number);
      const workingHoursPerDay = (closeHour * 60 + closeMinute) - (openHour * 60 + openMinute);
      const workingHoursPerDayInHours = workingHoursPerDay / 60;
      
      estimatedWorkingDays = Math.ceil(estimatedTimeHours / workingHoursPerDayInHours);
    }
    
    const now = new Date();
    let scheduledCount = 0;
    
    const contacts = await Contact.findAll({
      where: { id: contactIds },
      attributes: ['id', 'name', 'surname', 'phoneNumber', 'email', 'birthday']
    });
    
    const contactMap = {};
    contacts.forEach(contact => {
      contactMap[contact.id] = contact;
    });
    
    function replaceTemplateVariables(template, contact) {
      let message = template;
      message = message.replace(/\{name\}/g, contact.name || '');
      message = message.replace(/\{surname\}/g, contact.surname || '');
      message = message.replace(/\{phone\}/g, contact.phoneNumber || '');
      message = message.replace(/\{email\}/g, contact.email || '');
      if (contact.birthday) {
        message = message.replace(/\{birthday\}/g, new Date(contact.birthday).toLocaleDateString());
      } else {
        message = message.replace(/\{birthday\}/g, '');
      }
      return message;
    }
    
    for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
      const batchIds = contactIds.slice(i, i + BATCH_SIZE);
      
      const scheduledMessages = await Promise.all(batchIds
        .filter(id => contactMap[id])
        .map(async (id, index) => {
          const contact = contactMap[id];
          const personalizedMessage = replaceTemplateVariables(templateData.templateContent, contact);
          
          // Calculate scheduled time, respecting working hours
          const baseScheduledTime = new Date(now.getTime() + intervalMs * (scheduledCount + index + 1));
          const scheduledTime = await calculateNextValidScheduleTime(baseScheduledTime);
          
          return {
            contactName: contact.name,
            contactSurname: contact.surname,
            phoneNumber: contact.phoneNumber,
            message: personalizedMessage,
            interval: intervalMs,
            batchId: batchId,
            retryCount: 0,
            scheduledTime: scheduledTime,
            status: 'pending'
          };
        }));
      
      await ScheduledMessage.bulkCreate(scheduledMessages);
      scheduledCount += scheduledMessages.length;
    }
    
    if (!timeoutId) {
      timeoutId = setTimeout(processQueue, 1000); // Start processing queue immediately
    }
    
    return res.render('bulkSenderConfirmation', {
      count: scheduledCount,
      estimatedTime: Math.round(estimatedTimeHours * 10) / 10,
      estimatedDays: estimatedWorkingDays,
      interval: interval,
      currentPage: 'bulk-sender'
    });
  } catch (error) {
    console.error('Error scheduling messages:', error);
    res.status(500).send('Error scheduling messages');
  }
}

async function getScheduledMessagesStats() {
  try {
    const pending = await ScheduledMessage.count({ where: { status: 'pending' } });
    const sent = await ScheduledMessage.count({ where: { status: 'sent' } });
    const failed = await ScheduledMessage.count({ where: { status: 'failed' } });
    
    const nextMessage = await ScheduledMessage.findOne({
      where: { status: 'pending' },
      order: [['scheduledTime', 'ASC']]
    });
    
    const lastSent = await ScheduledMessage.findOne({
      where: { status: 'sent' },
      order: [['sentTime', 'DESC']]
    });
    
    return {
      pending,
      sent,
      failed,
      total: pending + sent + failed,
      nextScheduledTime: nextMessage ? nextMessage.scheduledTime : null,
      lastSentTime: lastSent ? lastSent.sentTime : null
    };
  } catch (error) {
    console.error('Error getting message stats:', error);
    return { pending: 0, sent: 0, failed: 0, total: 0 };
  }
}

async function startProcessingQueue() {
  console.log('Starting message queue processing...');
  if (!timeoutId) {
    timeoutId = setTimeout(processQueue, 1000);
    return true;
  }
  return false;
}

module.exports = { 
  scheduleBulkMessages, 
  processQueue, 
  startProcessingQueue,
  getScheduledMessagesStats, 
  isWithinWorkingHours,
  calculateNextValidScheduleTime
};
