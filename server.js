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

// -----------------------------------------------------------------------------
// Constants & helpers
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 6677;
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
app.post('/addLines2', async (req, res) => {
  const { plant_id, line, ip } = req.body;
  const line_code = line;
  const line_name = line;
  if (!line || !ip) {
    return res.status(400).json({ error: 'Thiếu factory, line hoặc ip' });
  }


  try {
    const existing = await Lines.findOne({
      where: { plant_id, line_code, ip }
    });

    if (existing) {
      return res.status(200).json({ message: 'Dữ liệu đã tồn tại', exists: true });
    }

    const added = await Lines.create({ plant_id, line_code, line_name, ip });
    res.status(201).json({ message: 'Đã thêm thành công', data: added, exists: false });

  } catch (err) {
    console.error('Lỗi khi thêm line:', err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

app.post('/addLines', async (req, res) => {
  let { plant_id, line, ip } = req.body;
  plant_id = plant_id?.toString().toUpperCase() || '';
  line = line?.toString().toUpperCase() || '';
  ip = ip?.toString().toUpperCase() || '';

  if (!plant_id || !line || !ip) {
    return res.status(400).json({ error: 'Thiếu factory, line hoặc ip' });
  }
  const prefixes = ['4001', '4002', '4003', '4004', '4005', '4011', '4021', '4031'];
  // Tách line_code từ line (giả định bắt đầu bằng số)
  let line_code = line;
  for (const prefix of prefixes) {
    if (line.startsWith(prefix)) {
      line_code = line.slice(prefix.length); // cắt phần sau prefix
      break;
    }
  }
  const line_name = line;
  try {
    const existing = await Lines.findOne({
      where: { plant_id, line_code, line_name, ip }
    });

    if (existing) {
      return res.status(200).json({ message: 'NO', exists: true });
    }

    const added = await Lines.create({ plant_id, line_code, line_name, ip });
    res.status(201).json({ message: 'OK', data: added, exists: false });

  } catch (err) {
    console.error('Lỗi khi thêm line:', err);
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

//------------------------------------------------------------------
// Save Report
//------------------------------------------------------------------
async function saveToDB(report) {
  try {
    const detailTitles = Array.isArray(report.detailProgress)
      ? report.detailProgress.map((i) => i.title).join(' | ')
      : report.detailProgress;

    const values = {
      user: report.info.user,
      ip: report.info.ip,
      numMES: report.numMES,
      detailProgress: detailTitles,
      dateProgress: report.dateProgress,
    };

    const [agent, created] = await Agents.findOrCreate({ where: { ip: values.ip }, defaults: values });
    if (!created) await agent.update(values);

  } catch (err) {
    console.error('❌ Sequelize error:', err.message || err);
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
    console.error('❌ Query lỗi:', err);
    res.status(500).json({ message: 'Lỗi truy vấn' });
  }
});

//------------------------------------------------------------------
// Force all agents to emit report
//------------------------------------------------------------------
app.get('/api/force-all', (_req, res) => {
  io.emit('ping-client', 'force-report');
  res.send('📡 Đã gửi force-report tới tất cả agents');
});

//------------------------------------------------------------------
// Socket.IO – realtime
//------------------------------------------------------------------
let online = 0;
let pollId = null;

io.on('connection', (socket) => {
  online += 1;
  console.log('🔌 Client connected', socket.id, '| online:', online);

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
    console.log('⏱️  Started polling plants every', POLL_MS, 'ms');
  }

  // ── Receive single report from agent
  socket.on('mes-report', async (data) => {
    try {
      await saveToDB(data);
      io.emit('mes-report', data);      // broadcast raw report if UI cần
    } catch (err) {
      console.error('❌ handle mes-report error:', err);
    }
  });

  // ── Disconnect
  socket.on('disconnect', () => {
    online -= 1;
    console.log('🔌 Client disconnected', socket.id, '| online:', online);
    if (online === 0 && pollId) {
      clearInterval(pollId);
      pollId = null;
      console.log('🛑  Stopped polling (no clients)');
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
    server.listen(PORT, () => console.log(`🚀 MES Agent server @ http://localhost:${PORT}`));
  } catch (err) {
    console.error('❌ Cannot connect DB:', err);
    process.exit(1);
  }
})();
