const { Contact } = require('../models');

async function getContactsGroupedBySource() {
  try {
    const contacts = await Contact.findAll({
      attributes: ['id', 'name', 'surname', 'phoneNumber', 'source']
    });

    // Convert Sequelize instances to plain objects
    const plainContacts = contacts.map(contact => contact.get({ plain: true }));

    // Group contacts by source
    const contactsBySource = plainContacts.reduce((acc, contact) => {
      if (!acc[contact.source]) {
        acc[contact.source] = [];
      }
      acc[contact.source].push(contact);
      return acc;
    }, {});

    return contactsBySource;
  } catch (error) {
    console.error('Error fetching contacts:', error);
    throw error;
  }
}

module.exports = { getContactsGroupedBySource };
