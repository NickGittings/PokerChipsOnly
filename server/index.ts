import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room';
import { joinUrlCandidates } from './joinUrls';
const port = Number(process.env.PORT ?? 3000);
const clientPort = process.env.CLIENT_PORT ?? String(port);
const joinUrls = joinUrlCandidates(networkInterfaces(), clientPort, process.env.LAN_URL);
const room = new Room(joinUrls, process.env.STATE_FILE === ':memory:' ? null : process.env.STATE_FILE ?? '.state.json');
const app = express(), server = createServer(app);
app.get('/api/health', (_req, res) => res.json({ ok: true, joinUrl: room.joinUrl, joinUrls: room.joinUrls, phase: room.game.phase }));
const dist = resolve('dist');
if (existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html'))); }
else app.get('*', (_req, res) => res.send('Development client: open ' + room.joinUrl));
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const alive = new WeakSet<WebSocket>();
wss.on('connection', ws => {
  alive.add(ws); ws.on('pong', () => alive.add(ws));
  const joinTimeout = setTimeout(() => { if (!room.peers.has(ws)) ws.close(1008, 'Join timeout'); }, 10000);
  ws.on('message', data => { try { room.handle(ws, JSON.parse(data.toString())); } catch { room.send(ws, { type: 'error', message: 'Invalid JSON message.' }); } });
  ws.on('close', () => { clearTimeout(joinTimeout); room.disconnect(ws); }); ws.on('error', () => ws.close());
});
const tick = setInterval(() => room.tick(Date.now()), 1000);
const save = setInterval(() => room.safePersist(), 5000);
const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!alive.has(ws)) ws.terminate(); else { alive.delete(ws); ws.ping(); } } }, 15000);
server.listen(port, '0.0.0.0', () => { console.log(`\n  POKERCHIPS ONLY\n  Table: ${room.joinUrl}/board\n  Join:  ${room.joinUrl}\n  Local: http://localhost:${port}\n  Join candidates:\n${room.joinUrls.map(url => `    ${url}`).join('\n')}\n  Keep this terminal open on game night.\n`); });
function shutdown() { clearInterval(tick); clearInterval(save); clearInterval(heartbeat); room.safePersist(); wss.clients.forEach(ws => ws.close()); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
