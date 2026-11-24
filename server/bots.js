// ============================================================
// IA DOS BOTS — heurística simples e funcional.
// botAction: decisão para o bot da vez.
// autoAction: ação de segurança (jogador AFK/desconectado).
// ============================================================

import { cur, buildBlocker } from '../shared/engine.js';

function ownedIdxs(st, pid) {
  return Object.keys(st.props)
    .filter((i) => st.props[i].owner === pid)
    .map(Number);
}

export function botAction(st) {
  if (!st || st.over) return null;
  const bot = cur(st);

  // ---- leilão ----
  if (st.pending?.type === 'auction') {
    if (st.pending.space === null) {
      const owned = ownedIdxs(st, bot.id)
        .sort((a, b) => st.cfg.board[a].price - st.cfg.board[b].price);
      if (owned.length && Math.random() < 0.6) {
        return { type: 'offerAuction', space: owned[0] }; // oferece a mais barata
      }
      return { type: 'skipAuction' };
    }
    if (st.pending.offers.length) {
      const minePrice = st.cfg.board[st.pending.space].price;
      const good = st.pending.offers.find(
        (o) => st.cfg.board[o.space].price >= minePrice - 40
      );
      if (good && Math.random() < 0.7) {
        return { type: 'acceptTrade', playerId: good.playerId };
      }
      return { type: 'cancelAuction' };
    }
    return null; // aguardando ofertas — tenta de novo depois
  }

  // ---- cadeia ----
  if (st.jailAction === 'choose') {
    return bot.cash >= 400 ? { type: 'payJail' } : { type: 'stayJail' };
  }
  if (st.jailAction === 'done') return { type: 'endTurn' };

  // ---- compra pendente ----
  if (st.pending?.type === 'buy') {
    const sp = st.cfg.board[st.pending.space];
    return bot.cash - sp.price >= 120 ? { type: 'buy' } : { type: 'decline' };
  }

  // ---- construir (mais barata primeiro, guardando caixa) ----
  const owned = ownedIdxs(st, bot.id).sort(
    (a, b) => st.cfg.board[a].price - st.cfg.board[b].price
  );
  for (const idx of owned) {
    const blocker = buildBlocker(st, bot.id, idx);
    if (!blocker) {
      const cost = st.cfg.buildingCostByGroup[st.cfg.board[idx].group];
      if (bot.cash - cost >= 150) return { type: 'build', space: idx };
    }
  }

  // ---- vender se apertado ----
  if (bot.cash < 60 && owned.length) {
    return { type: 'sell', space: owned[owned.length - 1] };
  }

  if (st.phase === 'start') return { type: 'roll' };
  return { type: 'endTurn' };
}

// Ação de segurança: mantém o jogo andando sem decisões agressivas
export function autoAction(st) {
  if (!st || st.over) return null;
  if (st.pending?.type === 'buy') return { type: 'decline' };
  if (st.pending?.type === 'auction') {
    if (st.pending.space === null) return { type: 'skipAuction' };
    return { type: 'cancelAuction' };
  }
  if (st.jailAction === 'choose') return { type: 'stayJail' };
  return { type: 'endTurn' };
}
