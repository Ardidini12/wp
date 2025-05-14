module.exports = (sequelize, DataTypes) => {
  const SalesSenderMessage = sequelize.define('SalesSenderMessage', {
    salesId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    customerSurname: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    isFollowup: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed'),
      defaultValue: 'pending'
    },
    scheduledTime: {
      type: DataTypes.DATE,
      allowNull: false
    },
    sentTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    retryCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    saleDetails: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('saleDetails');
        return rawValue ? JSON.parse(rawValue) : {};
      },
      set(value) {
        this.setDataValue('saleDetails', JSON.stringify(value));
      }
    }
  }, {
    timestamps: true
  });

  return SalesSenderMessage;
}; 