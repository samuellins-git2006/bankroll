// ============================================================
// CLIENTE — modos LOCAL (hotseat) e ONLINE (socket.io)
// ============================================================

import { CONFIG } from '../../shared/config.js';
import {
  createGame, applyAction, legalActions, netWorth,
  buildBlocker, sellValue, cur,
} from '../../shared/engine.js';
import { renderBoard, cellRect, hitIndex, SIZE } from './board.js';
import { SERVER_URL } from './config.js';

const $ = (s) => document.querySelector(s);
const fmt = (n) => '$' + n.toLocaleString('pt-BR');
const SAVE_KEY = 'bankroll_state_v1';
const NAME_KEY = 'bankroll_name';

let mode = null;      // 'local' | 'online'
let game = null;      // estado da engine
let myId = null;      // 'p0'..'p3' (quem EU represento)
let myToken = null;
let room = null;      // último room:state recebido
let busy = false;
let auctionPrompted = null; // índice da propriedade já perguntada (leilão online)

const me = () => (game && myId ? game.players.find((p) => p.id === myId) : null) ?? (game ? cur(game) : null);

// ============================================================
// NAVEGAÇÃO ENTRE TELAS
// ============================================================
const SCREENS = ['mode-screen', 'setup-screen', 'lobby-screen', 'game-screen'];
function showScreen(name) {
  SCREENS.forEach((s) => $('#' + s).classList.toggle('hidden', s !== name));
}

// ============================================================
// TOKEN + SOCKET
// ============================================================
function getToken() {
  let t = sessionStorage.getItem('bankroll_token');
  if (!t) {
    t = 'tok-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('bankroll_token', t);
  }
  return t;
}

let sock = null;
function ensureSocket() {
  if (sock) return sock;
  myToken = getToken();
  sock = io(SERVER_URL, { auth: { token: myToken }, transports: ['websocket', 'polling'] });

  sock.on('connect_error', (e) => toast('Falha ao conectar no servidor: ' + e.message, 'bad', 5000));
  sock.on('room:error', ({ message }) => toast(message, 'bad'));

  sock.on('room:joined', () => showScreen('lobby'));

  sock.on('room:state', (r) => {
    room = r;
    if (!r.started && $('#game-screen').classList.contains('hidden') === false && game) {
      // anfitrião voltou ao lobby
      showScreen('lobby');
      game = null;
    }
    if (!r.started) renderLobby();
  });

  sock.on('game:state', ({ state, events, seats }) => {
    game = state;
    busy = false;
    const idx = (seats || []).findIndex((s) => s && s.token === myToken);
    if (idx >= 0) myId = 'p' + idx;
    showScreen('game');
    render();
    handleEvents(events || []);
    onlineAuctionWatch();
  });

  return sock;
}

function emitAction(action) {
  ensureSocket().emit('game:action', action);
}

// ============================================================
// TELA DE MODO
// ============================================================
$('#input-name').value = localStorage.getItem(NAME_KEY) || '';

function playerName() {
  const n = $('#input-name').value.trim() || 'Jogador';
  localStorage.setItem(NAME_KEY, n);
  return n;
}

$('#btn-local').onclick = () => {
  mode = 'local';
  showScreen('setup');
  if (localStorage.getItem(SAVE_KEY)) $('#btn-continue').classList.remove('hidden');
};

$('#btn-create').onclick = () => {
  mode = 'online';
  myToken = getToken();
  ensureSocket().emit('room:create', { name: playerName() });
};

$('#btn-join').onclick = () => {
  const code = $('#input-code').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Digite o código de 4 letras da sala.', 'bad');
  mode = 'online';
  myToken = getToken();
  ensureSocket().emit('room:join', { code, name: playerName() });
};

// ============================================================
// LOBBY (ONLINE)
// ============================================================
function renderLobby() {
  if (!room) return;
  $('#room-code').textContent = room.code;
  $('#btn-copy').onclick = () => {
    navigator.clipboard?.writeText(room.code).then(() => toast('Código copiado!', 'good'));
  };

  const isHost = room.hostToken === myToken;
  $('#host-controls').classList.toggle('hidden', !isHost);
  $('#waiting-host').classList.toggle('hidden', isHost);

  // assentos
  const seatsEl = $('#seat-list');
  seatsEl.innerHTML = '';
  for (let i = 0; i < room.playerCount; i++) {
    const seat = room.seats[i];
    const row = document.createElement('div');
    row.className = 'seat-row' + (seat ? ' filled' : '');
    if (!seat) {
      row.innerHTML = `<span class="sname" style="color:var(--muted)">Vaga aberta${isHost ? ' (vira bot ao iniciar)' : ''}</span>`;
    } else {
      const tags = [
        seat.isBot ? '<span class="tag">🤖 Bot</span>' : '',
        seat.token === room.hostToken ? '<span class="tag host">👑 Anfitrião</span>' : '',
        !seat.connected && !seat.isBot ? '<span class="tag off">desconectado</span>' : '',
      ].join('');
      row.innerHTML = `
        <span class="sname">${seat.name}</span>${tags}
        ${isHost && seat.isBot ? '<button class="rm" title="Remover bot">✖</button>' : ''}`;
      const rm = row.querySelector('.rm');
      if (rm) rm.onclick = () => ensureSocket().emit('room:removeSeat', { index: i });
    }
    seatsEl.appendChild(row);
  }

  if (!isHost) return;

  // controles do anfitrião
  buildSegmented(
    $('#count-options'), [2, 3, 4], ['2', '3', '4'],
    room.playerCount,
    (v) => ensureSocket().emit('room:config', { ...room.config, playerCount: v })
  );
  buildSegmented(
    $('#goal-options-l'), [3000, 5000, 7000], ['3 mil', '5 mil', '7 mil'],
    room.config.goal,
    (v) => ensureSocket().emit('room:config', { ...room.config, goal: v })
  );
  buildSegmented(
    $('#round-options-l'), [30, 50, 0], ['30', '50', 'Ilimitado'],
    room.config.maxRounds,
    (v) => ensureSocket().emit('room:config', { ...room.config, maxRounds: v })
  );

  $('#btn-addbot').onclick = () => ensureSocket().emit('room:addBot');
  $('#btn-start-online').onclick = () => ensureSocket().emit('room:start');
}

$('#btn-leave').onclick = () => {
  ensureSocket().emit('room:leave');
  sock?.disconnect();
  room = null; game = null; myId = null; sock = null;
  showScreen('mode');
};

// helper compartilhado com o setup local
function buildSegmented(container, options, labels, selected, onPick) {
  container.innerHTML = '';
  options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = labels[i];
    if (opt === selected) b.classList.add('active');
    b.onclick = () => onPick(opt);
    container.appendChild(b);
  });
}

// ============================================================
// SETUP (LOCAL / HOTSEAT)
// ============================================================
let setupCount = 4;
let setupGoal = CONFIG.goalOptions[0];
let setupRounds = CONFIG.roundOptions[0];

function initSetup() {
  const nameList = $('#name-list');
  const colors = CONFIG.playerColors;
  nameList.innerHTML = '';
  for (let i = 0; i < setupCount; i++) {
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML = `
      <span class="dot" style="background:${colors[i]}"></span>
      <input type="text" maxlength="14" placeholder="Jogador ${i + 1}"
             value="${(window.__names?.[i] || '')}" data-i="${i}" />`;
    nameList.appendChild(row);
  }
  document.querySelectorAll('#player-count button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.count) === setupCount);
    b.onclick = () => {
      window.__names = [...document.querySelectorAll('#name-list input')].map((el) => el.value);
      setupCount = Number(b.dataset.count);
      initSetup();
    };
  });
}

buildSegmented(
  $('#goal-options'), CONFIG.goalOptions,
  CONFIG.goalOptions.map((g) => fmt(g)), setupGoal,
  (v) => { setupGoal = v; }
);
buildSegmented(
  $('#round-options'), CONFIG.roundOptions,
  ['30', '50', 'Ilimitado'], setupRounds,
  (v) => { setupRounds = v; }
);

$('#form-setup').onsubmit = (e) => {
  e.preventDefault();
  const names = [...document.querySelectorAll('#name-list input')].map((el) => el.value);
  const defs = names.slice(0, setupCount).map((n) => ({ name: n }));
  game = createGame({ goal: setupGoal, maxRounds: setupRounds }, defs);
  mode = 'local';
  myId = cur(game).id;
  save();
  showScreen('game');
  render();
};

$('#btn-continue').onclick = () => {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    game = JSON.parse(raw).state;
    mode = 'local';
    showScreen('game');
    render();
  } catch { localStorage.removeItem(SAVE_KEY); }
};

$('#btn-new').onclick = () => {
  if (mode === 'online') {
    ensureSocket().emit('room:leave');
    sock?.disconnect();
    room = null; game = null; myId = null; sock = null;
    showScreen('mode');
    return;
  }
  if (!confirm('Encerrar a partida atual e voltar ao menu?')) return;
  localStorage.removeItem(SAVE_KEY);
  game = null;
  showScreen('mode');
};

function save() {
  if (mode === 'local' && game) {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: game }));
  }
}

// ============================================================
// AÇÕES
// ============================================================
async function act(action, pid = null) {
  if (!game || busy) return;

  if (mode === 'online') {
    emitAction(action);
    return;
  }

  // ----- hotseat -----
  const playerId = pid ?? cur(game).id;
  const res = applyAction(game, playerId, action);
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  game = res.state;
  myId = cur(game).id;
  save();
  await handleEvents(res.events);
  render();
  checkAutoFlows();
}

// animação do dado antes de rolar de verdade
function rollDice() {
  if (!game || busy) return;
  busy = true;
  const fx = $('#dice-fx');
  const canvas = $('#board');
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / SIZE;
  const target = cellRect(cur(game).position);
  fx.classList.remove('hidden');
  fx.style.left = rect.left + (target.x + target.w / 2) * scale - 37 + 'px';
  fx.style.top = rect.top + (target.y + target.h / 2) * scale - 37 + 'px';

  let ticks = 0;
  const iv = setInterval(() => {
    fx.textContent = 1 + Math.floor(Math.random() * 6);
    if (++ticks >= 10) {
      clearInterval(iv);
      fx.classList.add('hidden');
      busy = false;
      act({ type: 'roll' });
    }
  }, 60);
}

// ============================================================
// FLUXOS AUTOMÁTICOS — HOTSEAT (leilão guiado)
// ============================================================
let auctionRunning = false;

function checkAutoFlows() {
  if (!game || game.over || mode !== 'local') return;
  const pending = game.pending;
  if (pending?.type === 'auction' && pending.space !== null) {
    runAuctionFlow();
  }
}

async function runAuctionFlow() {
  if (auctionRunning) return;
  auctionRunning = true;
  try {
    await runAuctionFlowInner();
  } finally {
    auctionRunning = false;
  }
}

async function runAuctionFlowInner() {
  const offerer = cur(game);
  const others = game.players.filter((p) => !p.bankrupt && p.id !== offerer.id);

  for (const o of others) {
    if (game.pending?.offers.some((x) => x.playerId === o.id)) continue;
    const choice = await modalPledge(o);
    if (!game.pending || game.pending.space === null) return;
    if (choice !== null) {
      await act({ type: 'pledge', space: choice }, o.id);
    }
    if (!game.pending) return;
  }

  const pending = game.pending;
  if (!pending || !pending.offers.length) {
    modalInfo(
      'Nenhuma oferta',
      'Ninguém quis trocar. O leilão foi cancelado.',
      async () => { await act({ type: 'cancelAuction' }); }
    );
    return;
  }

  modalOffers(pending, async (playerId) => {
    await act({ type: 'acceptTrade', playerId });
  }, async () => {
    await act({ type: 'cancelAuction' });
  });
}

// ============================================================
// FLUXO DE LEILÃO — ONLINE (modal por cliente)
// ============================================================
function onlineAuctionWatch() {
  if (mode !== 'online' || !game || game.over) return;
  const pend = game.pending;

  if (pend?.type === 'auction' && pend.space !== null) {
    const idx = Number(myId.slice(1));
    const meP = game.players[idx];
    if (!meP || meP.id === cur(game).id) return; // ofertante usa os botões do painel
    if (pend.offers.some((o) => o.playerId === meP.id)) return;
    if (auctionPrompted === pend.space) return;

    const owned = Object.keys(game.props)
      .filter((i) => game.props[i].owner === meP.id)
      .map(Number);
    if (!owned.length) return;

    auctionPrompted = pend.space;
    modalPledge(meP).then((choice) => {
      const p = game?.pending;
      if (choice !== null && p?.space === pend.space &&
          !p.offers.some((o) => o.playerId === meP.id)) {
        emitAction({ type: 'pledge', space: choice });
      }
    });
  } else if (!pend) {
    auctionPrompted = null;
  }
}

// ============================================================
// EVENTOS → TOASTS / MODAIS
// ============================================================
function handleEvents(events) {
  const luckies = events.filter((e) => e.type === 'lucky');
  if (luckies.length) {
    const card = luckies[0].card;
    return new Promise((resolve) => {
      modalLucky(card, resolve);
    });
  }
  const win = events.find((e) => e.type === 'win');
  if (win && game?.winner) {
    const p = game.players.find((x) => x.id === game.winner);
    toast(`🏆 ${p.name} venceu a partida!`, 'good', 6000);
  }
  return Promise.resolve();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  if (!game) return;
  renderBoard($('#board'), game);
  renderPlayers();
  renderTurnBanner();
  renderActions();
  renderLog();
}

function renderTurnBanner() {
  const el = $('#turn-banner');
  if (game.over) {
    const w = game.players.find((p) => p.id === game.winner);
    el.textContent = `🏆 ${w.name} venceu!`;
    el.style.color = 'var(--accent)';
    return;
  }
  const cp = cur(game);
  const you = myId === cp.id ? ' (você)' : '';
  el.textContent = `Vez de: ${cp.name}${you}`;
  el.style.color = cp.color;
}

function renderPlayers() {
  const el = $('#players');
  el.innerHTML = '';
  game.players.forEach((p) => {
    const nw = netWorth(game, p.id);
    const row = document.createElement('div');
    row.className =
      'player-row' +
      (p.id === cur(game).id && !game.over ? ' current' : '') +
      (p.bankrupt ? ' bankrupt' : '');
    row.innerHTML = `
      <span class="dot" style="background:${p.color}"></span>
      <span class="pname">${p.name}${p.jailTurns > 0 ? ' 🔒' : ''}${p.id === myId ? ' ★' : ''}</span>
      <span class="pcash">${fmt(p.cash)}</span>
      <span class="pworth">${fmt(nw)}</span>`;
    el.appendChild(row);
  });
}

function renderActions() {
  const el = $('#actions');
  el.innerHTML = '';
  const meP = me();
  if (!meP) return;

  if (game.over) {
    if (mode === 'online' && room?.hostToken === myToken) {
      el.appendChild(mkBtn('🔄 Voltar ao lobby', () => ensureSocket().emit('room:reset'), 'btn primary'));
    } else if (mode === 'local') {
      el.appendChild(mkBtn('🔄 Jogar novamente', () => {
        localStorage.removeItem(SAVE_KEY);
        location.reload();
      }, 'btn primary'));
    } else {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'Aguardando o anfitrião…';
      el.appendChild(p);
    }
    return;
  }

  const list = legalActions(game, meP.id);
  for (const a of list) {
    const action = { ...a };
    delete action.label;
    const isRoll = action.type === 'roll';

    if (action.type === 'offerAuction') {
      const owned = Object.keys(game.props)
        .filter((i) => game.props[i].owner === meP.id)
        .map(Number);
      if (!owned.length) continue;
      el.appendChild(mkBtn(a.label, () => modalPickOwned(owned, meP), 'btn'));
      continue;
    }

    const b = mkBtn(a.label, isRoll ? rollDice : () => act(action, meP.id), isRoll ? 'btn primary' : 'btn');
    if (action.type === 'buy') b.classList.add('primary');
    el.appendChild(b);
  }

  // construir / vender (painel)
  const isMyTurn = !game.over && myId === cur(game).id;
  const owned = Object.keys(game.props)
    .filter((i) => game.props[i].owner === meP.id)
    .map(Number);
  if (owned.length && isMyTurn && !game.pending && !game.jailAction) {
    const bBuild = mkBtn('🏠 Construir', () => modalManage('build'));
    bBuild.disabled = !owned.some((i) => !buildBlocker(game, meP.id, i));
    el.appendChild(bBuild);

    el.appendChild(mkBtn('💸 Vender', () => modalManage('sell')));
  }
}

function renderLog() {
  const el = $('#log');
  el.innerHTML = '';
  for (const line of game.log.slice(-60)) {
    const d = document.createElement('div');
    d.className = 'entry' + (line.startsWith('—') || line.startsWith('🏆') ? ' highlight' : '');
    d.textContent = line;
    el.appendChild(d);
  }
  el.scrollTop = el.scrollHeight;
}

function mkBtn(label, onclick, cls = 'btn') {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

// clique no tabuleiro → ficha da propriedade
$('#board').addEventListener('click', (e) => {
  if (!game || busy) return;
  const rect = e.target.getBoundingClientRect();
  const scale = rect.width / SIZE;
  const idx = hitIndex((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
  if (idx === null) return;
  modalProperty(idx);
});

// ============================================================
// MODAIS
// ============================================================
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal">${html}</div>`;
  root.classList.remove('hidden');
  return root.querySelector('.modal');
}

function closeModal() {
  $('#modal-root').classList.add('hidden');
  $('#modal-root').innerHTML = '';
}
window.__closeModal = closeModal;

// --- Ficha da propriedade ---
function modalProperty(idx) {
  const sp = game.cfg.board[idx];
  const meP = me();
  const own = game.props[idx];

  if (['lucky', 'start', 'jail', 'auction'].includes(sp.type)) {
    openModal(`
      <h2>${nameOf(sp)}</h2>
      <div class="sub">${spDesc(sp)}</div>
      <div class="m-actions"><button class="btn btn-secondary" onclick="window.__closeModal()">Fechar</button></div>
    `);
    return;
  }

  let rows = '';
  if (sp.type === 'city') {
    const base = sp.rent;
    rows = `
      <tr><td>Aluguel base</td><td>${fmt(base)}</td></tr>
      <tr><td>Com monopólio da cor</td><td>${fmt(base * 2)}</td></tr>
      <tr><td>Com 1 construção</td><td>${fmt(base * 3)}</td></tr>
      <tr><td>Com 2 construções</td><td>${fmt(base * 6)}</td></tr>
      <tr><td>Com 3 construções</td><td>${fmt(base * 12)}</td></tr>
      <tr><td>Custo da construção</td><td>${fmt(game.cfg.buildingCostByGroup[sp.group])}</td></tr>`;
  } else {
    rows = `
      <tr><td>Aluguel (1 pública)</td><td>${fmt(game.cfg.publicRentBase)}</td></tr>
      <tr><td>Aluguel (2 públicas)</td><td>${fmt(game.cfg.publicRentBase * 2)}</td></tr>
      <tr><td>Aluguel (3 públicas)</td><td>${fmt(game.cfg.publicRentBase * 3)}</td></tr>
      <tr><td>Aluguel (4 públicas)</td><td>${fmt(game.cfg.publicRentBase * 4)}</td></tr>`;
  }

  const ownerName = own ? game.players.find((p) => p.id === own.owner).name : null;
  const isMyTurn = myId === cur(game).id && !game.over;

  const buttons = [];
  if (game.pending?.type === 'buy' && game.pending.space === idx && isMyTurn) {
    buttons.push(`<button class="btn btn-primary" data-act="buy">Comprar por ${fmt(sp.price)}</button>`);
    buttons.push(`<button class="btn btn-secondary" data-act="decline">Não comprar</button>`);
  }
  if (own && own.owner === meP.id && isMyTurn && !game.pending) {
    const blocker = sp.type === 'city' ? buildBlocker(game, meP.id, idx) : 'n/a';
    if (sp.type === 'city')
      buttons.push(
        blocker
          ? `<button class="btn" disabled>🏠 Construir (${blocker})</button>`
          : `<button class="btn btn-primary" data-act="build">🏠 Construir por ${fmt(game.cfg.buildingCostByGroup[sp.group])}</button>`
      );
    buttons.push(`<button class="btn btn-secondary" data-act="sell">💸 Vender por ${fmt(sellValue(game, meP.id, idx))}</button>`);
  }
  buttons.push(`<button class="btn btn-secondary" data-act="close">Fechar</button>`);

  const m = openModal(`
    ${sp.type === 'city' ? `<div class="group-band" style="background:${game.cfg.groups[sp.group].color}"></div>` : ''}
    <h2>${sp.name}</h2>
    <div class="sub">${spDesc(sp)}${ownerName ? ` • Dono: <b>${ownerName}</b>${own.buildings ? ` • ${own.buildings} construção(ões)` : ''}` : ' • Sem dono'}</div>
    <table>${rows}</table>
    <div class="m-actions">${buttons.join('')}</div>
  `);

  m.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.act;
      if (a === 'close') return closeModal();
      closeModal();
      await act({ type: a, space: idx });
    };
  });
}

function nameOf(sp) {
  return { start: 'Início', jail: 'Cadeia', auction: 'Leilão', lucky: 'Carta da Sorte' }[sp.type] || sp.name;
}
function spDesc(sp) {
  switch (sp.type) {
    case 'start': return 'Ao passar por aqui, você recebe $200.';
    case 'jail': return 'Cair aqui te prende por 3 turnos — ou pague $150 para sair.';
    case 'auction': return 'Abra uma mesa de trocas e negocie propriedades (+$100 para ambos).';
    case 'lucky': return 'Um efeito aleatório: pode ser bom... ou não.';
    case 'city': return `Cidade do grupo ${sp.group}. Aluguel aumenta com monopólio e construções.`;
    case 'public': return 'Propriedade pública. Aluguel = $50 × nº de públicas que você tem.';
  }
}

// --- Carta da sorte ---
function modalLucky(card, onOk) {
  const m = openModal(`
    <div class="lucky-card">
      <div style="font-size:40px">🍀</div>
      <div class="lc-title">${card.title}</div>
      <div class="lc-desc">${card.desc}</div>
    </div>
    <div class="m-actions"><button class="btn btn-primary" id="m-ok">OK</button></div>
  `);
  m.querySelector('#m-ok').onclick = () => { closeModal(); onOk(); };
}

// --- Construir / vender ---
function modalManage(mode2) {
  const meP = me();
  const owned = Object.keys(game.props)
    .filter((i) => game.props[i].owner === meP.id)
    .map(Number);
  const items = owned.map((idx) => {
    const sp = game.cfg.board[idx];
    const own = game.props[idx];
    let label = sp.name;
    let disabled = false;
    let hint = '';
    if (mode2 === 'build') {
      const blocker = sp.type === 'city' ? buildBlocker(game, meP.id, idx) : 'n/a';
      disabled = !!blocker;
      hint = sp.type === 'city'
        ? (blocker || `Construções: ${own.buildings}/3`)
        : 'Só cidades';
    } else {
      hint = `Recebe ${fmt(sellValue(game, meP.id, idx))}`;
      label = sp.name + (own.buildings ? ` (${own.buildings}🏗)` : '');
    }
    return { idx, label, hint, disabled };
  });

  const m = openModal(`
    <h2>${mode2 === 'build' ? '🏠 Construir' : '💸 Vender'}</h2>
    <div class="sub">${mode2 === 'build'
      ? 'Construções exigem o monopólio da cor (máx. 3 por cidade).'
      : 'A venda devolve 80% do valor investido.'}</div>
    <div class="prop-grid">
      ${items.map((it) => `
        <button class="prop-btn" data-idx="${it.idx}" ${it.disabled ? 'disabled style="opacity:.45"' : ''}>
          ${it.label}<small>${it.hint}</small>
        </button>`).join('')}
    </div>
    <div class="m-actions"><button class="btn btn-secondary" onclick="window.__closeModal()">Fechar</button></div>
  `);
  m.querySelectorAll('.prop-btn:not([disabled])').forEach((b) => {
    b.onclick = async () => {
      closeModal();
      await act({ type: mode2, space: Number(b.dataset.idx) });
    };
  });
}

// --- Escolher propriedade própria (oferecer no leilão) ---
function modalPickOwned(owned, player) {
  const m = openModal(`
    <h2>Leilão — ${player.name}</h2>
    <div class="note">Escolha uma das SUAS propriedades para colocar na mesa de trocas.
      Se fechar uma troca, ambos ganham $100.</div>
    <div class="prop-grid">
      ${owned.map((idx) => {
        const sp = game.cfg.board[idx];
        const own = game.props[idx];
        return `<button class="prop-btn" data-idx="${idx}">
          ${sp.name}<small>${own.buildings ? own.buildings + '🏗 • ' : ''}${fmt(sp.price)}</small>
        </button>`;
      }).join('')}
    </div>
    <div class="m-actions"><button class="btn btn-secondary" onclick="window.__closeModal()">Cancelar</button></div>
  `);
  m.querySelectorAll('.prop-btn').forEach((b) => {
    b.onclick = async () => {
      closeModal();
      await act({ type: 'offerAuction', space: Number(b.dataset.idx) });
    };
  });
}

// --- Leilão: escolher propriedade para oferecer em troca ---
function modalPledge(player) {
  return new Promise((resolve) => {
    const owned = Object.keys(game.props)
      .filter((i) => game.props[i].owner === player.id)
      .map(Number);

    if (!owned.length) {
      toast(`${player.name} não tem propriedades para oferecer.`);
      resolve(null);
      return;
    }

    const m = openModal(`
      <h2>Leilão — ${player.name}</h2>
      <div class="note">Escolha uma das SUAS propriedades para oferecer na troca
        (ou passe). Quem fechar a troca ganha $100 de bônus.</div>
      <div class="prop-grid">
        ${owned.map((idx) => {
          const sp = game.cfg.board[idx];
          const own = game.props[idx];
          return `<button class="prop-btn" data-idx="${idx}">
            ${sp.name}<small>${own.buildings ? own.buildings + '🏗 • ' : ''}${fmt(sp.price)}</small>
          </button>`;
        }).join('')}
      </div>
      <div class="m-actions"><button class="btn btn-secondary" id="m-pass">Não oferecer</button></div>
    `);

    m.querySelectorAll('.prop-btn').forEach((b) => {
      b.onclick = () => { closeModal(); resolve(Number(b.dataset.idx)); };
    });
    m.querySelector('#m-pass').onclick = () => { closeModal(); resolve(null); };
  });
}

// --- Leilão: ofertante aceita ou cancela (hotseat) ---
function modalOffers(pending, onAccept, onCancel) {
  const offerer = cur(game);
  const spMine = game.cfg.board[pending.space];
  const rows = pending.offers.map((o) => {
    const p = game.players.find((x) => x.id === o.playerId);
    const sp = game.cfg.board[o.space];
    const own = game.props[o.space];
    return `
      <div class="offer-row">
        <span><b style="color:${p.color}">${p.name}</b> oferece <b>${sp.name}</b>${own.buildings ? ` (${own.buildings}🏗)` : ''}</span>
        <button class="btn btn-primary btn-sm" data-pid="${o.playerId}">Aceitar</button>
      </div>`;
  }).join('');

  const m = openModal(`
    <h2>Leilão — ${offerer.name}</h2>
    <div class="note">Você ofereceu <b>${spMine.name}</b>. Escolha uma oferta para aceitar:
      ambos ganham $100 de bônus.</div>
    ${rows}
    <div class="m-actions"><button class="btn btn-danger" id="m-cancel">Cancelar leilão</button></div>
  `);

  m.querySelectorAll('[data-pid]').forEach((b) => {
    b.onclick = () => { closeModal(); onAccept(b.dataset.pid); };
  });
  m.querySelector('#m-cancel').onclick = () => { closeModal(); onCancel(); };
}

function modalInfo(title, text, onOk) {
  const m = openModal(`
    <h2>${title}</h2>
    <div class="sub">${text}</div>
    <div class="m-actions"><button class="btn btn-primary" id="m-ok">OK</button></div>
  `);
  m.querySelector('#m-ok').onclick = async () => { closeModal(); await onOk(); };
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, cls = '', ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
initSetup();
showScreen('mode-screen');
