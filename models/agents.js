// src/models/MesReport.js
const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const Agents = sequelize.define('Agents', {
    id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
    },
    user: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Tên người dùng'
    },
    ip: {
        type: DataTypes.STRING(45),
        allowNull: false,
        unique: true,
        comment: 'Địa chỉ IP'
    },
    numMES: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Số lượng báo cáo MES'
    },
    detailProgress: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Chi tiết tiến độ (danh sách các báo cáo con)'
    },
    dateProgress: {
        type: DataTypes.STRING(150),
        allowNull: true,
        comment: 'Thời gian tiến độ'
    },
    userCodeMes: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Ghi chú thông tin user MES',
    }
}, {
    tableName: 'agents',
    underscored: true,
});

module.exports = Agents;
