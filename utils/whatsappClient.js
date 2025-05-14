const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { QRCode } = require('../models');
const SessionManager = require('./sessionManager/SessionManager');
const path = require('path');
const fs = require('fs');

// Create session directory if it doesn't exist
const sessionDir = path.join(__dirname, '../session');
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    console.log('Session directory created:', sessionDir);
}

// Initialize the client with session persistence
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'client-one',
    dataPath: sessionDir
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  },
  restartOnAuthFail: true,
  qrMaxRetries: 5,
  qrTimeoutMs: 60000
});

// Initialize session manager
const sessionManager = new SessionManager(client);

// Function to update QR code in database
async function updateQRCode(qrCodeUrl, status = 'active') {
    try {
        console.log(`Updating QR code with status: ${status}`);
        const [qrCode, created] = await QRCode.findOrCreate({
            where: { id: 1 },
            defaults: { 
                qrCodeUrl, 
                status,
                connected: false,
                phoneNumber: null,
                updatedAt: new Date()
            }
        });

        if (!created) {
            await qrCode.update({ 
                qrCodeUrl, 
                status,
                connected: false,
                phoneNumber: null,
                updatedAt: new Date()
            });
        }

        // Verify the update
        const verifyQR = await QRCode.findOne({ where: { id: 1 } });
        if (verifyQR.status !== status || verifyQR.connected !== false) {
            console.error('QR code update verification failed');
            throw new Error('QR code update verification failed');
        }

        console.log(`QR Code ${created ? 'created' : 'updated'} in database with status: ${status}`);
        return true;
    } catch (error) {
        console.error('Error updating QR code in database:', error);
        return false;
    }
}

// Track client connection state
let clientConnected = false;

client.on('qr', async (qr) => {
    console.log('QR event triggered');
    try {
        // First ensure we're in disconnected state
        await QRCode.update(
            { 
                status: 'disconnected',
                connected: false,
                phoneNumber: null,
                updatedAt: new Date()
            },
            { where: { id: 1 } }
        );

        // Convert QR code to data URL
        const qrCodeDataUrl = await qrcode.toDataURL(qr);
        console.log('QR Code Data URL generated, length:', qrCodeDataUrl.length);

        // Update QR code in database
        await updateQRCode(qrCodeDataUrl, 'active');
        
        // Update connection state
        clientConnected = false;
    } catch (error) {
        console.error('Error handling QR code:', error);
        // Try to update with error status
        await updateQRCode('', 'error');
    }
});

client.on('ready', async () => {
    console.log('Client is ready!');
    try {
        if (client.info && client.info.wid) {
            const connectedPhoneNumber = client.info.wid.user;
            const [updated] = await QRCode.update(
                { 
                    phoneNumber: connectedPhoneNumber, 
                    status: 'connected', 
                    connected: true,
                    qrCodeUrl: '' // Clear QR code when connected
                },
                { where: { id: 1 } }
            );

            if (updated) {
                console.log(`Phone number ${connectedPhoneNumber} saved to database, connection status updated to connected`);
                sessionManager.startMonitoring();
                
                // Update connection state
                clientConnected = true;
            }
        }
    } catch (error) {
        console.error('Error handling ready event:', error);
    }
});

client.on('disconnected', async (reason) => {
    console.log('Client was disconnected:', reason);
    try {
        sessionManager.stopMonitoring();
        
        // Update database and clear QR code
        await QRCode.update(
            { 
                status: 'disconnected', 
                connected: false,
                qrCodeUrl: '',
                phoneNumber: null,
                updatedAt: new Date()
            },
            { where: { id: 1 } }
        );
        
        // Update connection state
        clientConnected = false;
        
        // Try to reconnect without clearing the session
        const reconnected = await sessionManager.handleDisconnection();
        if (reconnected) {
            clientConnected = true;
        } else {
            console.log('Auto-reconnection failed, but keeping session data for manual reconnection');
            // Note: We're NOT clearing the session here anymore to prevent data loss
        }
    } catch (error) {
        console.error('Error handling disconnected event:', error);
    }
});

client.on('authenticated', () => {
    console.log('Client has been authenticated!');
    clientConnected = true;
});

client.on('auth_failure', async msg => {
    console.error('AUTHENTICATION FAILURE:', msg);
    try {
        // Update connection state
        clientConnected = false;
        
        // Clear session and update database
        await sessionManager.clearSession();
        // Force client reinitialization
        setTimeout(() => {
            client.initialize().catch(console.error);
        }, 5000);
    } catch (error) {
        console.error('Error handling auth failure:', error);
    }
});

// Add state check function
const checkState = async () => {
    try {
        const qrRecord = await QRCode.findOne({ where: { id: 1 } });
        const isConnected = client.info && client.info.wid ? true : false;
        
        // Update our connection tracking variable
        clientConnected = isConnected;
        
        // If there's a mismatch between DB and client state
        if ((qrRecord.status === 'connected' && !isConnected) || 
            (qrRecord.connected && !isConnected)) {
            console.log('Detected state mismatch, updating database state only (keeping session)');
            
            // Stop monitoring but don't clear session
            await sessionManager.stopMonitoring();
            
            // Update database to match actual client state
            await QRCode.update(
                { 
                    status: 'disconnected',
                    connected: false,
                    updatedAt: new Date()
                },
                { where: { id: 1 } }
            );
            
            console.log("Database state updated. Session data preserved for manual reconnection.");
        }
    } catch (error) {
        console.error('Error checking state:', error);
    }
};

// Run state check more frequently
setInterval(checkState, 15000);

// Function to check if client is connected
const isConnected = () => {
    return clientConnected && client.info && client.info.wid;
};

// Attempt to initiate session recovery on startup
const attemptSessionRecovery = async () => {
    try {
        const qrRecord = await QRCode.findOne({ where: { id: 1 } });
        if (qrRecord && qrRecord.connected) {
            console.log("Previously connected session found, attempting recovery...");
            // The initialize call below will attempt to use the stored session
        }
    } catch (error) {
        console.error("Error during session recovery attempt:", error);
    }
};

// Initialize the client
console.log('Initializing WhatsApp client...');
attemptSessionRecovery()
    .then(() => client.initialize())
    .catch(error => {
        console.error('Error initializing WhatsApp client:', error);
    });

// Export client and session manager
module.exports = {
    client,
    sessionManager,
    isConnected
};


