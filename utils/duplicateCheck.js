function checkDuplicate(phoneNumber) {
  fetch('/contacts') // Assuming this endpoint returns all contacts
    .then(response => response.json())
    .then(contacts => {
      const isDuplicate = contacts.some(contact => contact.phoneNumber === phoneNumber);
      const warning = document.getElementById('duplicateWarning');
      if (isDuplicate) {
        warning.style.display = 'block';
      } else {
        warning.style.display = 'none';
      }
    })
    .catch(error => console.error('Error checking duplicates:', error));
}
