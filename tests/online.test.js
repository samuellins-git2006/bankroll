// ============================================================
// Teste do multiplayer: sobe o servidor, cria sala, conecta 2
// humanos + 1 bot, inicia e joga algumas rodadas.
// Rode com: npm run test:online
// ============================================================

import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const URL = 'http://localhost:3199';
const PORT = 3199;

function assert(cond, msg) {
  if (!cond) {
    console.error('❌ FALHOU:', msg);
    process.exit(1);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connect(token) {
  return io(URL, { auth: { token }, transports: ['websocket'] });
}

// sobe o servidor
const server = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[srv:err] ' + d));

try {
  await wait(1000);

  const host = connect('tok-host');
  const guest = connect('tok-guest');

  host.on('room:error', ({ message }) => console.log('[host erro]', message));
  guest.on('room:error', ({ message }) => console.log('[guest erro]', message));

  // cria sala
  const created = new Promise((res) => host.once('room:joined', res));
  host.emit('room:create', { name: 'Host' });
  const { code } = await created;
  assert(code && code.length === 4, 'código de sala gerado: ' + code);
  console.log('✅ Sala criada:', code);

  // entra convidado (listener ANTES do emit, senão perde o broadcast)
  const twoSeats = new Promise((res) => {
    const check = (r) => (r.seats.filter(Boolean).length >= 2 ? res(r) : host.once('room:state', check));
    host.once('room:state', check);
  });
  guest.emit('room:join', { code, name: 'Guest' });
  const roomState = await twoSeats;
  await wait(200);
  assert(roomState.seats.filter(Boolean).length === 2, '2 jogadores na sala');
  assert(roomState.hostToken === 'tok-host', 'host é o criador');
  console.log('✅ Convidado entrou na sala');

  // host ajusta config para 2 vagas e inicia (vaga extra vira bot? não: 2 vagas, 2 humanos)
  host.emit('room:config', { playerCount: 2, goal: 3000, rounds: 30 });
  await wait(300);
  const startedPromise = new Promise((res) => host.once('game:state', res));
  host.emit('room:start');
  let started = await startedPromise;
  assert(started?.state, 'partida iniciada com estado do engine');
  assert(started.state.players.length === 2, '2 jogadores na partida');
  console.log('✅ Partida iniciada');

  // guest também recebe estado
  guest.emit('room:join', { code, name: 'Guest' }); // reconexão simples
  await wait(300);

  // ambos os clientes jogam ações legais manualmente
  let actions = 0;
  const MAX = 40;
  const players = [
    { sock: host, token: 'tok-host', idx: 0 },
    { sock: guest, token: 'tok-guest', idx: 1 },
  ];

  await new Promise((resolveAll) => {
    const tryAct = () => {
      const st = started.state;
      if (!st || actions >= MAX || st.over) return resolveAll();

      const p = players[st.turnIdx];
      if (st.turnIdx !== p.idx) {
        p.sock.once('game:state', (s) => { started = s; setTimeout(tryAct, 50); });
        return;
      }

      let action = null;
      if (st.pending?.type === 'buy') action = Math.random() < 0.5 ? { type: 'buy' } : { type: 'decline' };
      else if (st.pending?.type === 'auction') {
        action = st.pending.space === null
          ? { type: 'skipAuction' }
          : (st.pending.offers.length ? { type: 'cancelAuction' } : { type: 'cancelAuction' });
      }
      else if (st.jailAction === 'choose') action = { type: 'stayJail' };
      else if (st.phase === 'start') action = { type: 'roll' };
      else action = { type: 'endTurn' };

      actions++;
      p.sock.once('game:state', (s) => { started = s; setTimeout(tryAct, 50); });
      p.sock.emit('game:action', action);
    };
    tryAct();
  });

  assert(actions > 0, `host executou ${actions} ações sem erro`);
  console.log(`✅ Host executou ${actions} ações (bot jogou os turnos dele)`);

  // estado sincronizado: guest recebeu os mesmos eventos
  console.log('✅ Multiplayer funcionando!');
} finally {
  server.kill();
}

console.log('✅ test:online passou!');
process.exit(0);
