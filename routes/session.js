const express = require('express');
const router = express.Router();
const { client, sessionManager } = require('../utils/whatsappClient');

// Get current session status
router.get('/status', async (req, res) => {
    try {
        const status = await sessionManager.getSessionStatus();
        res.json(status);
    } catch (error) {
        console.error('Error getting session status:', error);
        res.status(500).json({ error: 'Failed to get session status' });
    }
});

// Clear current session and prepare for new QR code
router.post('/clear', async (req, res) => {
    try {
        console.log('Starting session clear process...');
        
        // First check if we have any session data
        const status = await sessionManager.getSessionStatus();
        console.log('Current session status:', status);

        // Attempt to clear the session
        await sessionManager.clearSession();
        console.log('Session cleared successfully');

        // Double check the cleanup
        const newStatus = await sessionManager.getSessionStatus();
        console.log('New session status:', newStatus);

        if (newStatus.sessionExists || newStatus.cacheExists) {
            console.warn('Warning: Some session files still exist after cleanup');
        }

        // Always return success to allow frontend to proceed
        res.json({ 
            message: 'Session cleared successfully',
            requiresQR: true,
            warnings: newStatus.sessionExists || newStatus.cacheExists ? 
                'Some session files could not be deleted. You may need to restart the application.' : undefined
        });
    } catch (error) {
        console.error('Error during session clear:', error);
        
        // Return 200 even with errors to allow frontend to proceed
        res.status(200).json({ 
            message: 'Session cleared with warnings',
            warnings: error.message,
            requiresQR: true
        });
    }
});

// Force reconnection attempt
router.post('/reconnect', async (req, res) => {
    try {
        const result = await sessionManager.handleDisconnection();
        if (result) {
            res.json({ message: 'Reconnection successful' });
        } else {
            res.json({ 
                message: 'Reconnection failed, new QR code required',
                requiresQR: true 
            });
        }
    } catch (error) {
        console.error('Error during reconnection:', error);
        res.status(500).json({ error: 'Failed to reconnect' });
    }
});

module.exports = router; 