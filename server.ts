import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { vigiarWhatsApp } from './server/whatsapp.js';
import { apagarGravacoesAntigas } from './server/chamados.js';
import { iniciarJornadas } from './server/jornada.js';
import { iniciarInatividade } from './server/inatividade.js';
import { iniciarBotAtividades } from './server/atividadeBot.js';
import { iniciarRespostasPesquisa } from './server/pesquisasSatisfacao.js';

/** Entrada para execução local (npm run dev / start). Na Vercel quem serve as rotas é api/index.ts */
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = createApp();

  // ==========================================================
  // VITE / SPA
  // ==========================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BM-SOL rodando em http://0.0.0.0:${PORT}`);
    console.log(`MySQL: ${process.env.MYSQL_HOST} / ${process.env.MYSQL_DATABASE || 'bmsol'}`);
    // Rotinas do suporte
    iniciarJornadas();
    iniciarInatividade();
    iniciarBotAtividades();
    iniciarRespostasPesquisa();
    // Vigia da Evolution a cada 10 min (na Vercel: cron /api/cron/whatsapp)
    setInterval(() => vigiarWhatsApp().catch((err) => console.error('Vigia do WhatsApp:', err.message)), 10 * 60_000);
    // Gravações de ligação com mais de 30 dias, 2x por dia (na Vercel: cron /api/cron/gravacoes)
    setInterval(() => apagarGravacoesAntigas().catch((err) => console.error('Gravações: falha ao apagar as antigas:', err.message)), 12 * 60 * 60_000);
  });
}

startServer().catch((err) => {
  console.error('Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
