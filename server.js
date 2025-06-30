const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const { Server } = require('socket.io');

const sequelize  = require('./db');
const Plants  = require('./models/plants');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

let mesReports = [];

/** Ghi DB qua Sequelize */
async function saveToDB(report) {
  try {
    await Plants.create({
      plantCode : report.plantCode  || 'unknown',
      plantName  : report.plantName || 'unknown'
    });
  } catch (err) {
    console.error('❌ Sequelize error:', err);
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
