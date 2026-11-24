// ============================================================
// RENDERIZAÇÃO DO TABULEIRO — Canvas 2D
// Tabuleiro 28 casas em anel 8×8. Casa 0 = canto inferior esquerdo,
// sentido horário. Exporta geometria para cliques no canvas.
// ============================================================

export const CELL = 72;
export const GRID = 8;
export const PAD = 14;
export const SIZE = GRID * CELL + PAD * 2;

// Converte índice da casa (0..27) em retângulo {x,y,w,h}
export function cellRect(i) {
  let x, y;
  if (i <= 7)        { x = i;      y = 7; }        // base → direita
  else if (i <= 14)  { x = 7;      y = 14 - i; }   // coluna direita ↑
  else if (i <= 21)  { x = 21 - i; y = 0; }        // topo ← esquerda
  else               { x = 0;      y = i - 21; }   // coluna esquerda ↓
  return {
    x: PAD + x * CELL,
    y: PAD + y * CELL,
    w: CELL,
    h: CELL,
    gx: x, gy: y,
  };
}

// Qual casa está sob o ponto lógico (px,py)?
export function hitIndex(px, py) {
  for (let i = 0; i < 28; i++) {
    const r = cellRect(i);
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return i;
  }
  return null;
}

const fmt = (n) => '$' + n.toLocaleString('pt-BR');

// ---------- desenho ----------
export function renderBoard(canvas, st) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== SIZE * dpr) {
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  // fundo
  roundRect(ctx, 0, 0, SIZE, SIZE, 14);
  ctx.fillStyle = '#f4eee0';
  ctx.fill();

  const cfg = st.cfg;

  for (let i = 0; i < cfg.board.length; i++) {
    drawCell(ctx, st, i);
  }

  drawCenter(ctx, st);
  drawTokens(ctx, st);
  drawHighlights(ctx, st);
}

function drawCell(ctx, st, i) {
  const sp = st.cfg.board[i];
  const r = cellRect(i);
  const cfg = st.cfg;

  // célula
  ctx.fillStyle = '#fbf7ec';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x + .75, r.y + .75, r.w - 1.5, r.h - 1.5);

  const isCorner = [0, 7, 14, 21].includes(i);

  // faixa de cor (na borda interna)
  if (sp.type === 'city') {
    const color = cfg.groups[sp.group].color;
    const band = 16;
    ctx.fillStyle = color;
    if (r.gy === 7)      ctx.fillRect(r.x, r.y, r.w, band);            // base: faixa no topo
    else if (r.gy === 0) ctx.fillRect(r.x, r.y + r.h - band, r.w, band); // topo: faixa embaixo
    else if (r.gx === 7) ctx.fillRect(r.x, r.y, band, r.h);            // direita: faixa à esquerda
    else                 ctx.fillRect(r.x + r.w - band, r.y, band, r.h); // esquerda: faixa à direita

    // construções (casinhas)
    const own = st.props[i];
    if (own && own.buildings > 0) {
      ctx.fillStyle = '#2e7d32';
      for (let b = 0; b < own.buildings; b++) {
        const bx = r.x + 6 + b * 13;
        const by = r.gy === 0 ? r.y + r.h - band + 2 : r.y + 2;
        ctx.fillRect(bx, by, 9, 9);
      }
    }
  }

  // textos
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const vertical = r.gx === 0 || r.gx === 7;

  if (vertical) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(r.gx === 7 ? -Math.PI / 2 : Math.PI / 2);
    drawCellText(ctx, sp, isCorner);
    ctx.restore();
  } else {
    drawCellText(ctx, sp, isCorner, cx, cy);
  }

  // marcador de dono
  const own = st.props[i];
  if (own) {
    const owner = st.players.find((p) => p.id === own.owner);
    if (owner) {
      const px = r.x + r.w - 9, py = r.y + 9;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = owner.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawCellText(ctx, sp, isCorner, cx, cy) {
  if (isCorner) {
    const icons = { start: '➡️', jail: '🔒', auction: '🔨', lucky: '🍀' };
    ctx.font = '26px sans-serif';
    if (cx !== undefined) ctx.fillText(icons[sp.type] || '', cx, cy - 10);
    else ctx.fillText(icons[sp.type] || '', 0, -10);
    ctx.font = 'bold 11px sans-serif';
    if (cx !== undefined) ctx.fillText(sp.name, cx, cy + 16);
    else ctx.fillText(sp.name, 0, 16);
    return;
  }

  if (sp.type === 'lucky') {
    ctx.font = '24px sans-serif';
    if (cx !== undefined) ctx.fillText('🍀', cx, cy - 6);
    else ctx.fillText('🍀', 0, -6);
    ctx.font = 'bold 10px sans-serif';
    if (cx !== undefined) ctx.fillText('Sorte', cx, cy + 14);
    else ctx.fillText('Sorte', 0, 14);
    return;
  }

  if (sp.type === 'public') {
    const icon = sp.name === 'Ferrovia' ? '🚆' : '✈️';
    ctx.font = '17px sans-serif';
    if (cx !== undefined) ctx.fillText(icon, cx, cy - 14);
    else ctx.fillText(icon, 0, -14);
    ctx.font = 'bold 9.5px sans-serif';
    if (cx !== undefined) ctx.fillText(sp.name, cx, cy + 4);
    else ctx.fillText(sp.name, 0, 4);
    ctx.font = '9px sans-serif';
    if (cx !== undefined) ctx.fillText(fmt(sp.price), cx, cy + 17);
    else ctx.fillText(fmt(sp.price), 0, 17);
    return;
  }

  // cidade
  ctx.font = 'bold 9.5px sans-serif';
  if (cx !== undefined) ctx.fillText(sp.name, cx, cy - 4);
  else ctx.fillText(sp.name, 0, -4);
  ctx.font = '9px sans-serif';
  if (cx !== undefined) ctx.fillText(fmt(sp.price), cx, cy + 12);
  else ctx.fillText(fmt(sp.price), 0, 12);
}

function drawCenter(ctx, st) {
  const x = PAD + CELL, y = PAD + CELL;
  const w = CELL * 6, h = CELL * 6;
  roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 12);
  ctx.fillStyle = '#182338';
  ctx.fill();
  ctx.strokeStyle = '#3a4c72';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // título
  ctx.fillStyle = '#f5b942';
  ctx.font = '800 44px sans-serif';
  ctx.fillText('BANK', x + w / 2, y + 64);
  ctx.fillStyle = '#fff';
  ctx.fillText('ROLL', x + w / 2, y + 112);

  // meta / rodada
  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = '#93a4c6';
  ctx.fillText(`Objetivo: ${fmt(st.goal)}`, x + w / 2, y + 164);
  ctx.fillText(
    st.maxRounds > 0 ? `Rodada ${st.round} / ${st.maxRounds}` : `Rodada ${st.round} — ilimitado`,
    x + w / 2, y + 190
  );

  // dado
  const dx = x + w / 2, dy = y + h / 2 + 40;
  roundRect(ctx, dx - 42, dy - 42, 84, 84, 18);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#22304e';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = '900 46px sans-serif';
  ctx.fillText(st.dice ?? '?', dx, dy + 2);

  // jogador atual
  const cp = st.players[st.turnIdx];
  if (cp && !st.over) {
    ctx.font = '700 17px sans-serif';
    ctx.fillStyle = cp.color;
    ctx.fillText(`● ${cp.name}`, x + w / 2, y + h - 44);
    ctx.fillStyle = '#93a4c6';
    ctx.font = '600 12px sans-serif';
    ctx.fillText('é a sua vez', x + w / 2, y + h - 22);
  }
  if (st.over && st.winner) {
    const wp = st.players.find((p) => p.id === st.winner);
    ctx.fillStyle = '#f5b942';
    ctx.font = '800 24px sans-serif';
    ctx.fillText(`🏆 ${wp.name} venceu!`, x + w / 2, y + h - 40);
  }
}

function drawTokens(ctx, st) {
  const offsets = [
    [-16, -16], [16, -16], [-16, 16], [16, 16],
  ];
  st.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const r = cellRect(p.position);
    const [ox, oy] = offsets[i % 4];
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2 + ox, r.y + r.h / 2 + oy, 9, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });
}

function drawHighlights(ctx, st) {
  // casa do jogador atual
  const cp = st.players[st.turnIdx];
  if (cp && !cp.bankrupt && !st.over) {
    const r = cellRect(cp.position);
    ctx.strokeStyle = '#f5b942';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
  }
  // pendência de compra
  if (st.pending?.type === 'buy') {
    const r = cellRect(st.pending.space);
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    ctx.setLineDash([]);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
