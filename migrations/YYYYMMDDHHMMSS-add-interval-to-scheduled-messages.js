'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScheduledMessages', 'interval', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 45000 // Default to 45 seconds in milliseconds
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('ScheduledMessages', 'interval');
  }
}; 