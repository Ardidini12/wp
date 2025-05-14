module.exports = (sequelize, DataTypes) => {
  const SalesSenderSettings = sequelize.define('SalesSenderSettings', {
    initialMessageTemplate: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'Hello {name} {surname}, thank you for your purchase!'
    },
    followupMessageTemplate: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'Hello {name} {surname}, we hope you enjoyed your purchase! Would you like to visit us again?'
    },
    initialMessageDelay: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2, // Default 2 hours
    },
    followupMessageDelay: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 6, // Default 6 months
    },
    autoSend: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    timestamps: true
  });

  return SalesSenderSettings;
}; 