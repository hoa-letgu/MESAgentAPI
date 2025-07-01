// server.js – Realtime MES Agent Server (Node.js + Express + Socket.IO + Sequelize)
// ---------------------------------------------------------------
// 2025-07-01 – Refactored: dynamic plant queries, polling broadcast,
// single connection listener, cron reset 20:00, dotenv config, etc.
const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const { Server } = require('socket.io');
const cron     = require('node-cron');
const dayjs    = require('dayjs');

const sequelize = require('./db');
const Agents    = require('./models/agents');
const Plants    = require('./models/plants');
const Lines     = require('./models/line');

// -----------------------------------------------------------------------------
// Constants & helpers
// -----------------------------------------------------------------------------
const PORT        = process.env.PORT || 3000;
const POLL_MS     = Number(process.env.PLANT_POLL_MS) || 5_000;   // 5s default
const TZ          = 'Asia/Ho_Chi_Minh';
const PLANTS      = ['Plant A', 'Plant C', 'Plant D', 'Plant E', 'Plant F'];

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

//------------------------------------------------------------------
// Utils
//------------------------------------------------------------------
function sqlForPlant(plantName) {
  return `SELECT
            c.plant_name,
            b.line_name,
            a.\`user\`,
            a.ip,
            a.num_m_e_s,
            a.detail_progress,
            a.date_progress
          FROM agents  AS a
          LEFT JOIN \`lines\`  AS b ON b.line_code = a.line_id
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
      user:           report.info.user,
      ip:             report.info.ip,
      numMES:         report.numMES,
      detailProgress: detailTitles,
      dateProgress:   report.dateProgress,
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
