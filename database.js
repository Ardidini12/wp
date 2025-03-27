const { Sequelize } = require('sequelize');

// Create a new Sequelize instance
const sequelize = new Sequelize('bsssender', 'root', 'root123', {
  host: '127.0.0.1',
  dialect: 'mysql',
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});


module.exports = sequelize;