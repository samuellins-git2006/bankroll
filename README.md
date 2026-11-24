# Bankroll — Clone do jogo do Plato

Clone do **Bankroll** (mini-jogo do app Plato): jogo de tabuleiro imobiliário
para 2–4 jogadores, com metas de patrimônio, construções, leilões de troca e
cartas da sorte.

## Status do projeto

- ✅ **Fase 1** — Engine de regras (pura e testada) + jogo local (hotseat) em Canvas 2D
- ⬜ **Fase 2** — Servidor multiplayer (Node.js + socket.io, salas com código de convite)
- ⬜ **Fase 3** — Bots para preencher vagas
- ⬜ **Fase 4** — Refino visual/UX
- ⬜ **Fase 5** — Deploy (cliente na Vercel, servidor no Render)

## Como rodar (jogo local)

```bash
npm run dev
```

Abra **http://localhost:3000/client/** no navegador.

## Como jogar

- Configure nº de jogadores, nomes, meta de patrimônio ($3.000/$5.000/$7.000)
  e rodadas máximas (30/50/ilimitado).
- Cada jogador joga no mesmo aparelho (hotseat).
- Vence quem primeiro atingir a meta, ou o último de pé, ou o maior
  patrimônio ao fim das rodadas.

### Regras principais

| Regra | Valor |
|---|---|
| Salário ao passar pelo Início | $200 |
| Dado 6 | joga de novo |
| Fiança da cadeia | $150 (ou 3 turnos preso) |
| Venda ao banco | 80% do valor investido |
| Monopólio de cor (sem construções) | aluguel ×2 |
| Construções | máx. 3 por cidade; aluguel ×3/×6/×12 |
| Propriedades públicas | aluguel $50 × nº de públicas |
| Leilão (troca fechada) | bônus de $100 para ambos |
| Falência | patrimônio ≤ $0 ou caixa < −$500 |
| Ordem de início | 2º/3º/4º recebem +$100/+200/+300 |

## Customização

Todo o jogo (tabuleiro, valores, cartas, cores, economia) fica em
`shared/config.js`. Altere cidades, preços e aluguéis sem tocar na engine.

## Estrutura

```
shared/       config.js (tabuleiro/economia) + engine.js (regras puras)
client/       index.html + css/ + src/ (board.js = canvas, main.js = UI)
server/       (Fase 2 — multiplayer socket.io)
tests/        smoke.js — simulação aleatória de milhares de jogadas
tools/        serve.cjs — servidor estático de desenvolvimento
```

## Testes

```bash
npm test
```
Simula uma partida inteira com ações aleatórias, valida invariantes do
estado e regras de aluguel (monopólio, construções, públicas).
