const axios = require('axios');
const { SalesImport } = require('../models');
const { Op } = require('sequelize');
const schedule = require('node-schedule');
const salesSender = require('./salesSender');

// API configuration
const API_BASE_URL = process.env.API_BASE_URL || 'https://bss-api.posplus.al';  
const API_CREDENTIALS = {
  userName: process.env.API_USERNAME || 'Admin',
  password: process.env.API_PASSWORD || 'T3aWy<[3dq07'
};

// Token storage
let API_TOKEN = null;
let REFRESH_TOKEN = null;
let tokenExpiresAt = null;

// Fetch fresh token if needed
async function ensureToken() {
  const now = new Date();
  
  // If we have a token and it's not expired, use it
  if (API_TOKEN && tokenExpiresAt && now < tokenExpiresAt) {
    return API_TOKEN;
  }
  
  // If we have a refresh token, try to refresh
  if (REFRESH_TOKEN) {
    try {
      return await refreshToken();
    } catch (error) {
      console.error('Failed to refresh token, will try to login again:', error.message);
      // Continue to login flow if refresh fails
    }
  }
  
  // Otherwise, get a new token via login
  try {
    console.log('Authenticating with Sales API...');
    console.log(`Using API URL: ${API_BASE_URL}`);
    
    // According to the documentation
    const authEndpoint = `${API_BASE_URL}/authentication/login`;
    console.log(`Trying authentication endpoint: ${authEndpoint}`);
    
    const response = await axios.post(authEndpoint, API_CREDENTIALS);
    
    console.log('Auth response received');
    
    if (response.data && response.data.accessToken) {
      API_TOKEN = response.data.accessToken;
      REFRESH_TOKEN = response.data.refreshToken;
      
      // Set token expiration (8 hours to be safe)
      tokenExpiresAt = new Date();
      tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 8);
      
      console.log('Successfully authenticated with Sales API');
      return API_TOKEN;
    } else {
      console.error('Failed to get token from Sales API:', response.data);
      throw new Error('No token received from Sales API');
    }
  } catch (error) {
    console.error('Authentication error:', error.message);
    if (error.response) {
      console.error('API response error:', error.response.status, error.response.data);
    }
    
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

// Refresh the token using the refresh token
async function refreshToken() {
  if (!REFRESH_TOKEN) {
    throw new Error('No refresh token available');
  }
  
  try {
    console.log('Refreshing token...');
    
    const refreshEndpoint = `${API_BASE_URL}/token/refresh`;
    const response = await axios.post(refreshEndpoint, {
      accessToken: API_TOKEN,
      refreshToken: REFRESH_TOKEN
    });
    
    if (response.data && response.data.accessToken) {
      API_TOKEN = response.data.accessToken;
      REFRESH_TOKEN = response.data.refreshToken;
      
      // Set token expiration (8 hours to be safe)
      tokenExpiresAt = new Date();
      tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 8);
      
      console.log('Successfully refreshed token');
      return API_TOKEN;
    } else {
      throw new Error('No token received when refreshing');
    }
  } catch (error) {
    console.error('Token refresh error:', error.message);
    if (error.response) {
      console.error('API response error:', error.response.status, error.response.data);
    }
    
    throw error; // Let the caller handle this
  }
}

// Function to fetch sales data with date range
async function fetchSalesData(params) {
  let startDate, endDate, salesPerson, productId;
  
  // Handle both object format and individual parameters for backward compatibility
  if (typeof params === 'object' && params !== null) {
    startDate = params.startDate;
    endDate = params.endDate;
    salesPerson = params.salesPerson;
    productId = params.productId;
  } else {
    // Legacy support if called with positional parameters
    startDate = arguments[0];
    endDate = arguments[1];
  }
  
  if (!startDate || !endDate) {
    throw new Error('Start date and end date are required');
  }
  
  let importRecord = null;
  
  try {
    // First check for existing sale IDs to prevent duplicates
    let existingSaleIds = new Set();
    try {
      // Get all completed imports
      const previousImports = await SalesImport.findAll({
        where: { status: 'completed' },
        order: [['importDate', 'DESC']]
      });
      
      // Extract all sale IDs from all previous imports
      for (const importRecord of previousImports) {
        if (importRecord.responseData) {
          try {
            const responseData = JSON.parse(importRecord.responseData);
            if (Array.isArray(responseData)) {
              // Add all sale IDs to the Set (Set ensures uniqueness)
              responseData.forEach(sale => {
                if (sale && sale.id) {
                  existingSaleIds.add(sale.id);
                }
              });
            }
          } catch (parseErr) {
            console.error(`Error parsing responseData for import ${importRecord.id}:`, parseErr);
          }
        }
      }
      
      console.log(`Found ${existingSaleIds.size} existing sale IDs in the database`);
    } catch (error) {
      console.error('Error checking for existing sales:', error);
    }
    
    // Ensure we have a valid token
    const token = await ensureToken();
    console.log('Token obtained, length:', token.length);
    
    // Create a record of this import
    importRecord = await SalesImport.create({
      parameters: { startDate, endDate, salesPerson, productId },
      status: 'pending'
    });
    
    // Format date as MM/DD/YYYY for the API as required by their documentation
    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
    };
    
    // Build request parameters with exactly what the API expects - using the format that worked in Postman
    const requestParams = {
      Date: formatDate(endDate),
      PageNumber: '',
      PageSize: '',
      HasPhone: true,
      CustomerGroup: 'PAKICE'
    };
    
    // Log complete request for debugging
    console.log('Making request to BSS API:');
    console.log(`- URL: ${API_BASE_URL}/11120/Sales`);
    console.log(`- Token: Bearer ${token.substring(0, 15)}...`);
    console.log(`- Params: ${JSON.stringify(requestParams)}`);
    
    // Make the API request - using exactly the format that worked in Postman
    const salesEndpoint = `${API_BASE_URL}/11120/Sales`;
    console.log(`Full URL with params: ${salesEndpoint}?Date=${requestParams.Date}&PageNumber=${requestParams.PageNumber}&PageSize=${requestParams.PageSize}&HasPhone=${requestParams.HasPhone}&CustomerGroup=${requestParams.CustomerGroup}`);
    
    const response = await axios({
      method: 'get',
      url: salesEndpoint,
      headers: {
        'Authorization': `Bearer ${token}`
      },
      params: requestParams
    });
    
    // Log full response for debugging
    console.log('Sales data response status:', response.status);
    console.log('Response data type:', typeof response.data);
    if (Array.isArray(response.data)) {
      console.log('Sales data records count:', response.data.length);
      if (response.data.length > 0) {
        console.log('First record sample:', JSON.stringify(response.data[0]).substring(0, 150) + '...');
      }
    } else {
      console.log('Response is not an array. Data sample:', JSON.stringify(response.data).substring(0, 150) + '...');
    }
    
    // Filter out duplicates
    let salesData = response.data;
    if (Array.isArray(salesData)) {
      const originalCount = salesData.length;
      // Filter out any sale IDs that already exist in the database
      salesData = salesData.filter(sale => !existingSaleIds.has(sale.id));
      if (originalCount !== salesData.length) {
        console.log(`Filtered out ${originalCount - salesData.length} duplicate sales, keeping ${salesData.length} new sales`);
      }
    }
    
    // Update the import record with success - save raw data exactly as received
    await importRecord.update({
      status: 'completed',
      recordsImported: Array.isArray(salesData) ? salesData.length : 
                     (salesData && typeof salesData === 'object') ? 1 : 0,
      responseData: JSON.stringify(salesData)
    });
    
    console.log(`Import completed. Data saved to database with ID: ${importRecord.id}`);
    
    // Add sales data to sales sender for message scheduling
    if (Array.isArray(salesData) && salesData.length > 0) {
      try {
        const result = await salesSender.processSalesData(salesData);
        console.log(`Sales Sender: Processed ${result.processed} sales for messaging`);
      } catch (error) {
        console.error('Error processing sales data for messaging:', error);
      }
    }
    
    return {
      success: true,
      importId: importRecord.id,
      data: salesData
    };
  } catch (error) {
    console.error('Error fetching sales data:', error.message);
    
    // Create or update import record with error status
    if (importRecord) {
      await importRecord.update({
        status: 'failed',
        responseData: JSON.stringify({ error: error.message })
      });
    } else {
      importRecord = await SalesImport.create({
        parameters: { startDate, endDate, salesPerson, productId },
        status: 'failed',
        responseData: JSON.stringify({ error: error.message })
      });
    }
    
    return {
      success: false,
      message: error.message,
      error: error.message
    };
  }
}

// Function to get recent imports
async function getRecentImports() {
  try {
    // Get all imports, regardless of status, with a higher limit
    const imports = await SalesImport.findAll({
      order: [['importDate', 'DESC']],
      limit: 50 // Increased from 10 to show more records
    });
    return imports;
  } catch (error) {
    console.error('Error fetching recent sales imports:', error);
    return [];
  }
}

// Function to get a specific import
async function getImportById(id) {
  try {
    const importRecord = await SalesImport.findByPk(id);
    return importRecord;
  } catch (error) {
    console.error('Error fetching sales import:', error);
    return null;
  }
}

// Function to get the most recent successful import date
async function getLastSuccessfulImportDate() {
  try {
    const lastImport = await SalesImport.findOne({
      where: { status: 'completed' },
      order: [['importDate', 'DESC']]
    });
    
    if (lastImport && lastImport.parameters) {
      const params = typeof lastImport.parameters === 'string'
        ? JSON.parse(lastImport.parameters)
        : lastImport.parameters;
        
      return params.endDate;
    }
    
    // If no previous import, return a date 1 week ago
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return oneWeekAgo.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error getting last import date:', error);
    
    // Default to 1 week ago if error
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return oneWeekAgo.toISOString().split('T')[0];
  }
}

// Function to sync sales data automatically
async function syncSalesData() {
  try {
    console.log('Starting automatic sales data sync...');
    
    // Get current date as end date
    const today = new Date().toISOString().split('T')[0];
    
    // Find ALL previously imported sale IDs to ensure no duplicates
    let existingSaleIds = new Set();
    try {
      // Get all completed imports
      const previousImports = await SalesImport.findAll({
        where: { status: 'completed' },
        order: [['importDate', 'DESC']]
      });
      
      // Extract all sale IDs from all previous imports
      for (const importRecord of previousImports) {
        if (importRecord.responseData) {
          try {
            const responseData = JSON.parse(importRecord.responseData);
            if (Array.isArray(responseData)) {
              // Add all sale IDs to the Set (Set ensures uniqueness)
              responseData.forEach(sale => {
                if (sale && sale.id) {
                  existingSaleIds.add(sale.id);
                }
              });
            }
          } catch (parseErr) {
            console.error(`Error parsing responseData for import ${importRecord.id}:`, parseErr);
          }
        }
      }
      
      console.log(`Found ${existingSaleIds.size} existing sale IDs in the database`);
    } catch (error) {
      console.error('Error checking for existing sales:', error);
    }
    
    // Fetch current sales data from API
    console.log(`Fetching sales data for date: ${today}`);
    
    // Create parameters for API call
    const params = {
      startDate: today,
      endDate: today
    };
    
    // Get auth token
    const token = await ensureToken();
    
    // Format date for API
    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
    };
    
    // Build request parameters for the API
    const requestParams = {
      Date: formatDate(today),
      PageNumber: '',
      PageSize: '',
      HasPhone: true,
      CustomerGroup: 'PAKICE'
    };
    
    // Make the API request
    const salesEndpoint = `${API_BASE_URL}/11120/Sales`;
    console.log(`Fetching from: ${salesEndpoint} with date: ${requestParams.Date}`);
    
    const response = await axios({
      method: 'get',
      url: salesEndpoint,
      headers: {
        'Authorization': `Bearer ${token}`
      },
      params: requestParams
    });
    
    // Check if we received valid data
    if (!response.data || !Array.isArray(response.data)) {
      console.log('No valid data received from API');
      return { success: false, message: 'No valid data received from API' };
    }
    
    const currentSales = response.data;
    console.log(`Received ${currentSales.length} sales from API`);
    
    // Check if we have any new sales by comparing IDs against ALL historical imports
    const newSales = currentSales.filter(sale => !existingSaleIds.has(sale.id));
    
    if (newSales.length === 0) {
      console.log('No new sales found, skipping database update');
      return { 
        success: true, 
        message: 'No new sales to import',
        data: currentSales
      };
    }
    
    console.log(`Found ${newSales.length} new sales, saving to database`);
    
    // Create a new import record for the new sales
    const importRecord = await SalesImport.create({
      parameters: params,
      status: 'completed',
      recordsImported: newSales.length,
      responseData: JSON.stringify(newSales)
    });
    
    console.log(`New sales saved to database with import ID: ${importRecord.id}`);
    
    // Add a check for the successful import result and process for sales sender
    if (result.success && Array.isArray(result.data) && result.data.length > 0) {
      try {
        const senderResult = await salesSender.processSalesData(result.data);
        console.log(`Sales Sender: Processed ${senderResult.processed} sales for messaging`);
      } catch (error) {
        console.error('Error processing synced sales data for messaging:', error);
      }
    }
    
    return {
      success: true,
      importId: importRecord.id,
      data: newSales,
      newSalesCount: newSales.length
    };
  } catch (error) {
    console.error('Error during sales sync:', error);
    return {
      success: false,
      message: `Error during automatic sync: ${error.message}`
    };
  }
}

// Schedule automatic sync (every hour by default)
let syncJob = null;
let lastSyncTime = null;
let lastNewSalesCount = 0;

function startAutoSync(cronSchedule = '*/5 * * * *') { // Default: every 5 minutes
  if (syncJob) {
    syncJob.cancel();
  }
  
  console.log(`Scheduling automatic sales sync with cron pattern: ${cronSchedule}`);
  syncJob = schedule.scheduleJob(cronSchedule, async () => {
    console.log('Running scheduled sales data sync');
    try {
      const result = await syncSalesData();
      
      // Store last sync time and result
      lastSyncTime = new Date();
      
      if (result.success && result.newSalesCount) {
        lastNewSalesCount = result.newSalesCount;
        console.log(`Found ${result.newSalesCount} new sales at ${lastSyncTime.toISOString()}`);
      } else {
        console.log(`No new sales found at ${lastSyncTime.toISOString()}`);
      }
      
      // Initialize sales sender
      try {
        await salesSender.initializeSettings();
        salesSender.startProcessingQueue();
        console.log('Sales Sender: Message queue processing started');
      } catch (error) {
        console.error('Error initializing Sales Sender:', error);
      }
    } catch (err) {
      console.error('Scheduled sync error:', err);
    }
  });
  
  return true;
}

function getLastSyncInfo() {
  return {
    lastSyncTime,
    lastNewSalesCount
  };
}

function stopAutoSync() {
  if (syncJob) {
    syncJob.cancel();
    syncJob = null;
    
    // Stop sales sender queue
    try {
      salesSender.stopProcessingQueue();
      console.log('Sales Sender: Message queue processing stopped');
    } catch (error) {
      console.error('Error stopping Sales Sender queue:', error);
    }
    return true;
  }
  return false;
}

// Run initial sync when the server starts
setTimeout(async () => {
  try {
    console.log('Running initial sales data sync...');
    await syncSalesData();
    
    // Start automatic sync every hour
    startAutoSync();
  } catch (error) {
    console.error('Error during initial sales sync:', error);
  }
}, 10000); // Wait 10 seconds after server start

module.exports = {
  fetchSalesData,
  getRecentImports,
  getImportById,
  syncSalesData,
  startAutoSync,
  stopAutoSync,
  ensureToken,
  API_BASE_URL,
  getLastSyncInfo
};
