'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add retryCount
    await queryInterface.addColumn('ScheduledMessages', 'retryCount', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });
    
    // Add lastError for tracking failure reasons
    await queryInterface.addColumn('ScheduledMessages', 'lastError', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    
    // Add batchId for grouping messages
    await queryInterface.addColumn('ScheduledMessages', 'batchId', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('ScheduledMessages', 'retryCount');
    await queryInterface.removeColumn('ScheduledMessages', 'lastError');
    await queryInterface.removeColumn('ScheduledMessages', 'batchId');
  }
}; 