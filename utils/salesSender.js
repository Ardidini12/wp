const { SalesSenderMessage, SalesSenderSettings } = require('../models');
const { client, isConnected } = require('./whatsappClient');
const { Sequelize } = require('sequelize');

// Configuration
const CHECK_INTERVAL_MS = 10000; // 10 seconds
const ERROR_RETRY_MS = 30000; // 30 seconds

let isSending = false;
let timeoutId = null;

// Format phone number to the required format +355XXXXXXXXX
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  // Remove all non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // Check if it starts with leading 0 or country code
  if (digitsOnly.startsWith('0')) {
    // Replace leading 0 with 355
    return '+355' + digitsOnly.substring(1);
  } else if (digitsOnly.startsWith('355')) {
    return '+' + digitsOnly;
  } else {
    // Assume it's a local number without prefix
    return '+355' + digitsOnly;
  }
}

// Add hours to date while respecting weekends
function addHoursExcludeWeekends(date, hours) {
  const result = new Date(date);
  const millisecondsToAdd = hours * 60 * 60 * 1000;
  
  // Calculate target time
  result.setTime(result.getTime() + millisecondsToAdd);
  
  // Check if result falls on weekend
  const dayOfWeek = result.getDay();
  
  // If weekend, move to Monday
  if (dayOfWeek === 0) { // Sunday
    result.setDate(result.getDate() + 1); // Move to Monday
  } else if (dayOfWeek === 6) { // Saturday
    result.setDate(result.getDate() + 2); // Move to Monday
  }
  
  return result;
}

// Process message queue
async function processQueue() {
  if (isSending) {
    timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
    return;
  }
  
  isSending = true;
  
  try {
    // Get settings to check if auto-send is enabled
    const settings = await SalesSenderSettings.findOne();
    if (!settings || !settings.autoSend) {
      console.log('Sales Sender: Auto-send is disabled. Skipping message queue processing.');
      isSending = false;
      timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
      return;
    }
    
    const now = new Date();
    const pendingMessages = await SalesSenderMessage.findAll({
      where: {
        status: 'pending',
        scheduledTime: { [Sequelize.Op.lte]: now },
        retryCount: { [Sequelize.Op.lt]: 3 } // Don't retry more than 3 times
      },
      order: [['scheduledTime', 'ASC']],
      limit: 1
    });
    
    if (pendingMessages.length === 0) {
      isSending = false;
      timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
      return;
    }
    
    const message = pendingMessages[0];
    
    // Format phone number to WhatsApp format
    const formattedNumber = formatPhoneNumber(message.phoneNumber);
    if (!formattedNumber) {
      await message.update({
        status: 'failed',
        lastError: 'Invalid phone number format'
      });
      isSending = false;
      timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
      return;
    }
    
    const whatsappId = `${formattedNumber.replace(/^\+/, '')}@c.us`;
    
    try {
      // Check client connection
      if (!isConnected()) {
        console.log('WhatsApp client disconnected. Will retry later.');
        isSending = false;
        timeoutId = setTimeout(processQueue, ERROR_RETRY_MS);
        return;
      }
      
      // Send message
      await client.sendMessage(whatsappId, message.message);
      
      // Update message status
      await message.update({
        status: 'sent',
        sentTime: new Date()
      });
      
      console.log(`Sales message sent to ${message.phoneNumber} successfully.`);
      
      // If this was an initial message, schedule the follow-up message
      if (!message.isFollowup) {
        await scheduleFollowupMessage(message);
      }
    } catch (error) {
      console.error(`Failed to send sales message to ${message.phoneNumber}:`, error);
      
      // Update retry count and error message
      await message.update({ 
        retryCount: message.retryCount + 1,
        lastError: error.message || 'Unknown error',
        status: message.retryCount >= 2 ? 'failed' : 'pending' // Mark as failed after 3 attempts
      });
    }
  } catch (error) {
    console.error('Error processing sales message queue:', error);
  }
  
  isSending = false;
  timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS);
}

// Schedule follow-up message after configured time
async function scheduleFollowupMessage(initialMessage) {
  try {
    // Get the current settings
    const settings = await SalesSenderSettings.findOne();
    if (!settings || !settings.isActive) return;
    
    // Calculate the follow-up time
    const followupDelayMonths = settings.followupMessageDelay || 6; // Default 6 months
    const scheduledTime = new Date();
    scheduledTime.setMonth(scheduledTime.getMonth() + followupDelayMonths);
    
    // Ensure it's not scheduled for a weekend
    const dayOfWeek = scheduledTime.getDay();
    if (dayOfWeek === 0) { // Sunday
      scheduledTime.setDate(scheduledTime.getDate() + 1); // Move to Monday
    } else if (dayOfWeek === 6) { // Saturday
      scheduledTime.setDate(scheduledTime.getDate() + 2); // Move to Monday
    }
    
    // Prepare personalized message
    const template = settings.followupMessageTemplate;
    const personalizedMessage = template
      .replace(/\{name\}/g, initialMessage.customerName || '')
      .replace(/\{surname\}/g, initialMessage.customerSurname || '');
    
    // Create follow-up message
    await SalesSenderMessage.create({
      salesId: initialMessage.salesId,
      customerName: initialMessage.customerName,
      customerSurname: initialMessage.customerSurname,
      phoneNumber: initialMessage.phoneNumber,
      message: personalizedMessage,
      isFollowup: true,
      status: 'pending',
      scheduledTime: scheduledTime,
      saleDetails: initialMessage.saleDetails
    });
    
    console.log(`Follow-up message scheduled for ${initialMessage.phoneNumber} at ${scheduledTime}`);
  } catch (error) {
    console.error('Error scheduling follow-up message:', error);
  }
}

// Process sales data from API to schedule initial messages
async function processSalesData(salesData) {
  try {
    // Skip if no sales data
    if (!Array.isArray(salesData) || salesData.length === 0) {
      console.log('No sales data to process');
      return { processed: 0 };
    }
    
    // Get settings
    const settings = await SalesSenderSettings.findOne();
    if (!settings || !settings.isActive) {
      console.log('Sales Sender is not active. Skipping sales data processing.');
      return { processed: 0 };
    }
    
    // Calculate the initial message delay time using hours
    const initialDelayHours = settings.initialMessageDelay || 2; // Default 2 hours
    const scheduledTime = addHoursExcludeWeekends(new Date(), initialDelayHours);
    
    // Process each sale
    let processedCount = 0;
    
    for (const sale of salesData) {
      try {
        // Extract customer details from sale data according to the correct structure
        let customerName = '';
        let phoneNumber = '';
        
        // Extract from businessEntity if available
        if (sale.businessEntity) {
          customerName = sale.businessEntity.name || '';
          phoneNumber = sale.businessEntity.phone || sale.businessEntity.mobile || '';
        } else {
          // Fallback to direct properties
          customerName = sale.customerName || sale.name || '';
          phoneNumber = sale.phoneNumber || sale.phone || '';
        }
        
        // Skip if no phone number
        if (!phoneNumber) {
          console.log(`Sale ${sale.id}: No phone number found, skipping`);
          continue;
        }
        
        // Format phone number
        phoneNumber = formatPhoneNumber(phoneNumber);
        if (!phoneNumber) {
          console.log(`Sale ${sale.id}: Invalid phone number format, skipping`);
          continue;
        }
        
        // Check if we already have a message for this sale
        const existingMessage = await SalesSenderMessage.findOne({
          where: { 
            salesId: sale.id,
            isFollowup: false
          }
        });
        
        if (existingMessage) {
          console.log(`Sale ${sale.id}: Message already scheduled, skipping`);
          continue;
        }
        
        // Split name into first name and surname for better personalization
        let firstName = customerName;
        let surname = '';
        
        if (customerName.includes(' ')) {
          const nameParts = customerName.split(' ');
          firstName = nameParts[0];
          surname = nameParts.slice(1).join(' ');
        }
        
        // Prepare personalized message
        const template = settings.initialMessageTemplate;
        const personalizedMessage = template
          .replace(/\{name\}/g, firstName)
          .replace(/\{surname\}/g, surname);
        
        // Create message record
        await SalesSenderMessage.create({
          salesId: sale.id,
          customerName: firstName,
          customerSurname: surname,
          phoneNumber: phoneNumber,
          message: personalizedMessage,
          isFollowup: false,
          status: 'pending',
          scheduledTime: scheduledTime,
          saleDetails: sale
        });
        
        processedCount++;
      } catch (error) {
        console.error(`Error processing sale ${sale.id}:`, error);
      }
    }
    
    console.log(`Processed ${processedCount} sales for messaging`);
    return { processed: processedCount };
  } catch (error) {
    console.error('Error processing sales data for messaging:', error);
    return { processed: 0, error: error.message };
  }
}

// Start processing queue
function startProcessingQueue() {
  if (!timeoutId) {
    console.log('Starting Sales Sender message queue processing...');
    timeoutId = setTimeout(processQueue, 1000);
  }
}

// Stop processing queue
function stopProcessingQueue() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
    console.log('Sales Sender message queue processing stopped');
  }
}

// Get sales messages statistics
async function getSalesMessagesStats() {
  try {
    const pending = await SalesSenderMessage.count({ where: { status: 'pending' } });
    const sent = await SalesSenderMessage.count({ where: { status: 'sent' } });
    const failed = await SalesSenderMessage.count({ where: { status: 'failed' } });
    
    const initialPending = await SalesSenderMessage.count({ 
      where: { 
        status: 'pending',
        isFollowup: false
      } 
    });
    
    const followupPending = await SalesSenderMessage.count({ 
      where: { 
        status: 'pending',
        isFollowup: true
      } 
    });
    
    const nextInitialMessage = await SalesSenderMessage.findOne({
      where: { 
        status: 'pending',
        isFollowup: false
      },
      order: [['scheduledTime', 'ASC']]
    });
    
    const nextFollowupMessage = await SalesSenderMessage.findOne({
      where: { 
        status: 'pending',
        isFollowup: true
      },
      order: [['scheduledTime', 'ASC']]
    });
    
    const lastSent = await SalesSenderMessage.findOne({
      where: { status: 'sent' },
      order: [['sentTime', 'DESC']]
    });
    
    return {
      pending,
      sent,
      failed,
      initialPending,
      followupPending,
      total: pending + sent + failed,
      nextInitialMessageTime: nextInitialMessage ? nextInitialMessage.scheduledTime : null,
      nextFollowupMessageTime: nextFollowupMessage ? nextFollowupMessage.scheduledTime : null,
      lastSentTime: lastSent ? lastSent.sentTime : null
    };
  } catch (error) {
    console.error('Error getting sales message stats:', error);
    return { 
      pending: 0, 
      sent: 0, 
      failed: 0, 
      initialPending: 0,
      followupPending: 0,
      total: 0 
    };
  }
}

// Initialize settings if they don't exist
async function initializeSettings() {
  try {
    const existingSettings = await SalesSenderSettings.findOne();
    if (!existingSettings) {
      await SalesSenderSettings.create({
        initialMessageTemplate: 'Hello {name} {surname}, thank you for your purchase!',
        followupMessageTemplate: 'Hello {name} {surname}, we hope you enjoyed your purchase! Would you like to visit us again?',
        initialMessageDelay: 2, // 2 hours
        followupMessageDelay: 6, // 6 months
        autoSend: false,
        isActive: true
      });
      console.log('Sales Sender settings initialized');
    }
  } catch (error) {
    console.error('Error initializing Sales Sender settings:', error);
  }
}

module.exports = {
  processQueue,
  startProcessingQueue,
  stopProcessingQueue,
  processSalesData,
  getSalesMessagesStats,
  formatPhoneNumber,
  initializeSettings
}; 