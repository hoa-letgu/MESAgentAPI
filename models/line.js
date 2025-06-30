// src/models/MesReport.js
const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Lines = sequelize.define('Lines', {
    id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
    },
    lineCode: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    lineName: {
        type: DataTypes.JSON,
        allowNull: false
    },
    plantId: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'lines', // tên bảng cố định
    underscored: true         // cột => snake_case
});

module.exports = Lines;
