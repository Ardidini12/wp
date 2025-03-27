var express = require('express');
var router = express.Router();
var { User } = require('../models'); // Import the User model
var bcrypt = require('bcrypt');
var { Contact } = require('../models'); // Import the Contact model
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const csvParser = require('csv-parser');
const xlsx = require('xlsx');
const jsonfile = require('jsonfile');
const fs = require('fs');
const json2csv = require('json2csv').parse;

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
  const userId = req.session.userId;
  if (userId) {
    User.findByPk(userId).then(user => {
      res.render('index', { title: 'BSS Sender', user });
    }).catch(err => {
      res.render('index', { title: 'BSS Sender', user: null });
    });
  } else {
    res.render('index', { title: 'BSS Sender', user: null });
  }
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
router.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('dashboard');
});

// GET contacts page
router.get('/contacts', isAuthenticated, async (req, res) => {
  try {
    const contacts = await Contact.findAll();
    res.render('contact', { contacts });
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
    // Ensure phone_number exists and is a string before normalizing it
    if (contact.phone_number && typeof contact.phone_number === 'string') {
      // Remove any '+' sign and leading zeros
      contact.phoneNumber = contact.phone_number.replace(/^\+/, '').replace(/^0+/, '');
    } else {
      contact.phoneNumber = ''; // Assign a default value or handle as needed
    }

    // Convert birthday from DD/MM/YYYY to YYYY-MM-DD
    if (contact.birthday) {
      const [day, month, year] = contact.birthday.split('/');
      contact.birthday = new Date(`${year}-${month}-${day}`).toISOString().split('T')[0];
    } else {
      contact.birthday = null; // Handle missing birthday
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

  try {
    if (fileType.includes('csv')) {
      // Parse CSV
      const results = [];
      fs.createReadStream(file.path)
        .pipe(csvParser())
        .on('data', (data) => results.push(data))
        .on('end', () => {
          contacts = parseContacts(results);
          console.log('Parsed Contacts:', contacts); // Debugging
          res.render('preview', { contacts, filePath: file.path });
        });
    } else if (fileType.includes('json')) {
      // Parse JSON
      contacts = parseContacts(jsonfile.readFileSync(file.path));
      console.log('Parsed Contacts:', contacts); // Debugging
      res.render('preview', { contacts, filePath: file.path });
    } else if (fileType.includes('spreadsheetml')) {
      // Parse Excel
      const workbook = xlsx.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      contacts = parseContacts(xlsx.utils.sheet_to_json(sheet));
      console.log('Parsed Contacts:', contacts); // Debugging
      res.render('preview', { contacts, filePath: file.path });
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

  try {
    for (const contact of contacts) {
      await Contact.create({
        name: contact.name,
        surname: contact.surname,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
        birthday: contact.birthday,
        source: `imported from "${file.originalname}"`
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

module.exports = router;
