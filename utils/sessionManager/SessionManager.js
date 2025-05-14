const fs = require('fs').promises;
const path = require('path');
const { QRCode } = require('../../models');

class SessionManager {
    constructor(client) {
        this.client = client;
        this.sessionDir = path.join(__dirname, '../../session');
        this.cacheDir = path.join(__dirname, '../../.wwebjs_cache');
        this.checkInterval = 30000; // 30 seconds
        this.maxReconnectAttempts = 3;
        this.reconnectDelay = 5000; // 5 seconds
        this.monitoringInterval = null;
    }

    // Check if a session exists
    async checkSession() {
        try {
            // Check if session directory exists
            const sessionExists = await fs.access(this.sessionDir)
                .then(() => true)
                .catch(() => false);
            
            // Check if cache directory exists
            const cacheExists = await fs.access(this.cacheDir)
                .then(() => true)
                .catch(() => false);

            // Check for MultiDevice token file which indicates a valid session
            const mdTokenPath = path.join(this.sessionDir, 'client-one', 'Default', 'md_connect_token.json');
            const mdTokenExists = await fs.access(mdTokenPath)
                .then(() => true)
                .catch(() => false);

            // Check the database status
            const qrCode = await QRCode.findOne({ where: { id: 1 } });
            const isConnected = qrCode?.status === 'connected';

            console.log(`Session check: sessionDir=${sessionExists}, cacheDir=${cacheExists}, mdToken=${mdTokenExists}, dbConnected=${isConnected}`);

            return {
                sessionExists,
                cacheExists,
                mdTokenExists,
                isConnected,
                phoneNumber: qrCode?.phoneNumber,
                status: qrCode?.status || 'unknown'
            };
        } catch (error) {
            console.error('Error checking session:', error);
            return {
                sessionExists: false,
                cacheExists: false,
                mdTokenExists: false,
                isConnected: false,
                phoneNumber: null,
                status: 'error'
            };
        }
    }

    // Safely close the client and its browser
    async closeClient() {
        try {
            // Stop monitoring first
            this.stopMonitoring();

            try {
                // Destroy the client first
                if (this.client.destroy) {
                    await this.client.destroy();
                }
            } catch (destroyError) {
                console.warn('Warning during client destroy:', destroyError.message);
            }

            try {
                // Close the page if it exists
                if (this.client.pupPage && !this.client.pupPage.isClosed()) {
                    await this.client.pupPage.close().catch(() => {});
                }
            } catch (pageError) {
                console.warn('Warning during page close:', pageError.message);
            }

            try {
                // Close the browser if it exists
                if (this.client.browser && this.client.browser.isConnected()) {
                    await this.client.browser.close().catch(() => {});
                }
            } catch (browserError) {
                console.warn('Warning during browser close:', browserError.message);
            }

            // Wait a bit for resources to be released
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Reset client state
            this.client.pupPage = null;
            this.client.browser = null;

            return true;
        } catch (error) {
            console.error('Error closing client:', error);
            return false;
        }
    }

    // Safely delete directory with retries
    async safeDeleteDirectory(dir, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Check if directory exists
                const exists = await fs.access(dir).then(() => true).catch(() => false);
                if (!exists) {
                    console.log(`Directory doesn't exist, skipping deletion: ${dir}`);
                    return true;
                }

                // Try to delete the directory
                await fs.rm(dir, { recursive: true, force: true });
                console.log(`Successfully deleted directory: ${dir}`);

                // Verify deletion
                const stillExists = await fs.access(dir).then(() => true).catch(() => false);
                if (!stillExists) {
                    return true;
                }

                // If directory still exists, wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Attempt ${attempt} - Error deleting directory ${dir}:`, error);
                if (attempt === maxRetries) {
                    return false;
                }
                // Wait before next attempt
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return false;
    }

    // Update database status with verification
    async updateDatabaseStatus(status = 'disconnected', phoneNumber = null, qrCodeUrl = '') {
        try {
            console.log(`Updating database status to: ${status}`);
            
            await QRCode.update(
                { 
                    status: status,
                    connected: status === 'connected',
                    phoneNumber: phoneNumber,
                    qrCodeUrl: qrCodeUrl || '', // Ensure it's never null
                    updatedAt: new Date() // Force update timestamp
                },
                { where: { id: 1 } }
            );

            // Verify the update
            const record = await QRCode.findOne({ where: { id: 1 } });
            if (record.status !== status || record.connected !== (status === 'connected')) {
                throw new Error('Database status verification failed');
            }

            console.log(`Database status updated and verified: ${status}`);
            return true;
        } catch (error) {
            console.error('Error updating database:', error);
            throw error;
        }
    }

    // Clear existing session
    async clearSession() {
        try {
            console.log('Starting session cleanup...');

            // 1. Stop monitoring first
            this.stopMonitoring();

            // 2. Close the client first
            await this.closeClient();
            console.log('Client closed');

            // 3. Update database status to disconnected and clear QR code
            await this.updateDatabaseStatus('disconnected', null, '');
            console.log('Database updated to disconnected state');

            // 4. Delete session and cache directories with retries
            const results = await Promise.all([
                this.safeDeleteDirectory(this.sessionDir),
                this.safeDeleteDirectory(this.cacheDir)
            ]);

            // 5. Verify cleanup
            const sessionStatus = await this.checkSession();
            if (sessionStatus.sessionExists || sessionStatus.cacheExists) {
                throw new Error('Failed to delete session directories completely');
            }

            // 6. Force process cleanup
            if (global.gc) {
                global.gc();
            }

            // 7. Wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 8. Reset client state
            this.client.pupPage = null;
            this.client.browser = null;
            this.client.info = null;

            // 9. Double-check database state
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

            // 10. Reinitialize client to trigger new QR code generation
            console.log('Reinitializing client...');
            await this.client.initialize().catch(error => {
                console.error('Error during client reinitialization:', error);
                throw error;
            });

            console.log('Session cleared successfully');
            return true;
        } catch (error) {
            console.error('Error during session clearing:', error);
            // Ensure database is in disconnected state even if other operations fail
            await this.updateDatabaseStatus('disconnected', null, '').catch(console.error);
            throw new Error('Failed to clear session completely: ' + error.message);
        }
    }

    // Start session monitoring
    startMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        this.monitoringInterval = setInterval(async () => {
            await this.checkConnectionStatus();
        }, this.checkInterval);
    }

    // Stop session monitoring
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    // Check connection status and handle disconnections
    async checkConnectionStatus() {
        try {
            const isConnected = this.client.info ? true : false;
            const sessionStatus = await this.checkSession();
            
            // If client thinks it's disconnected but DB shows connected
            if (!isConnected && sessionStatus.isConnected) {
                console.log('Connection mismatch detected, updating status...');
                await this.updateDatabaseStatus('disconnected', null, '');
                await this.handleDisconnection();
            }
        } catch (error) {
            console.error('Error checking connection status:', error);
        }
    }

    // Handle disconnection
    async handleDisconnection() {
        let attempts = 0;
        
        // First check session status
        const sessionStatus = await this.checkSession();
        console.log('Session status before reconnection attempt:', sessionStatus);
        
        // If no session files exist, we need to require a new QR code
        if (!sessionStatus.sessionExists || !sessionStatus.mdTokenExists) {
            console.log('Session files missing, requiring new QR code scan');
            return false;
        }
        
        while (attempts < this.maxReconnectAttempts) {
            try {
                console.log(`Reconnection attempt ${attempts + 1}/${this.maxReconnectAttempts}`);
                
                // Close the client first to ensure clean reconnection
                await this.closeClient();
                
                // Wait a moment before initializing
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try to reinitialize the client
                await this.client.initialize();
                
                // Wait for a moment to check if connection is established
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Check if client has connection info
                if (this.client.info && this.client.info.wid) {
                    console.log('Reconnection successful');
                    
                    // Update database to reflect successful reconnection
                    const connectedPhoneNumber = this.client.info.wid.user;
                    await QRCode.update(
                        { 
                            phoneNumber: connectedPhoneNumber, 
                            status: 'connected', 
                            connected: true,
                            qrCodeUrl: '',
                            updatedAt: new Date()
                        },
                        { where: { id: 1 } }
                    );
                    
                    // Start monitoring again
                    this.startMonitoring();
                    
                    return true;
                }
                
                console.log(`Attempt ${attempts + 1} failed: no client info available`);
                attempts++;
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
            } catch (error) {
                console.error(`Reconnection attempt ${attempts + 1} failed:`, error);
                attempts++;
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
            }
        }

        console.log('Max reconnection attempts reached, but NOT clearing session data');
        
        // Just return false to indicate reconnection failed, but DON'T clear the session
        // This way the user can manually reconnect later or clear the session if they want
        return false;
    }

    // Get current session status
    async getSessionStatus() {
        const sessionStatus = await this.checkSession();
        const isConnected = this.client.info ? true : false;
        
        return {
            sessionExists: sessionStatus.sessionExists,
            cacheExists: sessionStatus.cacheExists,
            isConnected,
            phoneNumber: sessionStatus.phoneNumber,
            lastCheck: new Date().toISOString()
        };
    }
}

module.exports = SessionManager; 