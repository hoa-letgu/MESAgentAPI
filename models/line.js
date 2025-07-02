// src/models/MesReport.js
const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Lines = sequelize.define('Lines', {
    id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
    },
    line_code: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    line_name: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    plant_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ip: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
}, {
    tableName: 'lines', // tên bảng cố định
    underscored: true         // cột => snake_case
});

module.exports = Lines;
