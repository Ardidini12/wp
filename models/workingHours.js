'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class WorkingHours extends Model {
    static associate(models) {
      // Define associations if needed
    }
  }
  
  WorkingHours.init({
    openTime: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '10:00'
    },
    closeTime: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '20:00'
    },
    timezone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Europe/Tirane'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'WorkingHours',
  });
  
  return WorkingHours;
};