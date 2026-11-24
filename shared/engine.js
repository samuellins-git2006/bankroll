// ============================================================
// ENGINE DE REGRAS — módulo puro (sem rede, sem DOM)
// O estado é clonado a cada ação; nada é mutado no original.
// Usada pelo cliente (hotseat) e depois pelo servidor multiplayer.
// ============================================================

import { CONFIG } from './config.js';

// ---------- utilitários ----------
const rnd6 = () => 1 + Math.floor(Math.random() * 6);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const cur = (st) => st.players[st.turnIdx];
export const alivePlayers = (st) => st.players.filter((p) => !p.bankrupt);
export const boardSpace = (st, i) => st.cfg.board[i];

export function groupIndices(st, group) {
  const out = [];
  st.cfg.board.forEach((sp, i) => {
    if (sp.type === 'city' && sp.group === group) out.push(i);
  });
  return out;
}

export function jailIndex(st) {
  return st.cfg.board.findIndex((sp) => sp.type === 'jail');
}

export function ownsWholeGroup(st, pid, group) {
  return groupIndices(st, group).every((i) => st.props[i]?.owner === pid);
}

export function publicCount(st, pid) {
  return st.cfg.board.filter(
    (sp, i) => sp.type === 'public' && st.props[i]?.owner === pid
  ).length;
}

// ---------- valores ----------
export function netWorth(st, pid) {
  const p = st.players.find((x) => x.id === pid);
  if (!p) return 0;
  let total = p.cash;
  for (const [idx, own] of Object.entries(st.props)) {
    if (own.owner !== pid) continue;
    const sp = st.cfg.board[idx];
    total += sp.price;
    if (sp.type === 'city') {
      total += own.buildings * st.cfg.buildingCostByGroup[sp.group];
    }
  }
  return total;
}

export function rentOf(st, idx) {
  const own = st.props[idx];
  const sp = st.cfg.board[idx];
  if (!own) return 0;

  if (sp.type === 'public') {
    return st.cfg.publicRentBase * publicCount(st, own.owner);
  }

  const b = own.buildings;
  if (b > 0) return sp.rent * st.cfg.rentMultipliers[b];
  if (ownsWholeGroup(st, own.owner, sp.group)) {
    return sp.rent * st.cfg.monopolyMultiplier;
  }
  return sp.rent;
}

// Construir: retorna null se possível, ou o motivo do bloqueio
export function buildBlocker(st, pid, idx) {
  const p = st.players.find((x) => x.id === pid);
  const sp = st.cfg.board[idx];
  const own = st.props[idx];
  if (!p || p.bankrupt) return 'Jogador inválido';
  if (sp.type !== 'city') return 'Só cidades recebem construções';
  if (!own || own.owner !== pid) return 'Você não é o dono';
  if (!ownsWholeGroup(st, pid, sp.group))
    return 'Você precisa de todas as cidades da cor';
  if (own.buildings >= 3) return 'Máximo de 3 construções';
  const cost = st.cfg.buildingCostByGroup[sp.group];
  if (p.cash < cost) return `Sem dinheiro ($${cost})`;
  return null;
}

// Vender: valor devolvido
export function sellValue(st, pid, idx) {
  const sp = st.cfg.board[idx];
  const own = st.props[idx];
  if (!own || own.owner !== pid) return 0;
  let invested = sp.price;
  if (sp.type === 'city') {
    invested += own.buildings * st.cfg.buildingCostByGroup[sp.group];
  }
  return Math.round(invested * st.cfg.sellRate);
}

// ============================================================
// CRIAÇÃO DA PARTIDA
// ============================================================
export function createGame(cfgOverrides = {}, playerDefs = []) {
  const cfg = { ...CONFIG, ...cfgOverrides };
  if (playerDefs.length < 2 || playerDefs.length > 4)
    throw new Error('A partida precisa de 2 a 4 jogadores.');

  const st = {
    cfg,
    players: playerDefs.map((def, i) => ({
      id: 'p' + i,
      name: (def.name || '').trim() || 'Jogador ' + (i + 1),
      color: cfg.playerColors[i % cfg.playerColors.length],
      cash: cfg.startCash + i * cfg.laterBonus,
      position: 0,
      jailTurns: 0,
      jailAction: null, // 'choose' | 'done' | null
      bankrupt: false,
    })),
    props: {},          // idx -> { owner, buildings }
    turnIdx: 0,
    phase: 'start',     // 'start' | 'post' | 'over'
    dice: null,
    reroll: false,      // tirou 6, joga de novo
    round: 1,
    goal: cfg.goal,
    maxRounds: cfg.maxRounds, // 0 = ilimitado
    deck: shuffle(cfg.luckyCards.slice()),
    deckIdx: 0,
    pending: null, // {type:'buy', space} | {type:'auction', space, offers}
    log: [],
    winner: null,
    over: false,
  };

  st.players.forEach((p) => addLog(st, `${p.name} começa com $${p.cash}.`));
  addLog(st, `— Vez de ${cur(st).name} —`);
  return st;
}

function addLog(st, msg) {
  st.log.push(msg);
}

// ============================================================
// EVENTOS INTERNOS
// ============================================================
function checkBankrupt(st, p, events) {
  if (p.bankrupt || st.over) return;
  if (
    p.cash < st.cfg.bankruptCashLimit ||
    netWorth(st, p.id) <= st.cfg.bankruptWorthLimit
  ) {
    p.bankrupt = true;
    addLog(st, `💥 ${p.name} FALIU! Suas propriedades voltam ao banco.`);
    events.push({ type: 'bankrupt', player: p.id });
    // devolve propriedades ao banco
    for (const [idx, own] of Object.entries(st.props)) {
      if (own.owner === p.id) delete st.props[idx];
    }
    const alive = alivePlayers(st);
    if (alive.length === 1) {
      st.over = true;
      st.winner = alive[0].id;
      addLog(st, `🏆 ${alive[0].name} venceu a partida!`);
      events.push({ type: 'win', player: alive[0].id });
    }
  }
}

function checkWin(st, events) {
  if (st.over) return;
  for (const p of alivePlayers(st)) {
    if (netWorth(st, p.id) >= st.goal) {
      st.over = true;
      st.winner = p.id;
      addLog(st, `🏆 ${p.name} atingiu a meta de $${st.goal} e VENCEU!`);
      events.push({ type: 'win', player: p.id });
      return;
    }
  }
}

function checkMoney(st, p, events) {
  checkBankrupt(st, p, events);
  checkWin(st, events);
}

function transfer(st, fromId, toId, amount, events, label) {
  if (amount <= 0) return;
  const from = st.players.find((x) => x.id === fromId);
  const to = st.players.find((x) => x.id === toId);
  from.cash -= amount;
  to.cash += amount;
  addLog(st, `${from.name} pagou $${amount} (${label}) para ${to.name}.`);
  events.push({ type: 'money', from: fromId, to: toId, amount });
  checkMoney(st, from, events);
  checkMoney(st, to, events);
}

function sendJail(st, p, events) {
  p.position = jailIndex(st);
  p.jailTurns = st.cfg.jailTurns;
  p.jailAction = null;
  st.reroll = false; // preso não reaproveita o 6
  events.push({ type: 'jail', player: p.id });
}

function moveSteps(st, p, steps, events) {
  const len = st.cfg.board.length;
  const target = p.position + steps;
  if (steps > 0 && target >= len) {
    p.cash += st.cfg.salary;
    addLog(st, `${p.name} passou pelo Início e recebeu $${st.cfg.salary}.`);
    events.push({ type: 'salary', player: p.id, amount: st.cfg.salary });
  }
  p.position = ((target % len) + len) % len;
  events.push({ type: 'move', player: p.id, position: p.position });
  checkMoney(st, p, events);
}

function goTo(st, p, space, events) {
  if (space === 0 && p.position > 0) {
    p.cash += st.cfg.salary;
    addLog(st, `${p.name} passou pelo Início e recebeu $${st.cfg.salary}.`);
    events.push({ type: 'salary', player: p.id, amount: st.cfg.salary });
  }
  p.position = space;
  events.push({ type: 'move', player: p.id, position: p.position });
  checkMoney(st, p, events);
}

// ============================================================
// RESOLUÇÃO DA CASA ONDE PAROU
// ============================================================
function resolveLanding(st, events, depth) {
  const p = cur(st);
  const sp = st.cfg.board[p.position];

  switch (sp.type) {
    case 'start':
      break;

    case 'city':
    case 'public': {
      const own = st.props[p.position];
      if (!own) {
        if (p.cash >= sp.price) {
          st.pending = { type: 'buy', space: p.position };
          events.push({ type: 'offer', space: p.position });
        } else {
          addLog(st, `${p.name} não tem dinheiro para comprar ${sp.name}.`);
        }
      } else if (own.owner !== p.id) {
        const rent = rentOf(st, p.position);
        transfer(st, p.id, own.owner, rent, events, `aluguel de ${sp.name}`);
      } else {
        addLog(st, `${p.name} chegou à própria propriedade (${sp.name}).`);
      }
      break;
    }

    case 'lucky':
      if (depth <= 2) drawLucky(st, events, depth);
      break;

    case 'auction':
      st.pending = { type: 'auction', space: null, offers: [] };
      addLog(st, `${p.name} abriu uma mesa de trocas (Leilão).`);
      events.push({ type: 'auction' });
      break;

    case 'jail':
      sendJail(st, p, events);
      addLog(
        st,
        `${p.name} foi preso por ${st.cfg.jailTurns} turnos (ou pague $${st.cfg.jailFine} para sair).`
      );
      break;
  }
}

function drawLucky(st, events, depth) {
  const p = cur(st);
  const card = st.deck[st.deckIdx % st.deck.length];
  st.deckIdx++;
  events.push({ type: 'lucky', card, player: p.id });
  addLog(st, `🍀 ${p.name} tirou "${card.title}": ${card.desc}`);

  const e = card.effect;
  switch (e.type) {
    case 'money': {
      p.cash += e.amount;
      checkMoney(st, p, events);
      break;
    }
    case 'payPerPlayer': {
      const others = alivePlayers(st).filter((x) => x.id !== p.id);
      if (e.amount > 0) {
        for (const o of others) transfer(st, p.id, o.id, e.amount, events, card.title);
      } else {
        for (const o of others) transfer(st, o.id, p.id, -e.amount, events, card.title);
      }
      break;
    }
    case 'goto': {
      goTo(st, p, e.space, events);
      resolveLanding(st, events, depth + 1);
      break;
    }
    case 'move': {
      moveSteps(st, p, e.steps, events);
      resolveLanding(st, events, depth + 1);
      break;
    }
    case 'jail': {
      sendJail(st, p, events);
      addLog(st, `${p.name} foi preso!`);
      break;
    }
  }
}

// ============================================================
// AÇÕES
// ============================================================
function doRoll(st, p, events) {
  if (st.phase !== 'start') throw new Error('Você já rolou o dado neste turno.');
  if (st.jailAction) throw new Error('Resolva a situação na cadeia primeiro.');
  if (st.pending) throw new Error('Resolva a pendência atual primeiro.');

  const dice = rnd6();
  st.dice = dice;
  st.reroll = dice === 6;
  events.push({ type: 'roll', dice, player: p.id });
  addLog(st, `🎲 ${p.name} tirou ${dice}.${dice === 6 ? ' Joga novamente!' : ''}`);

  moveSteps(st, p, dice, events);
  if (st.over) return;
  resolveLanding(st, events, 0);
  st.phase = 'post';
}

function doBuy(st, p, events) {
  if (st.pending?.type !== 'buy') throw new Error('Nada para comprar.');
  const sp = st.cfg.board[st.pending.space];
  if (p.cash < sp.price) throw new Error('Dinheiro insuficiente.');
  p.cash -= sp.price;
  st.props[st.pending.space] = { owner: p.id, buildings: 0 };
  addLog(st, `${p.name} comprou ${sp.name} por $${sp.price}.`);
  events.push({ type: 'buy', space: st.pending.space, player: p.id, price: sp.price });
  st.pending = null;
  checkWin(st, events);
}

function doBuild(st, p, idx, events) {
  if (st.phase === 'over') throw new Error('A partida terminou.');
  const blocker = buildBlocker(st, p.id, idx);
  if (blocker) throw new Error(blocker);
  const sp = st.cfg.board[idx];
  const cost = st.cfg.buildingCostByGroup[sp.group];
  p.cash -= cost;
  st.props[idx].buildings++;
  addLog(
    st,
    `🏠 ${p.name} construiu em ${sp.name} (${st.props[idx].buildings}ª construção, -$${cost}).`
  );
  events.push({ type: 'build', space: idx, player: p.id });
  checkWin(st, events);
}

function doSell(st, p, idx, events) {
  const own = st.props[idx];
  if (!own || own.owner !== p.id) throw new Error('Você não é o dono dessa propriedade.');
  const sp = st.cfg.board[idx];
  const value = sellValue(st, p.id, idx);
  delete st.props[idx];
  p.cash += value;
  addLog(st, `${p.name} vendeu ${sp.name} ao banco por $${value}.`);
  events.push({ type: 'sell', space: idx, player: p.id, value });
  checkMoney(st, p, events);
}

function doPayJail(st, p, events) {
  if (st.jailAction !== 'choose') throw new Error('Você não está decidindo a cadeia.');
  if (p.cash < st.cfg.jailFine) throw new Error('Dinheiro insuficiente para a fiança.');
  p.cash -= st.cfg.jailFine;
  p.jailTurns = 0;
  p.jailAction = null;
  addLog(st, `${p.name} pagou $${st.cfg.jailFine} e saiu da cadeia.`);
  events.push({ type: 'money', player: p.id, amount: -st.cfg.jailFine });
  checkMoney(st, p, events);
}

function doStayJail(st, p, events) {
  if (st.jailAction !== 'choose') throw new Error('Você não está decidindo a cadeia.');
  p.jailTurns--;
  if (p.jailTurns <= 0) {
    p.jailTurns = 0;
    p.jailAction = null;
    addLog(st, `${p.name} cumpriu a pena e sai da cadeia.`);
  } else {
    p.jailAction = 'done';
    addLog(st, `${p.name} fica preso (faltam ${p.jailTurns} turnos).`);
  }
}

function doOfferAuction(st, p, idx, events) {
  if (st.pending?.type !== 'auction') throw new Error('Nenhum leilão aberto.');
  if (st.pending.space !== null) throw new Error('Propriedade já oferecida.');
  const own = st.props[idx];
  if (!own || own.owner !== p.id) throw new Error('Escolha uma propriedade SUA.');
  const sp = st.cfg.board[idx];
  st.pending.space = idx;
  addLog(st, `${p.name} ofereceu ${sp.name} em troca.`);
  events.push({ type: 'auctionOffer', space: idx, player: p.id });
}

function doPledge(st, p, idx, events) {
  if (st.pending?.type !== 'auction' || st.pending.space === null)
    throw new Error('Nenhuma troca em andamento.');
  const own = st.props[idx];
  if (!own || own.owner !== p.id) throw new Error('Escolha uma propriedade SUA.');
  st.pending.offers = st.pending.offers.filter((o) => o.playerId !== p.id);
  st.pending.offers.push({ playerId: p.id, space: idx });
  addLog(st, `${p.name} ofereceu ${st.cfg.board[idx].name} em troca.`);
  events.push({ type: 'pledge', space: idx, player: p.id });
}

function doAcceptTrade(st, p, otherId, events) {
  if (st.pending?.type !== 'auction' || st.pending.space === null)
    throw new Error('Nenhum leilão em andamento.');
  const offer = st.pending.offers.find((o) => o.playerId === otherId);
  if (!offer) throw new Error('Oferta não encontrada.');

  const other = st.players.find((x) => x.id === otherId);
  const mine = st.props[st.pending.space];
  const theirs = st.props[offer.space];
  if (mine) mine.owner = other.id;
  if (theirs) theirs.owner = p.id;

  p.cash += st.cfg.auctionBonus;
  other.cash += st.cfg.auctionBonus;
  addLog(
    st,
    `🤝 ${p.name} trocou ${st.cfg.board[st.pending.space].name} por ${st.cfg.board[offer.space].name} com ${other.name}. Ambos ganham $${st.cfg.auctionBonus}!`
  );
  events.push({
    type: 'trade',
    a: p.id,
    b: otherId,
    aSpace: st.pending.space,
    bSpace: offer.space,
  });
  st.pending = null;
  checkMoney(st, p, events);
  checkMoney(st, other, events);
}

function doEndTurn(st, p, events) {
  if (st.pending) throw new Error('Resolva a pendência antes de encerrar.');

  if (st.jailAction === 'done') {
    st.jailAction = null;
    advanceTurn(st, events);
    return;
  }

  if (st.reroll) {
    st.reroll = false;
    st.phase = 'start';
    st.dice = null;
    addLog(st, `${p.name} joga novamente.`);
    return;
  }

  advanceTurn(st, events);
}

function advanceTurn(st, events) {
  const n = st.players.length;
  let next = st.turnIdx;
  for (let i = 1; i <= n; i++) {
    const idx = (st.turnIdx + i) % n;
    if (!st.players[idx].bankrupt) {
      next = idx;
      break;
    }
  }
  if (next < st.turnIdx) {
    st.round++;
    addLog(st, `— Rodada ${st.round} —`);
  }
  st.turnIdx = next;
  st.phase = 'start';
  st.dice = null;
  st.reroll = false;

  const np = cur(st);
  if (np.jailTurns > 0) np.jailAction = 'choose';
  addLog(st, `— Vez de ${np.name} —`);

  checkRoundLimit(st, events);
}

function checkRoundLimit(st, events) {
  if (st.over || st.maxRounds <= 0) return;
  if (st.round > st.maxRounds) {
    st.over = true;
    const ranking = alivePlayers(st).sort((a, b) => netWorth(st, b.id) - netWorth(st, a.id));
    st.winner = ranking[0]?.id ?? null;
    addLog(st, `⏰ Fim das ${st.maxRounds} rodadas! Maior patrimônio vence.`);
    if (st.winner) addLog(st, `🏆 ${st.players.find((p) => p.id === st.winner).name} venceu a partida!`);
    events.push({ type: 'win', player: st.winner });
  }
}

// ============================================================
// API PÚBLICA
// ============================================================
export function applyAction(stIn, pid, action) {
  let st;
  try {
    st = structuredClone(stIn);
    const events = [];
    const p = st.players.find((x) => x.id === pid);
    if (!p) throw new Error('Jogador inválido.');
    if (st.over) throw new Error('A partida já terminou.');

    const curP = cur(st);
    const isCur = p.id === curP.id;
    const a = action.type;

    // durante leilão, outros jogadores podem oferecer troca
    if (st.pending?.type === 'auction' && !isCur) {
      if (a !== 'pledge') throw new Error('Aguarde a resolução do leilão.');
      doPledge(st, p, action.space, events);
      return { ok: true, state: st, events };
    }

    if (!isCur) throw new Error('Não é sua vez.');

    switch (a) {
      case 'roll':          doRoll(st, p, events); break;
      case 'buy':           doBuy(st, p, events); break;
      case 'decline':
        if (st.pending?.type !== 'buy') throw new Error('Nada para recusar.');
        st.pending = null;
        break;
      case 'build':         doBuild(st, p, action.space, events); break;
      case 'sell':          doSell(st, p, action.space, events); break;
      case 'endTurn':       doEndTurn(st, p, events); break;
      case 'payJail':       doPayJail(st, p, events); break;
      case 'stayJail':      doStayJail(st, p, events); break;
      case 'offerAuction':  doOfferAuction(st, p, action.space, events); break;
      case 'skipAuction':
        if (st.pending?.type !== 'auction' || st.pending.space !== null)
          throw new Error('Nenhum leilão para ignorar.');
        st.pending = null;
        addLog(st, `${p.name} não quis leiloar.`);
        break;
      case 'cancelAuction':
        if (st.pending?.type !== 'auction') throw new Error('Nenhum leilão aberto.');
        st.pending = null;
        addLog(st, `${p.name} cancelou o leilão.`);
        break;
      case 'acceptTrade':   doAcceptTrade(st, p, action.playerId, events); break;
      default: throw new Error('Ação desconhecida: ' + a);
    }

    // jogador atual faliu no próprio turno → passa a vez
    if (!st.over && cur(st).bankrupt) {
      st.pending = null;
      advanceTurn(st, events);
    }

    return { ok: true, state: st, events };
  } catch (err) {
    return { ok: false, error: err.message, state: stIn };
  }
}

// Ações principais disponíveis (para montar a UI)
export function legalActions(st, pid) {
  if (st.over) return [];
  const p = st.players.find((x) => x.id === pid);
  if (!p || p.bankrupt) return [];
  const curP = cur(st);
  const isCur = p.id === curP.id;
  const list = [];
  const board = st.cfg.board;

  // pendência de leilão
  if (st.pending?.type === 'auction') {
    if (isCur) {
      if (st.pending.space === null) {
        list.push({ type: 'offerAuction', label: 'Oferecer propriedade' });
        list.push({ type: 'skipAuction', label: 'Não leiloar' });
      } else {
        for (const o of st.pending.offers) {
          list.push({
            type: 'acceptTrade',
            playerId: o.playerId,
            label: `Aceitar: minha ${board[st.pending.space].name} ⇄ ${board[o.space].name} de ${st.players.find((x) => x.id === o.playerId).name}`,
          });
        }
        list.push({ type: 'cancelAuction', label: 'Cancelar leilão' });
      }
    } else if (st.pending.space !== null) {
      list.push({ type: 'pledge', label: 'Oferecer troca' });
    }
    return list;
  }

  if (!isCur) return list;

  // pendência de compra — precisa decidir antes de qualquer outra coisa
  if (st.pending?.type === 'buy') {
    const sp = board[st.pending.space];
    list.push({ type: 'buy', label: `Comprar ${sp.name} ($${sp.price})` });
    list.push({ type: 'decline', label: 'Não comprar' });
    return list;
  }

  // cadeia
  if (st.jailAction === 'choose') {
    list.push({ type: 'payJail', label: `Pagar $${st.cfg.jailFine} e sair` });
    list.push({ type: 'stayJail', label: 'Ficar preso' });
    return list;
  }
  if (st.jailAction === 'done') {
    list.push({ type: 'endTurn', label: 'Encerrar turno' });
    return list;
  }

  if (st.phase === 'start') list.push({ type: 'roll', label: '🎲 Rolar dado' });
  if (st.phase === 'post') list.push({ type: 'endTurn', label: 'Encerrar turno' });
  return list;
}
