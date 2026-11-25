import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { configSmtpPublica, prepararConfigSmtp, testarSmtp } from './email.js';
import { conferirInstanciaUnica, configWhatsPublica, prepararConfigWhats, testarWhatsApp, conectarWhatsApp, desconectarWhatsApp, ativarRecebimento } from './whatsapp.js';
import { chatbotPublica, prepararChatbot, testarChatbot } from './chatbot.js';
import { jornadaPublica, prepararJornada } from './jornada.js';
import { exigirAcesso } from './permissoes.js';
import { pesquisaPublica, prepararPesquisa } from './pesquisa.js';

/**
 * Configurações da empresa (tabela config).
 *
 * Cada linha é `empresa_id + grupo + chave = valor`, com o valor em JSON: "pessoas" (campos_personalizados),
 * "email" (smtp, smtp_suporte) e "whatsapp" (provedor, chatbot, jornada, pesquisa). Senhas e tokens são
 * gravados cifrados e nunca voltam para o navegador (server/email.ts, server/whatsapp.ts).
 */

/** Grupos e chaves aceitos: o que não está aqui não entra no banco */
const CHAVES: Record<string, string[]> = {
  pessoas: ['campos_personalizados'],
  // smtp_suporte = conta do suporte (pesquisa de satisfação, Bot das atividades); smtp = a conta geral, usada quando ela está em branco
  email: ['smtp', 'smtp_suporte'],
  whatsapp: ['provedor', 'chatbot', 'jornada', 'pesquisa'],
};

/**
 * Configurações que passam por tratamento ao gravar e ao devolver à tela: segredos (gravados
 * cifrados, devolvidos sem o segredo).
 */
const COM_SEGREDO: Record<string, { preparar: (valor: any, anterior: any) => any; publica: (valor: any) => any }> = {
  'email.smtp': { preparar: prepararConfigSmtp, publica: configSmtpPublica },
  'email.smtp_suporte': { preparar: prepararConfigSmtp, publica: configSmtpPublica },
  'whatsapp.provedor': { preparar: prepararConfigWhats, publica: configWhatsPublica },
  'whatsapp.chatbot': { preparar: prepararChatbot, publica: chatbotPublica },
  // Funções chamadas na hora (jornada.ts importa este módulo)
  'whatsapp.jornada': { preparar: (v, a) => prepararJornada(v, a), publica: (v) => jornadaPublica(v) },
  'whatsapp.pesquisa': { preparar: (v) => prepararPesquisa(v), publica: (v) => pesquisaPublica(v) },
};
export const somenteAdmin = (res: Response) => {
  if (res.locals.usuario?.tipo !== 'admin') {
    throw Object.assign(new Error('Somente administradores alteram as configurações.'), { status: 403 });
  }
};

const TAMANHO_MAX = 1_000_000;

function validar(grupo: string, chave: string) {
  if (!CHAVES[grupo]?.includes(chave)) {
    throw Object.assign(new Error(`Configuração desconhecida: ${grupo}.${chave}`), { status: 404 });
  }
}

/** Lê o valor gravado, ou null quando a empresa ainda não configurou nada */
export async function lerConfig(empresaId: string, grupo: string, chave: string): Promise<any> {
  const [rows] = await pool.query<any[]>(
    'SELECT valor FROM config WHERE empresa_id = ? AND grupo = ? AND chave = ? LIMIT 1',
    [empresaId, grupo, chave],
  );
  if (!rows.length || rows[0].valor === null) return null;
  try {
    return JSON.parse(rows[0].valor);
  } catch {
    return null; // conteúdo inválido no banco não derruba a tela
  }
}

export function createConfigRouter(): Router {
  const router = Router();

  router.get('/config/:grupo/:chave', async (req: Request, res: Response) => {
    try {
      const { grupo, chave } = req.params;
      // Configurações: só administrador. Os campos personalizados de Pessoas são lidos pelo cadastro de
      // Pessoas de qualquer usuário
      if (!(grupo === 'pessoas' && chave === 'campos_personalizados')) exigirAcesso(res, 'configuracoes', 'as Configurações');
      validar(grupo, chave);
      const valor = await lerConfig(String(res.locals.empresaId), grupo, chave);
      const segredo = COM_SEGREDO[`${grupo}.${chave}`];
      const publico = segredo ? segredo.publica(valor) : valor;
      // Nó IA sem texto-base próprio: mostra o texto-base antigo do Chatbot, que é o que ele usa
      // (ao salvar a automação, o texto passa a ficar no nó)
      if (grupo === 'whatsapp' && chave === 'jornada') {
        const antigo = String((await lerConfig(String(res.locals.empresaId), 'whatsapp', 'chatbot'))?.texto_base ?? '').trim();
        if (antigo) publico.nos = publico.nos.map((n: any) => (n.tipo === 'ia' && !String(n.dados?.texto ?? '').trim() ? { ...n, dados: { ...n.dados, texto: antigo } } : n));
      }
      res.json({ grupo, chave, valor: publico });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // Só administradores mexem nas configurações da empresa
  router.put('/config/:grupo/:chave', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      const { grupo, chave } = req.params;
      validar(grupo, chave);
      const empresaId = String(res.locals.empresaId);
      const segredo = COM_SEGREDO[`${grupo}.${chave}`];
      const valor = segredo ? segredo.preparar(req.body?.valor, await lerConfig(empresaId, grupo, chave)) : req.body?.valor;
      if (grupo === 'whatsapp' && chave === 'provedor') await conferirInstanciaUnica(empresaId, valor);
      const texto = JSON.stringify(valor ?? null);
      if (texto.length > TAMANHO_MAX) {
        return res.status(413).json({ error: 'Configuração grande demais.' });
      }

      const [existe] = await pool.query<any[]>(
        'SELECT id FROM config WHERE empresa_id = ? AND grupo = ? AND chave = ? LIMIT 1',
        [empresaId, grupo, chave],
      );
      if (existe.length) {
        await pool.query('UPDATE config SET valor = ? WHERE id = ?', [texto, existe[0].id]);
      } else {
        await pool.query('INSERT INTO config (empresa_id, grupo, chave, valor) VALUES (?, ?, ?, ?)', [
          empresaId,
          grupo,
          chave,
          texto,
        ]);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Conecta e autentica no SMTP gravado (conta geral ou do suporte), sem enviar e-mail */
  router.post('/config/email/:chave/testar', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      await testarSmtp(String(res.locals.empresaId), req.params.chave === 'smtp_suporte' ? 'suporte' : 'comercial');
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Consulta no provedor se o número do WhatsApp gravado está conectado */
  router.post('/config/whatsapp/provedor/testar', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      res.json({ success: true, ...(await testarWhatsApp(String(res.locals.empresaId))) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** QR Code para conectar o número do WhatsApp gravado (ou "já conectado") */
  router.post('/config/whatsapp/provedor/conectar', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      res.json({ success: true, ...(await conectarWhatsApp(String(res.locals.empresaId))) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Pergunta curta à IA escolhida com a chave e o modelo gravados */
  router.post('/config/whatsapp/chatbot/testar', async (_req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      res.json({ success: true, mensagem: await testarChatbot(String(res.locals.empresaId)) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Cadastra na Evolution o endereço do CRM para receber mensagens e avisos de entrega/leitura */
  router.post('/config/whatsapp/provedor/receber', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      res.json({ success: true, ...(await ativarRecebimento(String(res.locals.empresaId), String(req.body?.origem ?? ''))) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Desconecta o número do WhatsApp gravado (logout na instância) */
  router.post('/config/whatsapp/provedor/desconectar', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      await desconectarWhatsApp(String(res.locals.empresaId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
