'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Contact extends Model {
    static associate(models) {
      // define association here if needed
    }
  }
  Contact.init({
    name: DataTypes.STRING,
    surname: DataTypes.STRING,
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    email: DataTypes.STRING,
    birthday: DataTypes.DATE,
    source: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Contact',
  });
  return Contact;
};
