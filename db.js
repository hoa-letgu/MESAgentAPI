// src/db.js
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME     || 'aph_mes_monitor',
  process.env.DB_USER     || 'aph_mes',
  process.env.DB_PASSWORD || 'Aph.srv.pwd',
  {
    host   : process.env.DB_HOST || '10.30.1.191',
    dialect: 'mysql',
    logging: false,
    pool: { max: 5, min: 0, idle: 10000 }
  }
);

module.exports = sequelize;
