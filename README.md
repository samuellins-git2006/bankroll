# Bankroll — Clone do jogo do Plato

Clone do **Bankroll** (mini-jogo do app Plato): jogo de tabuleiro imobiliário
para 2–4 jogadores, com metas de patrimônio, construções, leilões de troca e
cartas da sorte.

## Status do projeto

- ✅ **Fase 1** — Engine de regras (pura e testada) + jogo local (hotseat) em Canvas 2D
- ✅ **Fase 2** — Servidor multiplayer (socket.io) com salas, código de convite e bots
- ⬜ **Fase 3** — Deploy do servidor no Render
- ⬜ **Fase 4** — Refino visual/UX e feedback de jogo
- ⬜ **Fase 5** — Ajustes finais + monitoramento

## Como rodar (desenvolvimento)

```bash
npm run dev        # cliente estático em http://localhost:3000
npm run server     # servidor multiplayer em http://localhost:3001
npm test           # valida a engine (simulação aleatória)
npm run test:online# valida salas, bots e sincronização
```

Para testar multiplayer na sua máquina: abra `http://localhost:3000` em duas
abas/janelas — crie a sala em uma e entre com o código na outra.

## Como jogar online (produção)

1. **Cliente:** hospedado na Vercel (deploy automático a cada `git push`)
2. **Servidor:** hospedado no Render (WebSocket)
3. Ao entrar em "Criar sala online", você recebe um **código de 4 letras** —
   os amigos entram com esse código, e vagas não preenchidas viram **bots**
   ao iniciar a partida.

> O endereço do servidor multiplayer fica em `client/src/config.js`.
> Para apontar para outro servidor, use `?srv=https://url-do-servidor`.

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
client/       index.html + css/ + src/ (board.js = canvas, main.js = UI, config.js = servidor)
server/       index.js (Express + socket.io), rooms.js (salas/partidas), bots.js (IA)
tests/        smoke.js (engine) + online.test.js (multiplayer ponta a ponta)
tools/        serve.cjs — servidor estático de desenvolvimento
```

## Deploy do servidor no Render

1. Render → **New Web Service** → conecte o repositório `samuellins-git2006/bankroll`
2. Configuração:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server/index.js`
3. Render fornece a variável `PORT` automaticamente (o código já usa).
4. Copie a URL gerada (ex.: `https://bankroll-server-xxxx.onrender.com`) e
   atualize o endereço em `client/src/config.js` → commit + push (Vercel publica).

## Testes

```bash
npm test
```
Simula uma partida inteira com ações aleatórias, valida invariantes do
estado e regras de aluguel (monopólio, construções, públicas).
