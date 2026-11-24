// ============================================================
// Configuração de conexão do cliente
// ============================================================

const params = new URLSearchParams(location.search);

function defaultServer() {
  // 1) override manual: ?srv=https://meu-servidor.onrender.com
  const viaQuery = params.get('srv');
  if (viaQuery) return viaQuery;

  const h = location.hostname;

  // 2) desenvolvimento local
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001';

  // 3) jogando direto pela URL do Render (o servidor embute o cliente)
  if (h.endsWith('onrender.com')) return location.origin;

  // 4) produção (Vercel) → AJUSTE AQUI após criar o serviço no Render
  return 'https://bankroll-server-uqms.onrender.com';
}

export const SERVER_URL = defaultServer();
