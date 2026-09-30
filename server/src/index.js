import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Shri Health Procurement Centre API' }));
app.use('/api', routes);

// Serve the built web app (npm run build) so the whole portal runs on one port
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.details });
  // Postgres constraint errors -> friendly messages
  if (err.code === '23505') return res.status(409).json({ error: `Already exists: ${err.detail || 'duplicate value'}` });
  if (err.code === '23503') return res.status(400).json({ error: 'This record is referenced elsewhere and cannot be changed that way' });
  if (err.code === '23514') return res.status(400).json({ error: 'Value out of allowed range (quantities and prices cannot be negative)' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid value supplied' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
const host = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = reachable from other computers on the network
const server = app.listen(port, host, () => {
  console.log(`Shri Health Procurement Centre running on http://localhost:${port}`);
  const lan = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
  for (const a of lan) console.log(`  On your network: http://${a.address}:${port}`);
});
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\nPort ${port} is already in use — the portal is probably already running in another terminal.`);
  console.error(`Open http://localhost:${port}, or stop the other one first:  kill $(lsof -ti tcp:${port})\n`);
  process.exit(1);
});
