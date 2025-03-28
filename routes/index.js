var express = require('express');
var router = express.Router();
var { User } = require('../models'); // Import the User model
var bcrypt = require('bcrypt');
var { Contact } = require('../models'); // Import the Contact model
var { QRCode } = require('../models'); // Import the QRCode model
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
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
    const contacts = await Contact.findAll();
    res.render('contact', { contacts, currentPage: 'contacts' });
  } catch (err) {
    res.status(500).send('Error fetching contacts');
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

  let contacts = [];
  const fileType = file.mimetype;
  const originalFilename = file.originalname; // Store the original filename

  try {
    if (fileType.includes('csv')) {
      // Parse CSV
      const results = [];
      fs.createReadStream(file.path)
        .pipe(csvParser())
        .on('data', (data) => results.push(data))
        .on('end', () => {
          contacts = parseContacts(results);
          console.log('Parsed Contacts:', contacts);
          res.render('preview', { contacts, filePath: file.path, originalFilename });
        });
    } else if (fileType.includes('json')) {
      // Parse JSON
      contacts = parseContacts(jsonfile.readFileSync(file.path));
      console.log('Parsed Contacts:', contacts);
      res.render('preview', { contacts, filePath: file.path, originalFilename });
    } else if (fileType.includes('spreadsheetml')) {
      // Parse Excel
      const workbook = xlsx.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      contacts = parseContacts(xlsx.utils.sheet_to_json(sheet));
      console.log('Parsed Contacts:', contacts);
      res.render('preview', { contacts, filePath: file.path, originalFilename });
    } else {
      return res.status(400).send('Unsupported file type');
    }
  } catch (err) {
    console.error('Error processing file:', err);
    res.status(500).send('Error processing file');
  }
});

// POST confirm import
router.post('/contacts/confirm-import', async (req, res) => {
  let contacts;
  try {
    // Parse contacts from the hidden input field
    contacts = JSON.parse(req.body.contacts);
  } catch (err) {
    console.error('Error parsing contacts:', err);
    return res.status(400).send('Invalid contacts data');
  }

  if (!Array.isArray(contacts)) {
    return res.status(400).send('Contacts data is not an array');
  }

  const fileName = req.body.fileName || 'unknown file'; // Get filename from form

  try {
    for (const contact of contacts) {
      await Contact.create({
        name: contact.name,
        surname: contact.surname,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
        birthday: contact.birthday,
        source: `imported from "${fileName}"`
      });
    }
    res.redirect('/contacts');
  } catch (err) {
    console.error('Error importing contacts:', err);
    res.status(500).send('Error importing contacts');
  }
});

// POST cancel import
router.post('/contacts/cancel-import', (req, res) => {
  const filePath = req.body.filePath; // Assume the file path is sent in the request body
  if (filePath) {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
      }
      res.redirect('/contacts');
    });
  } else {
    res.redirect('/contacts');
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
    await Contact.destroy({ where: { id: ids } });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting contacts:', err);
    res.status(500).json({ success: false });
  }
});

// Export contacts as JSON
router.get('/contacts/export/json', isAuthenticated, async (req, res) => {
  try {
    const contacts = await Contact.findAll();
    const jsonData = JSON.stringify(contacts.map(contact => contact.toJSON()), null, 2);
    res.header('Content-Type', 'application/json');
    res.attachment('contacts.json');
    res.send(jsonData);
  } catch (err) {
    console.error('Error exporting contacts as JSON:', err);
    res.status(500).send('Error exporting contacts');
  }
});

// Export contacts as CSV
router.get('/contacts/export/csv', isAuthenticated, async (req, res) => {
  try {
    const contacts = await Contact.findAll();
    const csv = json2csv(contacts.map(contact => contact.toJSON()));
    res.header('Content-Type', 'text/csv');
    res.attachment('contacts.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting contacts as CSV:', err);
    res.status(500).send('Error exporting contacts');
  }
});

// Export contacts as Excel
router.get('/contacts/export/excel', isAuthenticated, async (req, res) => {
  try {
    const contacts = await Contact.findAll();
    const worksheet = xlsx.utils.json_to_sheet(contacts.map(contact => contact.toJSON()));
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('contacts.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting contacts as Excel:', err);
    res.status(500).send('Error exporting contacts');
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

module.exports = router;
