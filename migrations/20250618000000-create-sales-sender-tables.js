'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create SalesSenderSettings table
    await queryInterface.createTable('SalesSenderSettings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      initialMessageTemplate: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'Hello {name} {surname}, thank you for your purchase!'
      },
      followupMessageTemplate: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'Hello {name} {surname}, we hope you enjoyed your purchase! Would you like to visit us again?'
      },
      initialMessageDelay: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 2 // 2 hours
      },
      followupMessageDelay: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 6 // 6 months
      },
      autoSend: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Create SalesSenderMessage table
    await queryInterface.createTable('SalesSenderMessages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      salesId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      customerName: {
        type: Sequelize.STRING,
        allowNull: true
      },
      customerSurname: {
        type: Sequelize.STRING,
        allowNull: true
      },
      phoneNumber: {
        type: Sequelize.STRING,
        allowNull: false
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      isFollowup: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'sent', 'failed'),
        defaultValue: 'pending'
      },
      scheduledTime: {
        type: Sequelize.DATE,
        allowNull: false
      },
      sentTime: {
        type: Sequelize.DATE,
        allowNull: true
      },
      retryCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      lastError: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      saleDetails: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes for better performance
    await queryInterface.addIndex('SalesSenderMessages', ['status', 'scheduledTime']);
    await queryInterface.addIndex('SalesSenderMessages', ['isFollowup']);
    await queryInterface.addIndex('SalesSenderMessages', ['salesId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('SalesSenderMessages');
    await queryInterface.dropTable('SalesSenderSettings');
  }
}; 