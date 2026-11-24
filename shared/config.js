// ============================================================
// Configuração do jogo — EDITÁVEL
// Tudo aqui (tabuleiro, valores, cartas, metas) pode ser
// alterado sem tocar na engine de regras.
// ============================================================

export const CONFIG = {
  // --- Opções mostradas na tela de configuração ---
  goalOptions: [3000, 5000, 7000],      // meta de patrimônio líquido
  roundOptions: [30, 50, 0],            // 0 = rodadas ilimitadas

  // --- Economia ---
  startCash: 1000,    // caixa inicial do 1º jogador
  laterBonus: 100,    // bônus por posição de início (2º: +100, 3º: +200, 4º: +300)
  salary: 200,        // ao passar pelo Início
  jailFine: 150,      // para sair da cadeia
  jailTurns: 3,       // turnos preso ao cair na Cadeia
  bankruptCashLimit: -500, // caixa abaixo disso = falência
  bankruptWorthLimit: 0,   // patrimônio <= 0 = falência
  sellRate: 0.8,      // venda devolve 80% do valor investido
  auctionBonus: 100,  // bônus para ambos ao fechar uma troca
  rentMultipliers: [1, 3, 6, 12], // aluguel por nº de construções (0,1,2,3)
  monopolyMultiplier: 2,          // aluguel com monopólio e 0 construções
  publicRentBase: 50, // aluguel de propriedade pública = base × qtd owned

  // --- Cores dos grupos de cidades ---
  groups: {
    brown:     { color: '#9c7054' },
    lightblue: { color: '#8ed1e0' },
    pink:      { color: '#e883ae' },
    orange:    { color: '#f5a24b' },
    red:       { color: '#e05b5b' },
    yellow:    { color: '#f0d264' },
    green:     { color: '#6cba76' },
  },

  // Custo de cada construção por grupo
  buildingCostByGroup: {
    brown: 60, lightblue: 80, pink: 100,
    orange: 120, red: 140, yellow: 160, green: 180,
  },

  // --- Cores das peças dos jogadores ---
  playerColors: ['#e74c3c', '#2980d9', '#27ae60', '#8e44ad'],

  // ============================================================
  // TABULEIRO — 28 casas (anel 8×8)
  // Tipos: start | city | public | jail | auction | lucky
  // ============================================================
  board: [
    { type: 'start',  name: 'Início' },                              // 0
    { type: 'city',   name: 'Bangkok',   group: 'brown',     price: 80,  rent: 14 },
    { type: 'city',   name: 'Madrid',    group: 'brown',     price: 100, rent: 18 },
    { type: 'public', name: 'Ferrovia',                      price: 200 },
    { type: 'lucky',  name: 'Sorte' },                               // 4
    { type: 'city',   name: 'Cairo',     group: 'lightblue', price: 120, rent: 20 },
    { type: 'city',   name: 'Paris',     group: 'lightblue', price: 140, rent: 24 },
    { type: 'jail',   name: 'Cadeia' },                              // 7 (canto)
    { type: 'city',   name: 'Lima',      group: 'lightblue', price: 160, rent: 28 },
    { type: 'city',   name: 'Atenas',    group: 'pink',      price: 180, rent: 32 },
    { type: 'city',   name: 'Toronto',   group: 'pink',      price: 200, rent: 36 },
    { type: 'lucky',  name: 'Sorte' },                               // 11
    { type: 'city',   name: 'Roma',      group: 'pink',      price: 220, rent: 40 },
    { type: 'public', name: 'Aeroporto',                      price: 200 },
    { type: 'auction', name: 'Leilão' },                             // 14 (canto)
    { type: 'city',   name: 'Berlim',    group: 'orange',    price: 240, rent: 44 },
    { type: 'city',   name: 'Seul',      group: 'orange',    price: 260, rent: 48 },
    { type: 'city',   name: 'Sydney',    group: 'orange',    price: 280, rent: 52 },
    { type: 'lucky',  name: 'Sorte' },                               // 18
    { type: 'city',   name: 'Tóquio',    group: 'red',       price: 300, rent: 56 },
    { type: 'city',   name: 'Miami',     group: 'red',       price: 320, rent: 60 },
    { type: 'lucky',  name: 'Sorte' },                               // 21 (canto)
    { type: 'city',   name: 'Nova York', group: 'red',       price: 340, rent: 64 },
    { type: 'city',   name: 'Londres',   group: 'yellow',    price: 360, rent: 70 },
    { type: 'city',   name: 'Dubai',     group: 'yellow',    price: 380, rent: 74 },
    { type: 'city',   name: 'Singapura', group: 'green',     price: 400, rent: 80 },
    { type: 'city',   name: 'Chicago',   group: 'green',     price: 420, rent: 84 },
    { type: 'city',   name: 'São Paulo', group: 'green',     price: 440, rent: 88 }, // 27
  ],

  // ============================================================
  // CARTAS DA SORTE
  // Efeitos: money (±caixa) | payPerPlayer (positivo = paga a cada
  // jogador; negativo = recebe) | goto (vai para casa X) |
  // move (avança/retrocede N casas) | jail (vai para a cadeia)
  // ============================================================
  luckyCards: [
    { title: 'Herança',      desc: 'Você recebeu uma herança: +$200',                 effect: { type: 'money', amount: 200 } },
    { title: 'Investimento', desc: 'Seu investimento rendeu: +$150',                  effect: { type: 'money', amount: 150 } },
    { title: 'Prêmio',       desc: 'Você ganhou um prêmio: +$300',                    effect: { type: 'money', amount: 300 } },
    { title: 'Dividendos',   desc: 'Dividendos de ações: +$120',                      effect: { type: 'money', amount: 120 } },
    { title: 'Reembolso',    desc: 'Restituição de imposto: +$100',                   effect: { type: 'money', amount: 100 } },
    { title: 'Férias',       desc: 'Viaje para o Início e receba $200',               effect: { type: 'goto', space: 0 } },
    { title: 'Mudança',      desc: 'Avance 3 casas',                                  effect: { type: 'move', steps: 3 } },
    { title: 'Tempo ruim',   desc: 'Uma tempestade te fez voltar 3 casas',            effect: { type: 'move', steps: -3 } },
    { title: 'Multa',        desc: 'Multa por excesso de velocidade: -$150',          effect: { type: 'money', amount: -150 } },
    { title: 'Contas',       desc: 'Contas atrasadas: -$100',                         effect: { type: 'money', amount: -100 } },
    { title: 'Médico',       desc: 'Despesas médicas: -$200',                         effect: { type: 'money', amount: -200 } },
    { title: 'Festa',        desc: 'Você organizou a festa: pague $50 a cada jogador', effect: { type: 'payPerPlayer', amount: 50 } },
    { title: 'Aluguéis',     desc: 'Receba $50 de cada jogador',                      effect: { type: 'payPerPlayer', amount: -50 } },
    { title: 'Cadeia',       desc: 'Vá direto para a Cadeia',                         effect: { type: 'jail' } },
  ],
};
