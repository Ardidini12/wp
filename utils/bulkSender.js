const { Client } = require('whatsapp-web.js');
const { Contact, Template, ScheduledMessage } = require('../models');
const client = require('./whatsappClient');
const { Sequelize } = require('sequelize');

// Configuration
const INTERVAL_MS = 45000; // 45 seconds in milliseconds
const CHECK_INTERVAL_MS = 10000; // 10 seconds in milliseconds
const ERROR_RETRY_MS = 30000; // 30 seconds in milliseconds

let isSending = false;
let timeoutId = null;

async function processQueue() {
  try {
    const now = new Date();
    const pendingMessages = await ScheduledMessage.findAll({
      where: {
        status: 'pending',
        scheduledTime: { [Sequelize.Op.lte]: now }
      },
      order: [['scheduledTime', 'ASC']],
      limit: 1
    });

    if (pendingMessages.length === 0) {
      timeoutId = setTimeout(processQueue, CHECK_INTERVAL_MS); // Check every 10 seconds
      return;
    }

    const message = pendingMessages[0];
    const whatsappId = `${message.phoneNumber.replace(/\D/g, '').replace(/^0+/, '')}@c.us`;
    
    try {
      await client.sendMessage(whatsappId, message.message);
      await message.update({
        status: 'sent',
        sentTime: new Date()
      });
    } catch (error) {
      console.error(`Failed to send message to ${message.phoneNumber}:`, error);
      await message.update({ status: 'failed' });
    }

    // Process next message after the fixed interval
    timeoutId = setTimeout(processQueue, INTERVAL_MS);
  } catch (error) {
    console.error('Error processing queue:', error);
    timeoutId = setTimeout(processQueue, ERROR_RETRY_MS); // Retry after error
  }
}

async function scheduleBulkMessages(req, res) {
  try {
    const { template } = req.body;
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

    const contacts = await Contact.findAll({ where: { id: contactIds }});
    const now = new Date();
    
    // Create scheduled messages with 45-second intervals
    const scheduledMessages = contacts.map((contact, index) => ({
      contactName: contact.name,
      contactSurname: contact.surname,
      phoneNumber: contact.phoneNumber,
      message: templateData.templateContent,
      scheduledTime: new Date(now.getTime() + INTERVAL_MS * (index + 1)), // First message after 45s
      status: 'pending'
    }));

    await ScheduledMessage.bulkCreate(scheduledMessages);
    
    // Start processing if not already running
    if (!timeoutId) {
      timeoutId = setTimeout(processQueue, INTERVAL_MS); // Initial 45s delay
    }
    
    res.redirect('/bulk-sender');
  } catch (error) {
    console.error('Error scheduling messages:', error);
    res.status(500).send('Error scheduling messages');
  }
}

// Start processing when the server starts
processQueue();

module.exports = { scheduleBulkMessages, processQueue };
