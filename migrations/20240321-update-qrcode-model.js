'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // First, update the status column to be ENUM
      await queryInterface.sequelize.query('ALTER TABLE QRCodes MODIFY COLUMN status ENUM("disconnected", "active", "connected", "error") NOT NULL DEFAULT "disconnected"');

      // Update all existing records to have consistent state
      await queryInterface.sequelize.query(`
        UPDATE QRCodes
        SET connected = CASE 
          WHEN status = 'connected' THEN 1 
          ELSE 0 
        END,
        status = CASE 
          WHEN status NOT IN ('disconnected', 'active', 'connected', 'error') 
          THEN 'disconnected' 
          ELSE status 
        END
        WHERE id = 1
      `);

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      // Revert status back to STRING
      await queryInterface.sequelize.query('ALTER TABLE QRCodes MODIFY COLUMN status VARCHAR(255) DEFAULT "active"');
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}; 