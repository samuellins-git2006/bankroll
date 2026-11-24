// ============================================================
// SERVIDOR MULTIPLAYER — Express + socket.io
// Hospedagem alvo: Render. Também serve o cliente (permite jogar
// direto pela URL do Render, além do cliente na Vercel).
// ============================================================

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

// cliente embutido (opcional: jogar direto pela URL do Render)
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: manager.rooms.size, uptime: process.uptime() });
});

const manager = new RoomManager(io);
globalThis.__roomManager = manager; // usado pela limpeza automática

io.on('connection', (socket) => {
  socket.data.token = socket.handshake.auth?.token || null;
  socket.data.code = null;

  socket.on('room:create', ({ name } = {}) => {
    if (!socket.data.token) return socket.emit('room:error', { message: 'Token ausente. Recarregue a página.' });
    manager.create(socket, String(name || 'Anfitrião'));
  });

  socket.on('room:join', ({ code, name } = {}) => {
    const room = manager.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return socket.emit('room:error', { message: 'Sala não encontrada. Confira o código.' });
    room.join(socket, String(name || 'Jogador'));
  });

  socket.on('room:config', (cfg) => {
    const room = manager.bySocket(socket);
    if (room) room.setConfig(cfg || {}, socket.data.token);
  });

  socket.on('room:addBot', () => {
    const room = manager.bySocket(socket);
    if (room) room.addBot(socket.data.token);
  });

  socket.on('room:removeSeat', ({ index } = {}) => {
    const room = manager.bySocket(socket);
    if (room) room.removeSeat(socket.data.token, index);
  });

  socket.on('room:start', () => {
    const room = manager.bySocket(socket);
    if (room) room.start(socket.data.token);
  });

  socket.on('room:reset', () => {
    const room = manager.bySocket(socket);
    if (room) room.reset(socket.data.token);
  });

  socket.on('room:leave', () => manager.leave(socket));

  socket.on('game:action', (action) => {
    const room = manager.bySocket(socket);
    if (room) room.handleAction(socket.data.token, action);
  });

  socket.on('disconnect', () => manager.disconnect(socket));
});

httpServer.listen(PORT, () => {
  console.log(`✅ Servidor Bankroll em http://localhost:${PORT} (salas ativas: ${manager.rooms.size})`);
});
