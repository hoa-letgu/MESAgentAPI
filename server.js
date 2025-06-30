const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const sequelize = require('./db');
const Agents = require('./models/agents');
const Plants = require('./models/plants');
const Lines = require('./models/line');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

let mesReports = [];

async function saveToDB(report) {
  try {
    const detailTitles = Array.isArray(report.detailProgress)
      ? report.detailProgress.map(item => item.title).join(' | ')
      : report.detailProgress;

    // Chuyển định dạng ngày về chuẩn MySQL
    const parsedDate = dayjs(report.dateProgress, 'DD/MM/YYYY hh:mm:ss A');
    if (!parsedDate.isValid()) {
      throw new Error('🛑 Ngày không hợp lệ: ' + report.dateProgress);
    }
    const formattedDate = parsedDate.format('YYYY-MM-DD HH:mm:ss');

    // Kiểm tra IP đã tồn tại chưa
    const existingAgent = await Agents.findOne({ where: { ip: report.info.ip } });

    if (existingAgent) {
      // Nếu có, update
      await existingAgent.update({
        user: report.info.user,
        numMES: report.numMES,
        detailProgress: detailTitles,
        dateProgress: formattedDate
      });
      console.log("🔄 Cập nhật thành công IP:", report.info.ip);
    } else {
      // Nếu chưa có, insert mới
      await Agents.create({
        user: report.info.user,
        ip: report.info.ip,
        numMES: report.numMES,
        detailProgress: detailTitles,
        dateProgress: formattedDate
      });
      console.log("✅ Thêm mới thành công IP:", report.info.ip);
    }
  } catch (err) {
    console.error('❌ Sequelize error:', err.message || err);
  }
}



/** API & Socket handler */
app.post('/api/mes-agent-report', async (req, res) => {
  const data = req.body;
  mesReports.push(data);
  io.emit('mes-report', data);
  saveToDB(data);                // không await -> tránh chặn event‑loop
  res.status(200).json({ message: 'Đã nhận qua HTTP' });
});

io.on('connection', (socket) => {
  socket.on('mes-report', (data) => {
    mesReports.push(data);
    io.emit('mes-report', data);
    saveToDB(data);
  });
});

app.get('/api/mes-agent-report', (req, res) => res.json(mesReports));

app.get('/api/force-all', (req, res) => {
  io.emit('ping-client', 'force-report');
  res.send('📡 Đã gửi force-report tới tất cả agents');
});

/** Khởi chạy */
(async () => {
  try {
    // Sync DB – tự tạo/alter bảng. Dùng { force:true } để drop & tạo lại mỗi lần DEV.
    await sequelize.sync({ alter: true });
    console.log('✅ MySQL synced');

    server.listen(3000, () => {
      console.log('🚀 Server MES Agent chạy tại http://localhost:3000');
    });
  } catch (e) {
    console.error('❌ Không kết nối được MySQL:', e);
    process.exit(1);
  }
})();
