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
      type: DataTypes.STRING,
      defaultValue: 'active',
      allowNull: true
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
