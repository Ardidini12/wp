var express = require('express');
var router = express.Router();
var { User } = require('../models'); // Import the User model
var bcrypt = require('bcrypt');
var { Contact } = require('../models'); // Import the Contact model
var { QRCode } = require('../models'); // Import the QRCode model
const multer = require('multer');
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB file size limit
  }
});
const csvParser = require('csv-parser');
const xlsx = require('xlsx');
const jsonfile = require('jsonfile');
const fs = require('fs');
const json2csv = require('json2csv').parse;
const { Template } = require('../models');
const { ScheduledMessage } = require('../models');
const { getContactsGroupedBySource } = require('../utils/contactUtils'); // Import the utility function
const { scheduleMessages } = require('../utils/bulkSender'); // Import the scheduleMessages function
const bulkSender = require('../utils/bulkSender'); // Import the bulkSender utility
const { Op } = require('sequelize');

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

/* GET home page. */
router.get('/', function(req, res, next) {
  // If user is logged in, redirect to dashboard
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  
  // Otherwise show the welcome page
  res.render('index', { title: 'BSS Sender' });
});

/* GET login page. */
router.get('/login', function(req, res, next) {
  res.render('login');
});

/* GET register page. */
router.get('/register', function(req, res, next) {
  res.render('register');
});

// POST register form
router.post('/register', async (req, res, next) => {
  const { username, password, role } = req.body;
  try {
    const user = await User.create({ username, password, role: role || 'user' });
    res.render('registration-success'); // Render a success page after registration
  } catch (err) {
    res.status(500).send('Error registering user');
  }
});

// POST login form
router.post('/login', async (req, res, next) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ where: { username } });
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.userId = user.id; // Save user ID in session
      res.redirect('/dashboard');
    } else {
      res.send('Invalid username or password');
    }
  } catch (err) {
    res.status(500).send('Error logging in');
  }
});

// GET dashboard page
router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    // Get WhatsApp connection status
    const whatsappClient = require('../utils/whatsappClient');
    const qrCode = await QRCode.findOne();
    
    // Check if client is actually ready/authenticated
    let whatsappStatus = false;
    let phoneNumber = null;
    try {
      // First try to get status from client directly
      whatsappStatus = whatsappClient.isConnected();
      
      // If client says we're connected but database doesn't match, update database
      if (whatsappStatus && qrCode && !qrCode.connected) {
        await QRCode.update({ connected: true, status: 'connected' }, { where: { id: 1 } });
        console.log('Updated database connection status to match client status (connected)');
      }
      
      // Get the phone number if connected
      if (whatsappStatus && qrCode && qrCode.phoneNumber) {
        phoneNumber = qrCode.phoneNumber;
      }
    } catch (clientErr) {
      console.log('Error checking client status, falling back to database:', clientErr);
      // Fall back to database value if client check fails
      whatsappStatus = qrCode ? qrCode.connected : false;
      if (whatsappStatus && qrCode && qrCode.phoneNumber) {
        phoneNumber = qrCode.phoneNumber;
      }
    }
    
    // Get count of contacts
    const contactCount = await Contact.count();
    
    // Get count of templates
    const templateCount = await Template.count();
    
    // Get recent messages
    const recentMessages = await ScheduledMessage.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    res.render('dashboard', { 
      whatsappStatus, 
      phoneNumber,
      contactCount, 
      templateCount, 
      recentMessages,
      currentPage: 'dashboard'
    });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }
});

// GET contacts page
router.get('/contacts', isAuthenticated, async (req, res) => {
  try {
    // Get pagination parameters from query
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // Show 100 contacts per page
    const offset = (page - 1) * limit;
    
    // Get the total count of contacts for pagination
    const totalContacts = await Contact.count();
    const totalPages = Math.ceil(totalContacts / limit);
    
    // Get contacts for the current page with pagination
    const contacts = await Contact.findAll({
      limit,
      offset,
      order: [['id', 'DESC']] // Most recent first
    });
    
    res.render('contact', {
      contacts,
      currentPage: 'contacts',
      pagination: {
        page,
        limit,
        totalContacts,
        totalPages
      }
    });
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).send('Error fetching contacts');
  }
});

// GET search contacts
router.get('/contacts/search', isAuthenticated, async (req, res) => {
  try {
    const searchTerm = req.query.term || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;
    
    // Search condition with Sequelize
    const searchCondition = {
      [Op.or]: [
        { name: { [Op.like]: `%${searchTerm}%` } },
        { surname: { [Op.like]: `%${searchTerm}%` } },
        { phoneNumber: { [Op.like]: `%${searchTerm}%` } },
        { email: { [Op.like]: `%${searchTerm}%` } },
        { source: { [Op.like]: `%${searchTerm}%` } }
      ]
    };
    
    // Get total count of matching contacts
    const totalContacts = await Contact.count({ where: searchCondition });
    const totalPages = Math.ceil(totalContacts / limit);
    
    // Get matching contacts for current page
    const contacts = await Contact.findAll({
      where: searchCondition,
      limit,
      offset,
      order: [['id', 'DESC']]
    });
    
    res.render('contact', {
      contacts,
      currentPage: 'contacts',
      searchTerm,
      pagination: {
        page,
        limit,
        totalContacts,
        totalPages
      }
    });
  } catch (err) {
    console.error('Error searching contacts:', err);
    res.status(500).send('Error searching contacts');
  }
});

// GET contacts as JSON
router.get('/contacts/json', isAuthenticated, async (req, res) => {
  try {
    const contacts = await Contact.findAll();
    res.json(contacts); // Return contacts as JSON
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ error: 'Error fetching contacts' });
  }
});

// POST logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Error logging out');
    }
    res.redirect('/');
  });
});

// POST add contact
router.post('/contacts/add', async (req, res) => {
  const { name, surname, phoneNumber, email, birthday } = req.body;
  if (!phoneNumber) {
    return res.status(400).send('Please provide a phone number');
  }
  try {
    await Contact.create({
      name: name || null,
      surname: surname || null,
      phoneNumber,
      email: email || null,
      birthday: birthday || null,
      source: 'manually added'
    });
    res.redirect('/contacts');
  } catch (err) {
    console.error('Error adding contact:', err);
    res.status(500).send('Error adding contact');
  }
});

// Define the parseContacts function
const parseContacts = (contacts) => {
  return contacts.map(contact => {
    // Generate a temporary ID if missing
    contact.id = contact.id || `temp-${Math.random().toString(36).substr(2, 9)}`;
    
    // Phone number handling
    if (contact.phone_number) {
      contact.phoneNumber = contact.phone_number.toString().replace(/\D/g, '');
      if (contact.phoneNumber.startsWith('0')) {
        contact.phoneNumber = contact.phoneNumber.substr(1);
      }
    } else {
      contact.phoneNumber = '';
    }

    // Birthday handling
    if (contact.birthday) {
      try {
        const parsedDate = new Date(contact.birthday);
        if (!isNaN(parsedDate)) {
          contact.birthday = parsedDate.toISOString().split('T')[0];
        } else {
          contact.birthday = null;
        }
      } catch (error) {
        contact.birthday = null;
      }
    } else {
      contact.birthday = null;
    }

    return contact;
  });
};

// POST import contacts
router.post('/contacts/import', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send('Please choose a file');
  }

  try {
  const fileType = file.mimetype;
    const originalFilename = file.originalname;
    const totalContacts = await countContactsInFile(file.path, fileType);
    
    // Store file info in session for later processing
    req.session.importFile = {
      path: file.path,
      type: fileType,
      name: originalFilename,
      totalContacts
    };
    
    // Redirect to a page that will show import progress rather than previewing all contacts
    res.render('importProgress', { 
      fileName: originalFilename, 
      totalContacts,
      currentPage: 'contacts'
    });
  } catch (err) {
    console.error('Error processing file:', err);
    res.status(500).send('Error processing file: ' + err.message);
  }
});

// Function to count contacts in a file without loading all into memory
async function countContactsInFile(filePath, fileType) {
  return new Promise((resolve, reject) => {
    try {
      if (fileType.includes('csv')) {
        let count = 0;
        fs.createReadStream(filePath)
          .pipe(csvParser())
          .on('data', () => count++)
          .on('end', () => resolve(count))
          .on('error', (err) => reject(err));
      } else if (fileType.includes('json')) {
        const data = jsonfile.readFileSync(filePath);
        resolve(Array.isArray(data) ? data.length : 0);
      } else if (fileType.includes('spreadsheetml')) {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        resolve(data.length);
      } else {
        reject(new Error('Unsupported file type'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

// New route to start the batch import process
router.post('/contacts/start-import', isAuthenticated, async (req, res) => {
  try {
    if (!req.session.importFile) {
      return res.status(400).json({ error: 'No import file information found' });
    }
    
    const { path, type, name } = req.session.importFile;
    
    // Start the import process in the background
    startBatchImport(path, type, name)
      .then(result => {
        console.log(`Import completed: ${result.imported} contacts imported, ${result.failed} failed`);
        // Clean up the session
        delete req.session.importFile;
      })
      .catch(err => {
        console.error('Error in batch import:', err);
      });
    
    // Immediately return success - the actual import happens in background
    res.json({ success: true, message: 'Import started' });
  } catch (err) {
    console.error('Error starting import:', err);
    res.status(500).json({ error: 'Error starting import process' });
  }
});

// Function to handle batch import of contacts
async function startBatchImport(filePath, fileType, fileName) {
  const BATCH_SIZE = 500; // Process 500 contacts at a time
  let imported = 0;
  let failed = 0;
  
  try {
    let contacts = [];
    
    // Read file based on type
    if (fileType.includes('csv')) {
      const results = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
          contacts = parseContacts(results);
    } else if (fileType.includes('json')) {
      contacts = parseContacts(jsonfile.readFileSync(filePath));
    } else if (fileType.includes('spreadsheetml')) {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      contacts = parseContacts(xlsx.utils.sheet_to_json(sheet));
    }
    
    // Process contacts in batches
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const results = await processBatch(batch, fileName);
      imported += results.imported;
      failed += results.failed;
    }
    
    // Clean up the file
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting import file:', err);
    });
    
    return { imported, failed };
  } catch (err) {
    console.error('Error in batch import:', err);
    return { imported, failed, error: err.message };
  }
}

// Process a batch of contacts
async function processBatch(contacts, fileName) {
  let imported = 0;
  let failed = 0;
  
  for (const contact of contacts) {
    try {
      await Contact.create({
        name: contact.name,
        surname: contact.surname,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
        birthday: contact.birthday,
        source: `imported from "${fileName}"`
      });
      imported++;
    } catch (err) {
      console.error('Error importing contact:', err);
      failed++;
    }
  }
  
  return { imported, failed };
}

// Route to check import progress
router.get('/contacts/import-status', isAuthenticated, async (req, res) => {
  try {
    // Get current count of contacts in the database
    const count = await Contact.count();
    res.json({ count });
  } catch (err) {
    console.error('Error checking import status:', err);
    res.status(500).json({ error: 'Error checking import status' });
  }
});

// GET edit contact page
router.get('/contacts/edit/:id', isAuthenticated, async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (contact) {
      res.render('editContact', { contact });
    } else {
      console.error(`Contact with ID ${req.params.id} not found`);
      res.status(404).send('Contact not found');
    }
  } catch (err) {
    console.error('Error fetching contact:', err);
    res.status(500).send('Error fetching contact');
  }
});

// POST save edited contact
router.post('/contacts/edit/:id', isAuthenticated, async (req, res) => {
  try {
    const { name, surname, phoneNumber, email, birthday } = req.body;
    const contact = await Contact.findByPk(req.params.id);
    if (contact) {
      await contact.update({ name, surname, phoneNumber, email, birthday });
      res.redirect('/contacts');
    } else {
      console.error(`Contact with ID ${req.params.id} not found`);
      res.status(404).send('Contact not found');
    }
  } catch (err) {
    console.error('Error updating contact:', err);
    res.status(500).send('Error updating contact');
  }
});

// DELETE single contact
router.get('/contacts/delete/:id', isAuthenticated, async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (contact) {
      await contact.destroy();
      res.redirect('/contacts');
    } else {
      res.status(404).send('Contact not found');
    }
  } catch (err) {
    res.status(500).send('Error deleting contact');
  }
});

// DELETE multiple contacts
router.post('/contacts/delete-multiple', isAuthenticated, async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No contact IDs provided' });
    }
    
    // Delete all contacts with the provided IDs
    const deletedCount = await Contact.destroy({
      where: {
        id: {
          [Op.in]: ids
        }
      }
    });
    
    res.json({ 
      success: true, 
      message: `Successfully deleted ${deletedCount} contacts`,
      deletedCount
    });
  } catch (err) {
    console.error('Error deleting multiple contacts:', err);
    res.status(500).json({ success: false, message: 'Error deleting contacts' });
  }
});

// DELETE ALL contacts
router.post('/contacts/delete-all', isAuthenticated, async (req, res) => {
  try {
    console.log('Delete all contacts requested');
    
    // Get the total count first for reporting
    const totalCount = await Contact.count();
    console.log(`Attempting to delete all ${totalCount} contacts`);
    
    // Delete all contacts without any conditions
    const deletedCount = await Contact.destroy({
      where: {},
      truncate: false // Use DELETE FROM, not TRUNCATE TABLE
    });
    
    console.log(`Successfully deleted ${deletedCount} contacts`);
    
    res.json({
      success: true,
      message: `Successfully deleted all ${deletedCount} contacts`,
      deletedCount
    });
  } catch (err) {
    console.error('Error deleting all contacts:', err);
    res.status(500).json({ 
      success: false, 
      message: `Error deleting all contacts: ${err.message}`
    });
  }
});

// Export contacts as JSON
router.get('/contacts/export/json', isAuthenticated, async (req, res) => {
  try {
    res.header('Content-Type', 'application/json');
    res.header('Content-Disposition', 'attachment; filename="contacts.json"');
    
    // Start writing with an opening bracket
    res.write('[\n');
    
    // Get total contacts count for batch processing
    const totalContacts = await Contact.count();
    const batchSize = 1000;
    let processedContacts = 0;
    let isFirst = true;
    
    // Process in batches
    while (processedContacts < totalContacts) {
      const contacts = await Contact.findAll({
        limit: batchSize,
        offset: processedContacts,
        order: [['id', 'ASC']]
      });
      
      // Write each contact as JSON
      for (const contact of contacts) {
        // Add comma between records (but not before the first one)
        if (!isFirst) {
          res.write(',\n');
        } else {
          isFirst = false;
        }
        res.write(JSON.stringify(contact.toJSON()));
      }
      
      processedContacts += contacts.length;
    }
    
    // End JSON array
    res.write('\n]');
    res.end();
  } catch (err) {
    console.error('Error exporting contacts as JSON:', err);
    res.status(500).send('Error exporting contacts');
  }
});

// Export contacts as CSV
router.get('/contacts/export/csv', isAuthenticated, async (req, res) => {
  try {
    // Set headers before any data is sent
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    
    // Define CSV fields
    const fields = ['id', 'name', 'surname', 'phoneNumber', 'email', 'birthday', 'source', 'createdAt', 'updatedAt'];
    
    // Write header row
    res.write(`${fields.join(',')}\n`);
    
    // Get total contacts count for batch processing
    const totalContacts = await Contact.count();
    const batchSize = 1000;
    let processedContacts = 0;
    
    // Process in batches
    while (processedContacts < totalContacts) {
      const contacts = await Contact.findAll({
        limit: batchSize,
        offset: processedContacts,
        order: [['id', 'ASC']]
      });
      
      // Convert contacts to CSV rows
      for (const contact of contacts) {
        const data = contact.toJSON();
        const row = fields.map(field => {
          const value = data[field];
          if (value === null || value === undefined) return '';
          if (field === 'createdAt' || field === 'updatedAt') {
            return value ? `"${new Date(value).toISOString()}"` : '';
          }
          return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
        });
        res.write(`${row.join(',')}\n`);
      }
      
      processedContacts += contacts.length;
    }
    
    res.end();
  } catch (err) {
    console.error('Error exporting contacts as CSV:', err);
    // Only send error response if headers haven't been sent
    if (!res.headersSent) {
    res.status(500).send('Error exporting contacts');
    }
  }
});

// Export contacts as Excel
router.get('/contacts/export/excel', isAuthenticated, async (req, res) => {
  try {
    // Create workbook and worksheet
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([['ID', 'Name', 'Surname', 'Phone Number', 'Email', 'Birthday', 'Source', 'Created At', 'Updated At']]);
    
    // Get total contacts count for batch processing
    const totalContacts = await Contact.count();
    const batchSize = 1000;
    let processedContacts = 0;
    let rowNum = 1; // Start after header row
    
    // Process in batches
    while (processedContacts < totalContacts) {
      const contacts = await Contact.findAll({
        limit: batchSize,
        offset: processedContacts,
        order: [['id', 'ASC']]
      });
      
      // Add each contact to the worksheet
      contacts.forEach(contact => {
        const data = contact.toJSON();
        xlsx.utils.sheet_add_aoa(worksheet, [[
          data.id,
          data.name || '',
          data.surname || '',
          data.phoneNumber || '',
          data.email || '',
          data.birthday || '',
          data.source || '',
          data.createdAt ? new Date(data.createdAt).toISOString() : '',
          data.updatedAt ? new Date(data.updatedAt).toISOString() : ''
        ]], { origin: `A${rowNum + 1}` });
        rowNum++;
      });
      
      processedContacts += contacts.length;
    }
    
    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');
    
    // Set headers before sending the buffer
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.xlsx"');
    
    // Send the workbook as a buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting contacts as Excel:', err);
    // Only send error response if headers haven't been sent
    if (!res.headersSent) {
    res.status(500).send('Error exporting contacts');
    }
  }
});

// GET WhatsApp status page
router.get('/whatsapp-status', isAuthenticated, async (req, res) => {
  try {
    const whatsappClient = require('../utils/whatsappClient');
    const qrCode = await QRCode.findOne();
    
    // Check if client is actually ready/authenticated
    let whatsappStatus = false;
    try {
      // First try to get status from client directly
      whatsappStatus = whatsappClient.isConnected();
      
      // If client says we're connected but database doesn't match, update database
      if (whatsappStatus && qrCode && !qrCode.connected) {
        await QRCode.update({ connected: true, status: 'connected' }, { where: { id: 1 } });
        console.log('Updated database connection status to match client status (connected)');
      }
    } catch (clientErr) {
      console.log('Error checking client status, falling back to database:', clientErr);
      // Fall back to database value if client check fails
      whatsappStatus = qrCode ? qrCode.connected : false;
    }
    
    res.render('whatsappStatus', { qrCode, whatsappStatus, currentPage: 'whatsapp' });
  } catch (err) {
    console.error('Error fetching WhatsApp status:', err);
    res.status(500).send('Error fetching WhatsApp status');
  }
});

// Alias for the WhatsApp status page with hyphen
router.get('/whatsapp-check', isAuthenticated, async (req, res) => {
  try {
    const whatsappClient = require('../utils/whatsappClient');
    const qrCode = await QRCode.findOne();
    
    // Check if client is actually ready/authenticated
    let whatsappStatus = false;
    try {
      // First try to get status from client directly
      whatsappStatus = whatsappClient.isConnected();
      
      // If client says we're connected but database doesn't match, update database
      if (whatsappStatus && qrCode && !qrCode.connected) {
        await QRCode.update({ connected: true, status: 'connected' }, { where: { id: 1 } });
        console.log('Updated database connection status to match client status (connected)');
      }
    } catch (clientErr) {
      console.log('Error checking client status, falling back to database:', clientErr);
      // Fall back to database value if client check fails
      whatsappStatus = qrCode ? qrCode.connected : false;
    }
    
    res.render('whatsappStatus', { qrCode, whatsappStatus, currentPage: 'whatsapp' });
  } catch (err) {
    console.error('Error fetching WhatsApp status:', err);
    res.status(500).send('Error fetching WhatsApp status');
  }
});

// GET bulk sender page
router.get('/bulk-sender', isAuthenticated, async (req, res) => {
  try {
    const templates = await Template.findAll();
    const contactsBySource = await getContactsGroupedBySource();
    const scheduledMessages = await ScheduledMessage.findAll({ 
      order: [['scheduledTime', 'ASC']]
    });
    res.render('bulkSender', {
      templates,
      contactsBySource,
      scheduledMessages,
      currentPage: 'bulk-sender'
    });
  } catch (err) {
    console.error('Error rendering bulk sender page:', err);
    res.status(500).send('Error rendering bulk sender page');
  }
});

// Alias for the bulk sender page with camelCase
router.get('/bulkSender', isAuthenticated, async (req, res) => {
  try {
    const templates = await Template.findAll();
    const contactsBySource = await getContactsGroupedBySource();
    const scheduledMessages = await ScheduledMessage.findAll({ 
      order: [['scheduledTime', 'ASC']]
    });
    res.render('bulkSender', {
      templates,
      contactsBySource,
      scheduledMessages,
      currentPage: 'bulk-sender'
    });
  } catch (err) {
    console.error('Error rendering bulk sender page:', err);
    res.status(500).send('Error rendering bulk sender page');
  }
});

// Route for Template Manager
router.get('/template-manager', isAuthenticated, async (req, res) => {
  const templates = await Template.findAll();
  res.render('templateManager', { templates });
});

// GET templates page
router.get('/templates', isAuthenticated, async (req, res) => {
  try {
    const templates = await Template.findAll();
    res.render('templateManager', { templates, currentPage: 'templates' });
  } catch (err) {
    res.status(500).send('Error fetching templates');
  }
});

// Add a new template
router.post('/templates/add', isAuthenticated, async (req, res) => {
  const { templateName, templateContent } = req.body;
  try {
    await Template.create({ templateName, templateContent });
    res.redirect('/templates');
  } catch (error) {
    console.error('Error adding template:', error);
    res.status(500).send('Error adding template');
  }
});

// Edit a template
router.post('/templates/edit', isAuthenticated, async (req, res) => {
  const { id, templateName, templateContent } = req.body;
  try {
    await Template.update({ templateName, templateContent }, { where: { id } });
    res.redirect('/templates');
  } catch (error) {
    console.error('Error editing template:', error);
    res.status(500).send('Error editing template');
  }
});

// Delete a template
router.post('/templates/delete/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    await Template.destroy({ where: { id } });
    res.redirect('/templates');
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).send('Error deleting template');
  }
});

// Delete multiple templates
router.post('/templates/delete-multiple', isAuthenticated, async (req, res) => {
  const { ids } = req.body; // Expecting an array of IDs
  if (ids && ids.length > 0) {
    await Template.destroy({ where: { id: ids } });
  } else {
    // Handle case where no templates are selected
    req.flash('error', 'Please select templates to delete.');
  }
  res.redirect('/templates');
});

// Add this route
router.get('/bulk-sender/messages', isAuthenticated, async (req, res) => {
  try {
    const messages = await ScheduledMessage.findAll({
      order: [['scheduledTime', 'ASC']]
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

// Update the existing route
router.post('/bulk-sender/send', isAuthenticated, bulkSender.scheduleBulkMessages);

// GET new template page - redirects to templates with a flag to show the add form
router.get('/templates/new', isAuthenticated, async (req, res) => {
  try {
    const templates = await Template.findAll();
    res.render('templateManager', { 
      templates, 
      showAddForm: true, 
      currentPage: 'templates' 
    });
  } catch (err) {
    res.status(500).send('Error loading template manager');
  }
});

// GET contacts upload page
router.get('/contacts/upload', isAuthenticated, async (req, res) => {
  try {
    res.render('contactUpload', { currentPage: 'contacts' });
  } catch (err) {
    console.error('Error loading upload page:', err);
    res.status(500).send('Error loading upload page');
  }
});

// Debug endpoint to generate a new QR code (only for development)
router.get('/debug/refresh-qr-code', isAuthenticated, async (req, res) => {
  try {
    // Force the client to refresh the QR code
    const client = require('../utils/whatsappClient');
    
    // Reset the database entry to trigger a new QR code
    await QRCode.destroy({ where: { id: 1 } });
    
    // Restart the client
    try {
      await client.destroy();
      client.initialize();
    } catch (err) {
      console.error('Error restarting client:', err);
    }
    
    res.json({ 
      message: 'QR code refresh initiated. Wait a few seconds and refresh the WhatsApp status page.'
    });
  } catch (err) {
    console.error('Error in debug endpoint:', err);
    res.status(500).json({ error: 'Error refreshing QR code' });
  }
});

// POST send message now
router.post('/messages/send', isAuthenticated, async (req, res) => {
  try {
    const { templateId, contactId } = req.body;
    
    // Validate input
    if (!templateId || !contactId) {
      return res.status(400).json({ success: false, error: 'Template ID and Contact ID are required' });
    }
    
    // Check WhatsApp connection
    const whatsappClient = require('../utils/whatsappClient');
    if (!whatsappClient.isConnected()) {
      return res.status(400).json({ success: false, error: 'WhatsApp is not connected' });
    }
    
    // Create and send the message
    const message = await ScheduledMessage.create({
      templateId,
      contactId,
      status: 'pending',
      scheduledTime: new Date()
    });
    
    // Trigger immediate sending
    await bulkSender.sendMessage(message);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST schedule message
router.post('/messages/schedule', isAuthenticated, async (req, res) => {
  try {
    const { templateId, contactId, scheduledTime } = req.body;
    
    // Validate input
    if (!templateId || !contactId || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Template ID, Contact ID, and Scheduled Time are required' });
    }
    
    // Create scheduled message
    await ScheduledMessage.create({
      templateId,
      contactId,
      status: 'scheduled',
      scheduledTime: new Date(scheduledTime)
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error scheduling message:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
