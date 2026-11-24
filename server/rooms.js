// ============================================================
// SALAS E PARTIDAS — uma Room por mesa. O servidor é a autoridade:
// aplica a engine e transmite o estado para todos os clientes.
// ============================================================

import { createGame, applyAction, cur } from '../shared/engine.js';
import { botAction, autoAction } from './bots.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

const BOT_DELAY = 800;      // bot "pensa" 800ms
const AFK_DELAY = 90000;    // humano conectado sem agir: 90s
const OFFLINE_DELAY = 45000; // jogador desconectado: 45s
const RETRY_DELAY = 1500;

export class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.playerCount = 4;
    this.engineCfg = { goal: 3000, maxRounds: 30 };
    this.seats = []; // {token, name, isBot, connected} | null
    this.hostToken = null;
    this.game = null;
    this.timer = null;
    this.cleanupTimer = null;
  }

  // ---------- assentos ----------
  seatIndexByToken(token) {
    return this.seats.findIndex((s) => s && s.token === token);
  }

  firstFreeSeat() {
    for (let i = 0; i < this.playerCount; i++) {
      if (!this.seats[i]) return i;
    }
    return -1;
  }

  // ---------- entrada/saída ----------
  join(socket, name) {
    const token = socket.data.token;
    if (!token) return this.error(socket, 'Token ausente. Recarregue a página.');

    // reconexão
    const known = this.seatIndexByToken(token);
    if (known >= 0) {
      this.seats[known].connected = true;
      socket.data.code = this.code;
      socket.join(this.code);
      this.sendAllTo(socket);
      this.broadcastRoom();
      return;
    }

    if (this.game) return this.error(socket, 'Partida em andamento. Aguarde a próxima.');

    const idx = this.firstFreeSeat();
    if (idx < 0) return this.error(socket, 'Sala cheia.');

    clearTimeout(this.cleanupTimer);
    this.seats[idx] = { token, name: name.slice(0, 14), isBot: false, connected: true };
    socket.data.code = this.code;
    socket.join(this.code);
    if (!this.hostToken) this.hostToken = token;
    socket.emit('room:joined', { code: this.code });
    this.sendAllTo(socket);
    this.broadcastRoom();
  }

  onLeave(socket, explicit = false) {
    const idx = this.seatIndexByToken(socket.data.token);
    if (idx < 0) return;

    if (explicit && !this.game) {
      this.seats[idx] = null;
      if (this.hostToken === socket.data.token) {
        const next = this.seats.find((s) => s && !s.isBot);
        this.hostToken = next ? next.token : null;
      }
      socket.data.code = null;
    } else {
      this.seats[idx].connected = false;
    }

    this.broadcastRoom();
    if (this.game) {
      this.broadcastGame([]); // estado pode depender de connected (timers)
      this.scheduleTick();
    }
    this.maybeCleanup();
  }

  maybeCleanup() {
    const anyConnected = this.seats.some((s) => s && !s.isBot && s.connected);
    if (anyConnected) return;
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => {
      const still = this.seats.some((s) => s && !s.isBot && s.connected);
      if (!still) managerRemove(this.code);
    }, 60000);
  }

  // ---------- configuração (anfitrião) ----------
  setConfig(cfg, token) {
    if (token !== this.hostToken || this.game) return;
    if ([2, 3, 4].includes(cfg.playerCount)) {
      const occupied = this.seats.filter(Boolean).length;
      if (cfg.playerCount < occupied) return;
      this.playerCount = cfg.playerCount;
      this.seats.length = Math.max(this.seats.length, cfg.playerCount);
    }
    if ([3000, 5000, 7000].includes(cfg.goal)) this.engineCfg.goal = cfg.goal;
    if ([0, 30, 50].includes(cfg.rounds)) this.engineCfg.maxRounds = cfg.rounds;
    this.broadcastRoom();
  }

  addBot(token) {
    if (token !== this.hostToken || this.game) return;
    const idx = this.firstFreeSeat();
    if (idx < 0) return;
    this.seats[idx] = { token: 'bot-' + this.code + '-' + idx, name: 'Bot ' + (idx + 1), isBot: true, connected: true };
    this.broadcastRoom();
  }

  removeSeat(token, index) {
    if (token !== this.hostToken || this.game) return;
    const seat = this.seats[index];
    if (seat && seat.isBot) {
      this.seats[index] = null;
      this.broadcastRoom();
    }
  }

  // ---------- partida ----------
  start(token) {
    if (token !== this.hostToken) return;
    if (this.game) return;

    // preenche vagas com bots
    for (let i = 0; i < this.playerCount; i++) {
      if (!this.seats[i]) {
        this.seats[i] = { token: 'bot-' + this.code + '-' + i, name: 'Bot ' + (i + 1), isBot: true, connected: true };
      }
    }
    this.seats = this.seats.slice(0, this.playerCount);
    if (this.seats.filter(Boolean).length < 2) return;

    this.game = createGame(this.engineCfg, this.seats.map((s) => ({ name: s.name })));
    this.broadcastRoom();
    this.broadcastGame([{ type: 'start' }]);
    this.scheduleTick();
  }

  reset(token) {
    if (token !== this.hostToken) return;
    clearTimeout(this.timer);
    this.game = null;
    this.broadcastRoom();
  }

  handleAction(token, action) {
    const idx = this.seatIndexByToken(token);
    if (idx < 0 || !this.game) return this.errorTo(token, 'Você não está numa partida.');

    const res = applyAction(this.game, 'p' + idx, action);
    if (!res.ok) return this.errorTo(token, res.error);

    this.game = res.state;
    this.broadcastGame(res.events);
    this.scheduleTick();
  }

  // ---------- motor de turnos (bots + afk) ----------
  scheduleTick() {
    clearTimeout(this.timer);
    if (!this.game || this.game.over) return;

    const idx = this.game.turnIdx;
    const seat = this.seats[idx];
    if (!seat) return;

    if (seat.isBot) {
      this.timer = setTimeout(() => this.stepBot(), BOT_DELAY);
    } else {
      this.timer = setTimeout(() => this.stepAuto(), seat.connected ? AFK_DELAY : OFFLINE_DELAY);
    }
  }

  stepBot() {
    if (!this.game || this.game.over) return;
    const a = botAction(this.game);
    if (!a) {
      this.timer = setTimeout(() => this.stepBot(), RETRY_DELAY);
      return;
    }
    this.applySystem(a);
  }

  stepAuto() {
    if (!this.game || this.game.over) return;
    const a = autoAction(this.game);
    if (a) {
      this.game.log.push(`⏱ Tempo esgotado — ação automática para ${cur(this.game).name}.`);
    }
    this.applySystem(a ?? { type: 'endTurn' });
  }

  applySystem(action) {
    const res = applyAction(this.game, 'p' + this.game.turnIdx, action);
    if (!res.ok) {
      // rede de segurança: nunca travar a mesa
      const fallback = autoAction(this.game);
      if (fallback) {
        const res2 = applyAction(this.game, 'p' + this.game.turnIdx, fallback);
        if (res2.ok) {
          this.game = res2.state;
          this.broadcastGame([{ type: 'auto' }]);
        }
      }
    } else {
      this.game = res.state;
      this.broadcastGame(res.events);
    }
    this.scheduleTick();
  }

  // ---------- transmissão ----------
  sanitize(st) {
    const c = structuredClone(st);
    c.deck = null; // ordem das cartas é informação oculta
    return c;
  }

  broadcastGame(events) {
    this.io.to(this.code).emit('game:state', {
      code: this.code,
      state: this.sanitize(this.game),
      events: events || [],
      seats: this.publicSeats(),
    });
  }

  broadcastRoom() {
    this.io.to(this.code).emit('room:state', this.publicRoom());
  }

  publicSeats() {
    return this.seats.map((s) =>
      s ? { token: s.token, name: s.name, isBot: s.isBot, connected: s.connected } : null
    );
  }

  publicRoom() {
    return {
      code: this.code,
      hostToken: this.hostToken,
      playerCount: this.playerCount,
      config: this.engineCfg,
      seats: this.publicSeats(),
      started: !!this.game,
    };
  }

  sendAllTo(socket) {
    socket.emit('room:state', this.publicRoom());
    if (this.game) {
      socket.emit('game:state', {
        code: this.code,
        state: this.sanitize(this.game),
        events: [],
        seats: this.publicSeats(),
      });
    }
  }

  error(socket, msg) {
    socket.emit('room:error', { message: msg });
  }

  errorTo(token, msg) {
    this.io.to(this.code).emit('room:error', { message: msg });
  }
}

// gerência global
export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  create(socket, name) {
    let code;
    do {
      code = genCode();
    } while (this.rooms.has(code));
    const room = new Room(this.io, code);
    this.rooms.set(code, room);
    room.join(socket, name);
    return room;
  }

  bySocket(socket) {
    return socket.data.code ? this.rooms.get(socket.data.code) : null;
  }

  leave(socket) {
    const room = this.bySocket(socket);
    if (room) room.onLeave(socket, true);
  }

  disconnect(socket) {
    const room = this.bySocket(socket);
    if (room) room.onLeave(socket, false);
  }

  remove(code) {
    const room = this.rooms.get(code);
    if (room) {
      clearTimeout(room.timer);
      clearTimeout(room.cleanupTimer);
      this.rooms.delete(code);
    }
  }
}

function managerRemove(code) {
  // callback indireto para evitar import circular
  if (globalThis.__roomManager) globalThis.__roomManager.remove(code);
}
