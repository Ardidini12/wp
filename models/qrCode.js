'use strict';
module.exports = (sequelize, DataTypes) => {
  const QRCode = sequelize.define('QRCode', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    qrCodeUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('disconnected', 'active', 'connected', 'error'),
      defaultValue: 'disconnected',
      allowNull: false
    },
    connected: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'QRCodes',
    timestamps: true
  });

  // Define any associations here if needed
  QRCode.associate = function(models) {
    // associations can be defined here
  };

  return QRCode;
};
