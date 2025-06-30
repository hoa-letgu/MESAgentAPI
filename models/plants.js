// src/models/MesReport.js
const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Plants = sequelize.define('Plants', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true
  },
  plantCode: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  plantName: {
    type: DataTypes.JSON,
    allowNull: false
  }
}, {
  tableName: 'plants', // tên bảng cố định
  underscored: true         // cột => snake_case
});

module.exports = Plants;
