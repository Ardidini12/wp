// models/salesImport.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SalesImport extends Model {
    static associate(models) {
      // Define associations if needed
    }
  }
  
  SalesImport.init({
    importDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'pending'
    },
    recordsImported: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    parameters: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('parameters');
        return rawValue ? JSON.parse(rawValue) : {};
      },
      set(value) {
        this.setDataValue('parameters', JSON.stringify(value));
      }
    },
    responseData: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'SalesImport',
  });
  
  return SalesImport;
};