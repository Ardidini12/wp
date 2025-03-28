module.exports = (sequelize, DataTypes) => {
  const Template = sequelize.define('Template', {
    templateName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    templateContent: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  });

  return Template;
};
