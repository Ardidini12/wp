const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { QRCode } = require('../models');
const fs = require('fs');
const path = require('path');

// Define the session directory path
const sessionDir = path.join(__dirname, '../session');

// Check if the session directory exists, and create it if it doesn't
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

// Initialize the client with session persistence
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'client-one',
    dataPath: sessionDir
  })
});

client.on('qr', async (qr) => {
  console.log('QR event triggered');
  try {
    // Convert QR code to data URL
    const qrCodeDataUrl = await qrcode.toDataURL(qr);
    console.log('QR Code Data URL generated');

    // Find or create the QR code in the database
    const [qrCode, created] = await QRCode.findOrCreate({
      where: { id: 1 },
      defaults: { 
        qrCodeUrl: qrCodeDataUrl, 
        status: 'active',
        connected: false
      }
    });

    // If the QR code already exists, update it
    if (!created) {
      await qrCode.update({ 
        qrCodeUrl: qrCodeDataUrl, 
        status: 'active',
        connected: false 
      });
      console.log('QR Code updated in database');
    } else {
      console.log('QR Code created in database');
    }
  } catch (error) {
    console.error('Error generating QR code:', error);
  }
});

client.on('ready', async () => {
  console.log('Client is ready!');
  try {
    // Use client.info to get the phone number
    if (client.info && client.info.wid) {
      const connectedPhoneNumber = client.info.wid.user;
      // Update the QRCode table with the connected phone number
      const [updated] = await QRCode.update(
        { phoneNumber: connectedPhoneNumber, status: 'connected', connected: true },
        { where: { id: 1 } }
      );

      if (updated) {
        console.log(`Phone number ${connectedPhoneNumber} saved to database, connection status updated to connected`);
      } else {
        console.error('Failed to update the phone number in the database');
        
        // Try to create a new record if update failed
        await QRCode.create({
          id: 1,
          phoneNumber: connectedPhoneNumber,
          status: 'connected',
          connected: true
        });
      }
    } else {
      console.error('Client info is not available');
    }
  } catch (error) {
    console.error('Error handling ready event:', error);
  }
});

client.on('disconnected', async (reason) => {
  console.log('Client was disconnected', reason);
  try {
    // Update QRCode status to disconnected
    const [updated] = await QRCode.update(
      { status: 'disconnected', connected: false },
      { where: { id: 1 } }
    );
    
    if (updated) {
      console.log('QR Code status updated to disconnected');
    } else {
      console.error('Failed to update QR Code status to disconnected');
    }
  } catch (error) {
    console.error('Error handling disconnected event:', error);
  }
});

client.on('authenticated', () => {
  console.log('Client has been authenticated!');
});

client.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
  // Handle authentication failure, possibly by retrying or alerting the user
});

// Function to check if client is connected
const isConnected = () => {
  return client.info && client.info.wid ? true : false;
};

client.initialize();

module.exports = client;
module.exports.isConnected = isConnected;


