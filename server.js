const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);

// Khởi tạo Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
app.use(cors());
app.use(express.json());

let mesReports = [];

app.post('/api/mes-agent-report', (req, res) => {
  const data = req.body;
  console.log('📨 Nhận HTTP report:', data);

  mesReports.push(data);
  io.emit('mes-report', data);

  res.status(200).send({ message: 'Đã nhận qua HTTP' });
});

io.on('connection', (socket) => {
  //console.log(`Agent socket connected: ${socket.id}`);

  socket.on('mes-report', (data) => {
    console.log('📡 Nhận Socket report:', data);

    mesReports.push(data);
    io.emit('mes-report', data);
  });

  socket.on('disconnect', () => {
    //console.log(`Socket disconnected: ${socket.id}`);
  });
});

app.get('/api/mes-agent-report', (req, res) => {
  res.json(mesReports);
});

app.get('/api/force-all', (req, res) => {
  io.emit('ping-client', 'force-report');
  res.send('📡 Đã gửi force-report tới tất cả agents');
});

server.listen(3000, () => {
  console.log('🚀 Server MES Agent đang chạy tại http://localhost:3000');
});
