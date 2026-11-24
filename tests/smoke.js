// ============================================================
// Teste de fumaça da engine: simula milhares de ações aleatórias
// e verifica invariantes básicas. Rode com: npm test
// ============================================================

import { createGame, applyAction, legalActions, netWorth, buildBlocker, sellValue } from '../shared/engine.js';

const CFG = { goal: 3000, maxRounds: 0 };

function assert(cond, msg) {
  if (!cond) {
    console.error('❌ FALHOU:', msg);
    process.exit(1);
  }
}

function invariants(st, step) {
  for (const p of st.players) {
    assert(Number.isFinite(p.cash), `caixa inválida no passo ${step}`);
    assert(!Number.isNaN(p.position), `posição NaN no passo ${step}`);
    assert(p.position >= 0 && p.position < st.cfg.board.length, `posição fora do tabuleiro no passo ${step}`);
  }
  for (const [idx, own] of Object.entries(st.props)) {
    assert(st.players.some((p) => p.id === own.owner), `dono inexistente no passo ${step} (casa ${idx})`);
    assert(own.buildings >= 0 && own.buildings <= 3, `construções inválidas no passo ${step}`);
  }
  assert(Number.isFinite(netWorth(st, st.players[0].id)), 'patrimônio inválido');
}

function randomAction(st) {
  const curP = st.players[st.turnIdx];

  // leilão: simular fluxo de troca aleatório
  if (st.pending?.type === 'auction') {
    if (st.pending.space === null) {
      const owned = Object.keys(st.props).filter((i) => st.props[i].owner === curP.id);
      if (owned.length && Math.random() < 0.7) {
        return { pid: curP.id, action: { type: 'offerAuction', space: Number(owned[0]) } };
      }
      return { pid: curP.id, action: { type: 'skipAuction' } };
    }
    if (st.pending.offers.length) {
      if (Math.random() < 0.6) {
        const offer = st.pending.offers[Math.floor(Math.random() * st.pending.offers.length)];
        return { pid: curP.id, action: { type: 'acceptTrade', playerId: offer.playerId } };
      }
      return { pid: curP.id, action: { type: 'cancelAuction' } };
    }
    // outro jogador oferece
    const others = st.players.filter(
      (p) => !p.bankrupt && p.id !== curP.id &&
        Object.values(st.props).some((o) => o.owner === p.id)
    );
    if (others.length && Math.random() < 0.8) {
      const o = others[Math.floor(Math.random() * others.length)];
      const theirs = Object.keys(st.props).filter((i) => st.props[i].owner === o.id);
      return { pid: o.id, action: { type: 'pledge', space: Number(theirs[0]) } };
    }
    return { pid: curP.id, action: { type: 'cancelAuction' } };
  }

  // construção/venda ocasionais
  if (st.phase !== 'over' && Math.random() < 0.25) {
    const owned = Object.keys(st.props).filter((i) => st.props[i].owner === curP.id);
    if (owned.length) {
      const idx = Number(owned[Math.floor(Math.random() * owned.length)]);
      if (!buildBlocker(st, curP.id, idx)) {
        return { pid: curP.id, action: { type: 'build', space: idx } };
      }
      if (Math.random() < 0.3 && sellValue(st, curP.id, idx) > 0) {
        return { pid: curP.id, action: { type: 'sell', space: idx } };
      }
    }
  }

  const list = legalActions(st, curP.id);
  if (!list.length) return null;
  const act = list[Math.floor(Math.random() * list.length)];
  const action = { ...act };
  delete action.label;
  return { pid: curP.id, action };
}

// ---------- 1. criação ----------
const defs = [
  { name: 'Ana' }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Diego' },
];
let st = createGame(CFG, defs);
assert(st.players.length === 4, '4 jogadores criados');
assert(st.players[1].cash === st.players[0].cash + 100, 'bônus do 2º jogador');
assert(st.players[3].cash === st.players[0].cash + 300, 'bônus do 4º jogador');

// ---------- 2. simulação longa aleatória ----------
let steps = 0;
const MAX = 200000;
while (!st.over && steps < MAX) {
  const pick = randomAction(st);
  if (!pick) { console.error('❌ sem ações legais com partida em aberto'); process.exit(1); }
  const res = applyAction(st, pick.pid, pick.action);
  assert(res.ok, `ação falhou no passo ${steps}: ${res.error} (ação: ${JSON.stringify(pick.action)})`);
  st = res.state;
  invariants(st, steps);
  steps++;
}

assert(st.over, `partida terminou dentro de ${MAX} passos (passos: ${steps})`);
assert(st.winner !== null, 'existe vencedor');
console.log(`✅ Partida encerrou em ${steps} passos. Vencedor: ${st.players.find((p) => p.id === st.winner).name}`);
console.log(`   Rodadas: ${st.round} | Patrimônios: ${st.players.map((p) => `${p.name}=${p.bankrupt ? 'FUWI' : netWorth(st, p.id)}`).join(', ')}`);

// ---------- 3. regras pontuais ----------
// aluguel com monopólio dobra
let st2 = createGame({ goal: 99999, maxRounds: 0 }, [{ name: 'A' }, { name: 'B' }]);
st2.props[1] = { owner: 'p0', buildings: 0 };
st2.props[2] = { owner: 'p0', buildings: 0 };
// Bangkok (14) e Madrid (18) — monopólio brown → aluguel dobrado
import { rentOf } from '../shared/engine.js';
assert(rentOf(st2, 1) === 14 * 2, 'monopólio dobra aluguel sem construções');
st2.props[1].buildings = 1;
assert(rentOf(st2, 1) === 14 * 3, '1 construção multiplica por 3');
st2.props[1].buildings = 3;
assert(rentOf(st2, 1) === 14 * 12, '3 construções multiplicam por 12');

// pública: aluguel × quantidade
st2.props[3] = { owner: 'p0', buildings: 0 };
st2.props[13] = { owner: 'p0', buildings: 0 };
assert(rentOf(st2, 3) === 50 * 2, 'pública: aluguel × nº de públicas');

console.log('✅ Todos os testes passaram!');
