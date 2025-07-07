// server.js – Realtime MES Agent Server (Node.js + Express + Socket.IO + Sequelize)
// ---------------------------------------------------------------
// 2025-07-01 – Refactored: dynamic plant queries, polling broadcast,
// single connection listener, cron reset 20:00, dotenv config, etc.
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const cron = require('node-cron');
const dayjs = require('dayjs');

const sequelize = require('./db');
const Agents = require('./models/agents');
const Plants = require('./models/plants');
const Lines = require('./models/line');
const { Sequelize } = require('sequelize');   // ✅ Class để dùng Sequelize.Op

// -----------------------------------------------------------------------------
// Constants & helpers
// -----------------------------------------------------------------------------
const PORT = 6677;
const POLL_MS = Number(process.env.PLANT_POLL_MS) || 5_000;   // 5s default
const TZ = 'Asia/Ho_Chi_Minh';
const PLANTS = [
  'Plant A',
  'Plant C',
  'Plant D',
  'Plant E',
  'Plant F',
  'Office',
  'Plant I',
  'Plant N',
  'Plant O 1F',
  'Plant O 2F',
  'Plant P',
  'Plant Q'
];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const path = require('path');
const AGENT_CODE_DIR = path.join(__dirname, 'agent-code');
app.use(cors());
app.use(express.json());
app.use('/download', express.static(AGENT_CODE_DIR));
app.get('/update', (req, res) => {
  const zipPath = path.join(__dirname, 'agent-code', 'update.zip');
  res.download(zipPath);
});
app.get('/update_src', (req, res) => {
  const zipPath = path.join(__dirname, 'agent-code', 'update_src.zip');
  res.download(zipPath);
});
app.get('/t', (req, res) => {
  const zipPath = path.join(__dirname, 'agent-code', 'tool.zip');
  res.download(zipPath);
});
app.get('/restart', (req, res) => {
  io.emit('restart');
  res.send('Gửi lệnh restart đến tất cả clients');
});
app.post('/addLines2', async (req, res) => {
  const { plant_id, line, ip } = req.body;
  const line_code = line;
  const line_name = line;

  if (!line || !ip) {
    return res.status(400).json({ error: 'NO' });
  }

  try {
    // Tìm theo IP
    const existing = await Lines.findOne({ where: { ip } });

    if (existing) {
      // Nếu có → cập nhật lại dữ liệu
      await existing.update({ plant_id, line_code, line_name });
      return res.status(200).json({ message: 'OK', updated: true, data: existing });
    }

    // Nếu không có → thêm mới
    const added = await Lines.create({ plant_id, line_code, line_name, ip });
    res.status(201).json({ message: 'OK', added: true, data: added });

  } catch (err) {
    console.error('Lỗi khi thêm/cập nhật line:', err);
    res.status(500).json({ error: 'NO' });
  }
});


app.post('/addLines', async (req, res) => {
  let { plant_id, line, ip } = req.body;
  plant_id = plant_id?.toString().toUpperCase() || '';
  line = line?.toString().toUpperCase() || '';
  ip = ip?.toString().toUpperCase() || '';

  if (!plant_id || !line || !ip) {
    return res.status(400).json({ error: 'NO' });
  }

  const prefixes = ['4001', '4002', '4003', '4004', '4005', '4011', '4021', '4031'];

  // Tách line_code từ line (nếu có prefix)
  let line_code = line;
  for (const prefix of prefixes) {
    if (line.startsWith(prefix)) {
      line_code = line.slice(prefix.length);
      break;
    }
  }

  const line_name = line;

  try {
    const existing = await Lines.findOne({ where: { ip } });

    if (existing) {
      // Nếu tồn tại → cập nhật thông tin mới
      await existing.update({ plant_id, line_code, line_name });
      return res.status(200).json({ message: 'OK', data: existing, updated: true });
    }

    // Nếu không tồn tại → tạo mới
    const added = await Lines.create({ plant_id, line_code, line_name, ip });
    res.status(201).json({ message: 'OK', data: added, updated: false });

  } catch (err) {
    console.error('Lỗi khi thêm/cập nhật line:', err);
    res.status(500).json({ error: 'NO!' });
  }
});



//------------------------------------------------------------------
// Utils
//------------------------------------------------------------------
function sqlForPlant(plantName) {
  return `SELECT
            c.plant_name,
            b.line_name,
            a.\`user\`,
            b.ip,
            a.num_m_e_s,
            a.detail_progress,
            a.date_progress
          FROM agents  AS a
          LEFT JOIN \`lines\`  AS b ON b.ip = a.ip
          LEFT JOIN plants     AS c ON c.plant_code = b.plant_id
          WHERE c.plant_name = :plantName`;
}

async function fetchPlant(plantName) {
  const [rows] = await sequelize.query(sqlForPlant(plantName), { replacements: { plantName } });
  return rows;
}
function getSocketIdFromIP(ip) {
  for (const [socketId, clientIP] of Object.entries(clientMap)) {
    if (clientIP === ip) {
      return socketId;
    }
  }
  return null;
}
//------------------------------------------------------------------
// Save Report
//------------------------------------------------------------------
async function saveToDB(report) {
  try {
    const detailTitles = Array.isArray(report.detailProgress)
      ? report.detailProgress.map((i) => i.title).join(' | ')
      : report.detailProgress;

    const values = {
      user: report.info.user?.trim() || '',
      ip: report.info.ip?.trim() || '',
      userCodeMes: report.info.usercode?.trim() || '',
      numMES: Number(report.numMES) || 0,
      detailProgress: detailTitles?.trim() || '',
      dateProgress: report.dateProgress?.trim() || '',
    };
    await Agents.upsert(values);

  } catch (err) {
    console.error('Sequelize error (upsert):', err.message || err);
  }
}
//------------------------------------------------------------------
// REST API – dynamic query by ?plant=
//------------------------------------------------------------------
app.get('/api/mes-agent-report', async (req, res) => {
  const plant = req.query.plant;
  if (!plant) return res.status(400).json({ message: 'Thiếu tham số plant' });
  try {
    const rows = await fetchPlant(plant);
    res.json(rows);
  } catch (err) {
    console.error('Query lỗi:', err);
    res.status(500).json({ message: 'Lỗi truy vấn' });
  }
});

//------------------------------------------------------------------
// Force all agents to emit report
//------------------------------------------------------------------
app.get('/api/force-all', (_req, res) => {
  io.emit('ping-client', 'force-report');
  res.send('Đã gửi force-report tới tất cả agents');
});

//------------------------------------------------------------------
// Socket.IO – realtime
//------------------------------------------------------------------
let online = 0;
let pollId = null;
const clientMap = {};
io.on('connection', (socket) => {
  online += 1;
  console.log('Client connected', socket.id, '| online:', online);

  // ── Send snapshot for each plant to newly‑connected client
  PLANTS.forEach(async (p) => {
    try {
      const rows = await fetchPlant(p);
      socket.emit(`data:${p}`, rows);
    } catch (e) { console.error('fetchPlant first load', p, e); }
  });

  // ── Start polling when first client arrives
  if (!pollId) {
    pollId = setInterval(async () => {
      try {
        await Promise.all(
          PLANTS.map(async (p) => {
            const rows = await fetchPlant(p);
            io.emit(`data:${p}`, rows);
          })
        );
      } catch (e) { console.error('poll error', e); }
    }, POLL_MS);
    console.log('Started polling plants every', POLL_MS, 'ms');
  }

  // ── Receive single report from agent
  socket.on('mes-report', async (data) => {
    try {
      //console.log(data)
      const ip = data?.info?.ip || 'unknown';
      clientMap[socket.id] = ip;
      await saveToDB(data);
      io.emit('mes-report', data);      // broadcast raw report if UI cần
    } catch (err) {
      console.error('handle mes-report error:', err);
    }
  });
  socket.on('restarted', (data) => {
    const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`MÁY ĐÃ RESTART: [${data.ip}] - user: ${data.user}, usercode: ${data.usercode} @ ${time}`);
  });
  socket.on("screenshot", (data) => {
    //console.log(`Nhận ảnh từ ${data.machine}`);
    io.emit("update-image", data); // gửi cho tất cả client 
  });
  socket.on("request-capture", async (data) => {
    const value = data.ipOrLine?.trim();
    if (!value) {
      //console.log("❌ Không có giá trị ipOrLine gửi lên.");
      return;
    }

    try {
      // Tìm trong bảng Lines theo IP hoặc line_code hoặc line_name
      const line = await Lines.findOne({
        where: {
          [Sequelize.Op.or]: [
            { ip: value },
            { line_code: value },
            { line_name: value }
          ]
        }
      });


      if (!line) {
        console.log("❌ Không tìm thấy dòng tương ứng với:", value);
        return;
      }

      const ip = line.ip;
      //console.log("Tìm thấy dòng:", ip);
      //console.log("clientMap:", clientMap);
      const targetSocketId = getSocketIdFromIP(ip);

      if (!targetSocketId) {
        console.log("❌ Không tìm thấy socket đang online với IP:", ip);
        return;
      }

      // Gửi yêu cầu capture đến máy client cụ thể
      io.to(targetSocketId).emit("capture-now");
      //console.log(`✅ Đã gửi 'capture-now' đến ${ip} (socketId: ${targetSocketId})`);

    } catch (error) {
      console.error("🔥 Lỗi truy vấn Line:", error);
    }
  });
  // ── Disconnect
  socket.on('disconnect', async () => {
    online -= 1;

    const ip = clientMap[socket.id] || 'Unknown';
    console.log('Client disconnected', socket.id, '| IP:', ip, '| online:', online);

    if (ip && ip !== 'Unknown') {
      const values = {
        ip: ip,
        numMES: 0,
        detailProgress: '',
      };
      try {
        //await Agents.upsert(values);
        const [affected] = await Agents.update(
          { numMES: 0, detailProgress: '' },   // Dữ liệu cập nhật
          { where: { ip } }                    // Điều kiện WHERE
        );

      } catch (err) {
        console.error('❌ Lỗi khi upsert Agents:', err);
      }
    }

    delete clientMap[socket.id];

    if (online === 0 && pollId) {
      clearInterval(pollId);
      pollId = null;
      console.log('Stopped polling (no clients)');
    }
  });
});

//------------------------------------------------------------------
// Cron job – reset numMES = 0 lúc 20:00
//------------------------------------------------------------------
cron.schedule('0 20 * * *', async () => {
  try {
    const [affected] = await Agents.update({ numMES: 0 }, { where: {} });
    console.log(`🔄 [${dayjs().format('YYYY-MM-DD HH:mm:ss')}] Reset numMES = 0 cho ${affected} agent(s)`);
  } catch (err) {
    console.error('❌ Cron update lỗi:', err);
  }
}, { timezone: TZ });

//------------------------------------------------------------------
// Start server
//------------------------------------------------------------------
(async () => {
  try {
    await sequelize.sync();
    console.log('✅ MySQL synced');
    server.listen(PORT, () => console.log(`🚀 MES Agent server @ http://10.30.3.50:${PORT}`));
  } catch (err) {
    console.error('❌ Cannot connect DB:', err);
    process.exit(1);
  }
})();
