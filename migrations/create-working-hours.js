'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('WorkingHours', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      openTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '10:00'
      },
      closeTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '20:00'
      },
      timezone: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'Europe/Tirane'
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('WorkingHours');
  }
};