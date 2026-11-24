// ============================================================
// CLIENTE HOTSEAT — controla setup, ações, UI e persistência.
// ============================================================

import { CONFIG } from '../../shared/config.js';
import {
  createGame, applyAction, legalActions, netWorth,
  buildBlocker, sellValue, cur, groupIndices,
} from '../../shared/engine.js';
import { renderBoard, cellRect, hitIndex, SIZE } from './board.js';

const $ = (s) => document.querySelector(s);
const fmt = (n) => '$' + n.toLocaleString('pt-BR');
const SAVE_KEY = 'bankroll_state_v1';

let state = null;
let busy = false; // bloqueia ações durante animações

// ============================================================
// SETUP
// ============================================================
let setupCount = 4;

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

function buildSegmented(container, options, labels, selected, onPick) {
  container.innerHTML = '';
  options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = labels[i];
    if (opt === selected) b.classList.add('active');
    b.onclick = () => {
      container.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onPick(opt);
    };
    container.appendChild(b);
  });
}

let setupGoal = CONFIG.goalOptions[0];
let setupRounds = CONFIG.roundOptions[0];

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
  state = createGame({ goal: setupGoal, maxRounds: setupRounds }, defs);
  save();
  showGame();
};

$('#btn-continue').onclick = () => {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    state = JSON.parse(raw).state;
    showGame();
  } catch { localStorage.removeItem(SAVE_KEY); }
};

$('#btn-new').onclick = () => {
  if (!confirm('Encerrar a partida atual e voltar ao menu?')) return;
  localStorage.removeItem(SAVE_KEY);
  state = null;
  $('#game-screen').classList.add('hidden');
  $('#setup-screen').classList.remove('hidden');
  $('#modal-root').classList.add('hidden');
};

// restaurar partida?
if (localStorage.getItem(SAVE_KEY)) {
  $('#btn-continue').classList.remove('hidden');
}

function showGame() {
  $('#setup-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  render();
}

function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state }));
}

// ============================================================
// AÇÕES
// ============================================================
async function act(action, pid = null) {
  if (!state || busy) return;
  const playerId = pid ?? cur(state).id;
  const res = applyAction(state, playerId, action);
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  state = res.state;
  save();
  await handleEvents(res.events);
  render();
  checkAutoFlows();
}

// animação do dado antes de rolar de verdade
function rollDice() {
  if (!state || busy) return;
  busy = true;
  const fx = $('#dice-fx');
  const canvas = $('#board');
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / SIZE;
  const target = cellRect(cur(state).position);
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
// FLUXOS AUTOMÁTICOS (leilão)
// ============================================================
let auctionRunning = false;

function checkAutoFlows() {
  if (!state || state.over) return;
  const pending = state.pending;
  if (pending?.type === 'auction' && pending.space !== null) {
    runAuctionFlow();
  }
}

// Sequência em hotseat: cada outro jogador oferece (ou passa),
// depois o ofertante aceita uma troca ou cancela.
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
  const offerer = cur(state);
  const others = state.players.filter(
    (p) => !p.bankrupt && p.id !== offerer.id
  );

  for (const o of others) {
    if (state.pending?.offers.some((x) => x.playerId === o.id)) continue;
    const choice = await modalPledge(o);
    if (!state.pending || state.pending.space === null) return; // cancelado
    if (choice !== null) {
      await act({ type: 'pledge', space: choice }, o.id);
    }
    if (!state.pending) return;
  }

  // ofertante decide
  const pending = state.pending;
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
  if (win && state.winner) {
    const p = state.players.find((x) => x.id === state.winner);
    toast(`🏆 ${p.name} venceu a partida!`, 'good', 6000);
  }
  return Promise.resolve();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  if (!state) return;
  renderBoard($('#board'), state);
  renderPlayers();
  renderTurnBanner();
  renderActions();
  renderLog();
}

function renderTurnBanner() {
  const el = $('#turn-banner');
  if (state.over) {
    const w = state.players.find((p) => p.id === state.winner);
    el.textContent = `🏆 ${w.name} venceu!`;
    el.style.color = 'var(--accent)';
    return;
  }
  const cp = cur(state);
  el.textContent = `Vez de: ${cp.name}`;
  el.style.color = cp.color;
}

function renderPlayers() {
  const el = $('#players');
  el.innerHTML = '';
  state.players.forEach((p, i) => {
    const nw = netWorth(state, p.id);
    const row = document.createElement('div');
    row.className =
      'player-row' +
      (p.id === cur(state).id && !state.over ? ' current' : '') +
      (p.bankrupt ? ' bankrupt' : '');
    row.innerHTML = `
      <span class="dot" style="background:${p.color}"></span>
      <span class="pname">${p.name}${p.jailTurns > 0 ? ' 🔒' : ''}</span>
      <span class="pcash">${fmt(p.cash)}</span>
      <span class="pworth">${fmt(nw)}</span>`;
    el.appendChild(row);
  });
}

function renderActions() {
  const el = $('#actions');
  el.innerHTML = '';
  if (state.over) {
    const b = mkBtn('🔄 Jogar novamente', () => {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    }, 'btn primary');
    el.appendChild(b);
    return;
  }
  const cp = cur(state);
  const list = legalActions(state, cp.id);
  for (const a of list) {
    const action = { ...a };
    delete action.label;
    const isRoll = action.type === 'roll';

    // oferecer propriedade abre um seletor em vez de falhar
    if (action.type === 'offerAuction') {
      const owned = Object.keys(state.props)
        .filter((i) => state.props[i].owner === cp.id)
        .map(Number);
      if (!owned.length) continue; // sem propriedades: só resta "não leiloar"
      const b = mkBtn(a.label, () => modalPickOwned(owned, cp), 'btn');
      el.appendChild(b);
      continue;
    }

    const b = mkBtn(a.label, isRoll ? rollDice : () => act(action, cp.id), isRoll ? 'btn primary' : 'btn');
    if (action.type === 'buy') b.classList.add('primary');
    el.appendChild(b);
  }

  // construir / vender (painel)
  const owned = Object.keys(state.props)
    .filter((i) => state.props[i].owner === cp.id)
    .map(Number);
  if (owned.length && !state.pending && !state.jailAction) {
    const bBuild = mkBtn('🏠 Construir', () => modalManage('build'));
    const canAnyBuild = owned.some((i) => !buildBlocker(state, cp.id, i));
    bBuild.disabled = !canAnyBuild;
    el.appendChild(bBuild);

    const bSell = mkBtn('💸 Vender', () => modalManage('sell'));
    el.appendChild(bSell);
  }
}

function renderLog() {
  const el = $('#log');
  el.innerHTML = '';
  for (const line of state.log.slice(-60)) {
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
  if (!state || busy) return;
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

// --- Ficha da propriedade ---
function modalProperty(idx) {
  const sp = state.cfg.board[idx];
  const cp = cur(state);
  const own = state.props[idx];

  if (sp.type === 'lucky' || sp.type === 'start' || sp.type === 'jail' || sp.type === 'auction') {
    openModal(`
      <h2>${nameOf(sp)}</h2>
      <div class="sub">${spDesc(sp)}</div>
      <div class="m-actions">${'<button class="btn btn-secondary" onclick="window.__closeModal()">Fechar</button>'}</div>
    `);
    window.__closeModal = closeModal;
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
      <tr><td>Custo da construção</td><td>${fmt(state.cfg.buildingCostByGroup[sp.group])}</td></tr>`;
  } else {
    rows = `
      <tr><td>Aluguel (1 pública)</td><td>${fmt(state.cfg.publicRentBase)}</td></tr>
      <tr><td>Aluguel (2 públicas)</td><td>${fmt(state.cfg.publicRentBase * 2)}</td></tr>
      <tr><td>Aluguel (3 públicas)</td><td>${fmt(state.cfg.publicRentBase * 3)}</td></tr>
      <tr><td>Aluguel (4 públicas)</td><td>${fmt(state.cfg.publicRentBase * 4)}</td></tr>`;
  }

  const ownerName = own ? state.players.find((p) => p.id === own.owner).name : null;

  // botões contextuais
  const buttons = [];
  if (state.pending?.type === 'buy' && state.pending.space === idx && !state.over) {
    buttons.push(`<button class="btn btn-primary" data-act="buy">Comprar por ${fmt(sp.price)}</button>`);
    buttons.push(`<button class="btn btn-secondary" data-act="decline">Não comprar</button>`);
  }
  if (own && own.owner === cp.id && !state.pending && !state.over) {
    const blocker = sp.type === 'city' ? buildBlocker(state, cp.id, idx) : 'n/a';
    if (sp.type === 'city')
      buttons.push(
        blocker
          ? `<button class="btn" disabled>🏠 Construir (${blocker})</button>`
          : `<button class="btn btn-primary" data-act="build">🏠 Construir por ${fmt(state.cfg.buildingCostByGroup[sp.group])}</button>`
      );
    buttons.push(`<button class="btn btn-secondary" data-act="sell">💸 Vender por ${fmt(sellValue(state, cp.id, idx))}</button>`);
  }
  buttons.push(`<button class="btn btn-secondary" data-act="close">Fechar</button>`);

  const m = openModal(`
    ${sp.type === 'city' ? `<div class="group-band" style="background:${state.cfg.groups[sp.group].color}"></div>` : ''}
    <h2>${sp.name}</h2>
    <div class="sub">${spDesc(sp)}${ownerName ? ` • Dono: <b>${ownerName}</b>${own.buildings ? ` • ${own.buildings} construção(ões)` : ''}` : ' • Sem dono'}</div>
    <table>${rows}</table>
    <div class="m-actions">${buttons.join('')}</div>
  `);

  window.__closeModal = closeModal;
  m.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const act2 = b.dataset.act;
      if (act2 === 'close') return closeModal();
      closeModal();
      await act({ type: act2, space: idx });
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
function modalManage(mode) {
  const cp = cur(state);
  const owned = Object.keys(state.props)
    .filter((i) => state.props[i].owner === cp.id)
    .map(Number);
  const items = owned.map((idx) => {
    const sp = state.cfg.board[idx];
    const own = state.props[idx];
    let label = sp.name;
    let disabled = false;
    let hint = '';
    if (mode === 'build') {
      const blocker = sp.type === 'city' ? buildBlocker(state, cp.id, idx) : 'n/a';
      disabled = !!blocker;
      hint = sp.type === 'city'
        ? (blocker || `Construções: ${own.buildings}/3`)
        : 'Só cidades';
    } else {
      hint = `Recebe ${fmt(sellValue(state, cp.id, idx))}`;
      label = sp.name + (own.buildings ? ` (${own.buildings}🏗)` : '');
    }
    return { idx, label, hint, disabled };
  });

  const m = openModal(`
    <h2>${mode === 'build' ? '🏠 Construir' : '💸 Vender'}</h2>
    <div class="sub">${mode === 'build'
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
  window.__closeModal = closeModal;
  m.querySelectorAll('.prop-btn:not([disabled])').forEach((b) => {
    b.onclick = async () => {
      closeModal();
      await act({ type: mode, space: Number(b.dataset.idx) });
    };
  });
}

// --- Escolher propriedade própria (para oferecer no leilão) ---
function modalPickOwned(owned, player) {
  const m = openModal(`
    <h2>Leilão — ${player.name}</h2>
    <div class="note">Escolha uma das SUAS propriedades para colocar na mesa de trocas.
      Se fechar uma troca, ambos ganham $100.</div>
    <div class="prop-grid">
      ${owned.map((idx) => {
        const sp = state.cfg.board[idx];
        const own = state.props[idx];
        return `<button class="prop-btn" data-idx="${idx}">
          ${sp.name}<small>${own.buildings ? own.buildings + '🏗 • ' : ''}${fmt(sp.price)}</small>
        </button>`;
      }).join('')}
    </div>
    <div class="m-actions"><button class="btn btn-secondary" onclick="window.__closeModal()">Cancelar</button></div>
  `);
  window.__closeModal = closeModal;
  m.querySelectorAll('.prop-btn').forEach((b) => {
    b.onclick = async () => {
      closeModal();
      await act({ type: 'offerAuction', space: Number(b.dataset.idx) });
    };
  });
}

// --- Leilão: outro jogador oferece ---
function modalPledge(player) {
  return new Promise((resolve) => {
    const owned = Object.keys(state.props)
      .filter((i) => state.props[i].owner === player.id)
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
          const sp = state.cfg.board[idx];
          const own = state.props[idx];
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

// --- Leilão: ofertante aceita ou cancela ---
function modalOffers(pending, onAccept, onCancel) {
  const offerer = cur(state);
  const spMine = state.cfg.board[pending.space];
  const rows = pending.offers.map((o) => {
    const p = state.players.find((x) => x.id === o.playerId);
    const sp = state.cfg.board[o.space];
    const own = state.props[o.space];
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
