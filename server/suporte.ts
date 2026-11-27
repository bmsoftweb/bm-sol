import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { chamarBmdesk } from './bmdesk.js';
import { fecharSecao, gravarMensagem, ImagemMensagem, lerImagem, NR_FILA, TOQUE_SEG } from './chamados.js';
import { donoDoTelefone, telefoneWhatsApp } from './whatsapp.js';
import { notificar } from './notificacoes.js';
import { bmhelpLigado, pedeTecnico, perguntarBmhelp, sistemasBmhelp } from './bmhelp.js';
import { erroCelular } from '../src/utils/formatters.js';

/**
 * Suporte pelo site (widget público, sem login): public/widget.js abre a página /suporte?e=<empresa>,
 * onde o cliente abre um chamado (CNPJ/CPF, nome, WhatsApp, categoria e descrição) e conversa com a
 * equipe. O chamado cai na Fila de Chamados (server/chamados.ts) com canal "web".
 *
 * O CNPJ só serve para ligar o chamado à Pessoa do CRM: ver o chamado e as mensagens exige o token
 * assinado que só o navegador que abriu recebe (quem digita o CNPJ de outra empresa não vê nada dela).
 * O cliente não vê notas internas nem os eventos da equipe; vê a posição na fila e quem atende.
 */

// Sem SESSION_SECRET, um segredo aleatório (os links valem até o servidor reiniciar)
const SEGREDO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

/** Token do chamado para o navegador do cliente: "<id>.<assinatura>" */
export function tokenSuporte(chamadoId: number): string {
  const ass = crypto.createHmac('sha256', SEGREDO).update(`suporte:${chamadoId}`).digest('base64url').slice(0, 32);
  return `${chamadoId}.${ass}`;
}

/** Id do chamado do token, ou null se a assinatura não bate */
export function chamadoDoToken(token: string): number | null {
  const [id] = String(token || '').split('.');
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const esperado = tokenSuporte(n);
  return esperado.length === token.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(token)) ? n : null;
}

/**
 * Assistente (bm-help, server/bmhelp.ts): enquanto o cliente espera na fila sem técnico, ele escolhe o sistema e
 * a IA responde a dúvida do chamado e as mensagens seguintes. Para sozinho quando um técnico assume.
 * Banco: chamados.bmhelp_sistema_id (0 = cliente dispensou o assistente) / bmhelp_sessao e o autor 'assistente' em chamado_mensagens
 * (extras/bmhelp_assistente.sql); só são lidos com o bm-help configurado
 */
const LIMITE_ASSISTENTE = 10;
const assistenteAtivo = (c: any) => bmhelpLigado() && !c.atendente_id && !['encerrado', 'cancelado'].includes(c.status);

/** Cliente não quer o assistente (pediu um técnico ou "Não, obrigado"): desliga e ele segue na fila */
async function dispensarAssistente(chamadoId: number, avisarCliente: boolean) {
  await pool.query('UPDATE chamados SET bmhelp_sistema_id = 0, bmhelp_sessao = NULL WHERE id = ?', [chamadoId]);
  await gravarMensagem({ chamado_id: chamadoId, autor: 'sistema', texto: 'Cliente dispensou o assistente (bm-help): aguarda um técnico na fila.' });
  if (avisarCliente) {
    await gravarMensagem({ chamado_id: chamadoId, autor: 'assistente', texto: 'Tudo bem! Encerrei o assistente. Você continua na fila e um técnico já vai falar com você.' });
  }
}

/** Pergunta ao bm-help pelo chamado e grava a resposta como mensagem do assistente */
async function responderAssistente(chamadoId: number, pergunta: string, imagem: ImagemMensagem | null = null) {
  const [[a]] = await pool.query<any[]>(
    `SELECT bmhelp_sistema_id, bmhelp_sessao,
            (SELECT COUNT(*) FROM chamado_mensagens m WHERE m.chamado_id = c.id AND m.autor = 'assistente') AS qtd
       FROM chamados c WHERE c.id = ?`,
    [chamadoId],
  );
  if (!a?.bmhelp_sistema_id) return;
  const qtd = Number(a.qtd);
  // Teto de custo por chamado: avisa uma vez e para
  if (qtd >= LIMITE_ASSISTENTE) {
    if (qtd === LIMITE_ASSISTENTE) {
      await gravarMensagem({ chamado_id: chamadoId, autor: 'assistente', texto: 'Chegamos ao limite de perguntas ao assistente neste atendimento. Um técnico já vai falar com você.' });
    }
    return;
  }
  let resposta: string;
  try {
    const r = await perguntarBmhelp(
      Number(a.bmhelp_sistema_id),
      pergunta,
      a.bmhelp_sessao || null,
      imagem ? { tipo: imagem.tipo, base64: imagem.dados.toString('base64') } : null,
    );
    if (r.sessao && r.sessao !== a.bmhelp_sessao) await pool.query('UPDATE chamados SET bmhelp_sessao = ? WHERE id = ?', [r.sessao.slice(0, 100), chamadoId]);
    resposta = r.texto || 'Não encontrei uma resposta para isso. Um técnico já vai falar com você.';
  } catch (err: any) {
    console.error(`Suporte (assistente): ${err.message}`);
    resposta = 'Não consegui consultar agora. Um técnico já vai falar com você.';
  }
  await gravarMensagem({ chamado_id: chamadoId, autor: 'assistente', texto: resposta });
}

const digitos = (v: unknown, max: number) => String(v ?? '').replace(/\D/g, '').slice(0, max);
const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function createSuporteRouter(): Router {
  const router = Router();
  const rota =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err: any) {
        if (!err.status) console.error(`Suporte (site): ${err.message}`);
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível concluir agora. Tente de novo em instantes.' });
      }
    };

  /** Chamado do token (e da empresa dele) */
  async function doToken(token: string) {
    const id = chamadoDoToken(token);
    if (!id) throw erro(404, 'Atendimento não encontrado.');
    const [r] = await pool.query<any[]>(
      `SELECT c.id, c.empresa_id, c.numero, c.titulo, c.status, c.pessoa_id, c.atendente_id, c.departamento_id, c.criado_em, c.contato_telefone,
              u.nome AS atendente_nome,
              -- Mesmo número da tela do técnico (Chamados): posição entre os abertos, por ordem de chegada
              ${NR_FILA} AS posicao,
              EXISTS (SELECT 1 FROM chamado_mensagens m WHERE m.chamado_id = c.id AND m.autor = 'sistema' AND m.texto LIKE 'Cliente avaliou%') AS avaliado
         FROM chamados c LEFT JOIN usuarios u ON u.id = c.atendente_id WHERE c.id = ?`,
      [id],
    );
    if (!r[0]) throw erro(404, 'Atendimento não encontrado.');
    return r[0];
  }

  /** Empresa e categorias, para montar o formulário */
  router.get('/api/publico/suporte/:empresa', rota(async (req, res) => {
    const [e] = await pool.query<any[]>('SELECT id, nome, logo FROM empresas WHERE id = ?', [Number(req.params.empresa) || 0]);
    if (!e[0]) throw erro(404, 'Suporte não encontrado.');
    const [cats] = await pool.query<any[]>('SELECT id, nome FROM chamado_categorias WHERE empresa_id = ? AND ativo = 1 ORDER BY nome', [e[0].id]);
    res.json({ empresa: { nome: e[0].nome, logo: e[0].logo }, categorias: cats });
  }));

  /** Abre o chamado; devolve o token que dá acesso a ele */
  router.post('/api/publico/suporte/:empresa/chamados', rota(async (req, res) => {
    const empresaId = Number(req.params.empresa) || 0;
    const [e] = await pool.query<any[]>('SELECT id FROM empresas WHERE id = ?', [empresaId]);
    if (!e[0]) throw erro(404, 'Suporte não encontrado.');
    const b = req.body || {};
    const documento = digitos(b.documento, 14);
    const nome = texto(b.nome, 120);
    const telefone = digitos(b.telefone, 20);
    const descricao = texto(b.descricao, 4000);
    if (documento.length !== 11 && documento.length !== 14) throw erro(400, 'Informe o CNPJ (ou CPF) da empresa.');
    if (nome.length < 2) throw erro(400, 'Informe o seu nome.');
    // Fixo (opcional): com DDD; vai em chamados.contato_fixo e na mensagem de abertura do chamado
    const fixo = digitos(b.fixo, 13);
    if (fixo && fixo.length < 10) throw erro(400, 'Informe o telefone fixo com DDD (ou deixe em branco).');
    // Celular: DDD que existe + 9 + 8 dígitos (com ou sem o 55), sem todos os dígitos iguais
    const motivo = erroCelular(telefone);
    if (motivo) throw erro(400, motivo);
    if (descricao.length < 5) throw erro(400, 'Conte o que está acontecendo.');
    const titulo = texto(b.titulo, 200) || descricao.split('\n')[0].slice(0, 80);
    let categoriaId: number | null = Number(b.categoria_id) || null;
    let slaHoras: number | null = null;
    if (categoriaId) {
      const [cat] = await pool.query<any[]>('SELECT sla_horas FROM chamado_categorias WHERE id = ? AND empresa_id = ? AND ativo = 1', [categoriaId, empresaId]);
      if (!cat[0]) categoriaId = null;
      else slaHoras = Number(cat[0].sla_horas) || null;
    }
    // Cliente do CRM pelo CNPJ/CPF (sem ele, o chamado fica com o nome e o WhatsApp de quem abriu)
    const [p] = await pool.query<any[]>('SELECT id FROM pessoas WHERE empresa_id = ? AND cpf = ? ORDER BY id LIMIT 1', [empresaId, documento]);
    const pessoaId = p[0]?.id ?? null;

    const conn = await pool.getConnection();
    let id: number;
    let numero: number;
    try {
      await conn.beginTransaction();
      const [[{ n }]] = await conn.query<any>('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM chamados WHERE empresa_id = ? FOR UPDATE', [empresaId]);
      numero = Number(n);
      const [ins] = await conn.query<any>(
        `INSERT INTO chamados (empresa_id, numero, pessoa_id, categoria_id, titulo, descricao, status, prioridade, canal,
                               contato_nome, contato_telefone, contato_fixo, contato_documento, sla_prazo)
         VALUES (?, ?, ?, ?, ?, ?, 'aguardando', 'normal', 'web', ?, ?, ?, ?, IF(? IS NULL, NULL, NOW() + INTERVAL ? HOUR))`,
        [empresaId, numero, pessoaId, categoriaId, titulo, descricao, nome, telefone, fixo || null, documento, slaHoras, slaHoras ?? 0],
      );
      id = Number(ins.insertId);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    await gravarMensagem({
      chamado_id: id,
      autor: 'sistema',
      // Aberto pelo BM-ClientChat (programa na máquina do cliente): vem o nome do computador
      texto: `Chamado aberto pelo cliente ${texto(b.pc, 60) ? `no BM-ClientChat, computador "${texto(b.pc, 60)}"` : 'no site'}: ${nome}, WhatsApp ${telefone}${fixo ? `, telefone fixo ${fixo}` : ''}${pessoaId ? '' : ` (CNPJ/CPF ${documento} não está no CRM)`}.`,
    });
    await notificar(empresaId, { tela: 'chamados_fila' }, {
      tipo: 'chamado',
      titulo: `Chamado nº ${numero} na fila`,
      texto: `${nome}: ${titulo}`,
      link: 'chamados_ativos',
      registroId: id,
    });
    res.json({ token: tokenSuporte(id), numero });
  }));

  /** Situação e conversa (sem notas internas nem eventos da equipe) */
  router.get('/api/publico/suporte/chamado/:token', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    const [msgs] = await pool.query<any[]>(
      `SELECT m.id, m.autor, m.texto, m.criado_em, u.nome AS usuario_nome, m.imagem IS NOT NULL AS tem_imagem
         FROM chamado_mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.chamado_id = ? AND m.autor IN ('cliente','equipe','assistente') AND m.interna = 0 ORDER BY m.id`,
      [c.id],
    );
    // Assistente: oferecido enquanto ninguém assumiu; sistema = o que o cliente escolheu (null = ainda não escolheu)
    let assistente: { sistema: string | null } | null = null;
    if (assistenteAtivo(c)) {
      const [[a]] = await pool.query<any[]>('SELECT bmhelp_sistema_id FROM chamados WHERE id = ?', [c.id]);
      const id = Number(a?.bmhelp_sistema_id) || null;
      // 0 = dispensado: não oferece mais
      if (a?.bmhelp_sistema_id == null || id) {
        const sistemas = id ? await sistemasBmhelp().catch(() => []) : [];
        assistente = { sistema: id ? (sistemas.find((s) => s.id === id)?.nome ?? 'escolhido') : null };
      }
    }
    // Técnico ligando para o cliente (src/components/Telefone.tsx); sem a coluna chamado_id em ligacoes: nunca toca
    let ligacao = null;
    try {
      const [l] = await pool.query<any[]>(
        `SELECT l.id, u.nome AS de, l.oferta FROM ligacoes l JOIN usuarios u ON u.id = l.de_usuario_id
          WHERE l.chamado_id = ? AND l.situacao = 'chamando' AND l.criado_em >= NOW() - INTERVAL ${TOQUE_SEG} SECOND
          ORDER BY l.id DESC LIMIT 1`,
        [c.id],
      );
      ligacao = l[0] ?? null;
    } catch {
      // banco sem extras/ligacoes_cliente.sql
    }
    res.json({
      ligacao,
      numero: c.numero,
      titulo: c.titulo,
      status: c.status,
      atendente: c.atendente_nome ?? null,
      // Só enquanto espera um técnico; assumido ou encerrado: null
      posicao: c.posicao == null ? null : Number(c.posicao),
      avaliado: Boolean(Number(c.avaliado)),
      assistente,
      mensagens: msgs,
    });
  }));

  router.post('/api/publico/suporte/chamado/:token/mensagens', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(409, 'Este atendimento foi encerrado. Abra um novo, se precisar.');
    const msg = texto(req.body?.texto, 4000);
    // Print da tela (colado ou escolhido no clipe): vai junto, ou sozinho
    const imagem = lerImagem(req.body?.imagem);
    if (!msg && !imagem) throw erro(400, 'Escreva a mensagem.');
    await gravarMensagem({ chamado_id: c.id, autor: 'cliente', texto: msg, imagem });
    if (assistenteAtivo(c)) {
      const [[a]] = await pool.query<any[]>('SELECT bmhelp_sistema_id FROM chamados WHERE id = ?', [c.id]);
      // Conversando com o assistente e pediu um técnico: desliga o assistente e segue na fila
      if (Number(a?.bmhelp_sistema_id) && pedeTecnico(msg)) await dispensarAssistente(c.id, true);
      // Sem técnico e com o sistema escolhido: o assistente responde (a requisição espera a resposta; o print vai junto)
      else await responderAssistente(c.id, msg, imagem);
    }
    res.json({ success: true });
  }));

  /** Imagem de uma mensagem do chat (só as que o cliente vê) */
  router.get('/api/publico/suporte/chamado/:token/imagens/:msg', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    const [r] = await pool.query<any[]>(
      `SELECT imagem, imagem_tipo FROM chamado_mensagens
        WHERE id = ? AND chamado_id = ? AND interna = 0 AND autor IN ('cliente','equipe','assistente') AND imagem IS NOT NULL`,
      [Number(req.params.msg) || 0, c.id],
    );
    if (!r[0]) throw erro(404, 'Imagem não encontrada.');
    res.set('Content-Type', r[0].imagem_tipo || 'image/jpeg').set('Cache-Control', 'private, max-age=86400').send(r[0].imagem);
  }));

  /** Sistemas que o assistente conhece (o cliente escolhe sobre qual é a dúvida) */
  router.get('/api/publico/suporte/chamado/:token/assistente/sistemas', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (!assistenteAtivo(c)) throw erro(409, 'O assistente não está disponível neste atendimento.');
    res.json(await sistemasBmhelp().catch((e) => {
      console.error(`Suporte (assistente): ${e.message}`);
      throw erro(503, 'O assistente está indisponível agora. Um técnico já vai falar com você.');
    }));
  }));

  /** Botões "Falar com técnico" (na conversa com o assistente) e "Não, obrigado" (na oferta) */
  router.post('/api/publico/suporte/chamado/:token/assistente/dispensar', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (assistenteAtivo(c)) {
      const [[a]] = await pool.query<any[]>('SELECT bmhelp_sistema_id FROM chamados WHERE id = ?', [c.id]);
      // Já dispensado: nada a fazer; recusou na oferta (sem conversa): sem mensagem ao cliente
      if (a?.bmhelp_sistema_id == null || Number(a.bmhelp_sistema_id)) await dispensarAssistente(c.id, Boolean(Number(a?.bmhelp_sistema_id)));
    }
    res.json({ success: true });
  }));

  /** Cliente escolheu o sistema: o assistente já responde a dúvida que abriu o chamado */
  router.post('/api/publico/suporte/chamado/:token/assistente/sistema', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (!assistenteAtivo(c)) throw erro(409, 'O assistente não está disponível neste atendimento.');
    const id = Number(req.body?.sistema_id);
    const sis = (await sistemasBmhelp()).find((s) => s.id === id);
    if (!sis) throw erro(400, 'Escolha um dos sistemas.');
    // Trocar de sistema começa conversa nova no bm-help
    await pool.query('UPDATE chamados SET bmhelp_sistema_id = ?, bmhelp_sessao = NULL WHERE id = ?', [id, c.id]);
    await gravarMensagem({ chamado_id: c.id, autor: 'sistema', texto: `Cliente pediu ajuda ao assistente (bm-help), sistema ${sis.nome}.` });
    const [[d]] = await pool.query<any[]>('SELECT descricao FROM chamados WHERE id = ?', [c.id]);
    await responderAssistente(c.id, String(d?.descricao || c.titulo));
    res.json({ success: true });
  }));

  /**
   * Cliente encerra pelo chat: com atendente, o chamado fica encerrado (e o cliente avalia); sem
   * ninguém ter assumido, fica cancelado (desistiu da fila)
   */
  /** O cliente atende a ligação do técnico (só atende: ligar é só do técnico, server/chamados.ts) */
  router.post('/api/publico/suporte/chamado/:token/ligacao/:id/atender', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    const resposta = String(req.body?.resposta ?? '');
    if (!resposta.startsWith('v=0')) throw erro(400, 'Resposta da ligação inválida.');
    const [r] = await pool.query<any>(
      `UPDATE ligacoes SET situacao = 'atendida', resposta = ?, atendida_em = NOW()
        WHERE id = ? AND chamado_id = ? AND situacao = 'chamando' AND criado_em >= NOW() - INTERVAL ${TOQUE_SEG} SECOND`,
      [resposta, req.params.id, c.id],
    );
    if (!r.affectedRows) throw erro(409, 'O técnico já desligou.');
    res.json({ success: true });
  }));

  /** O cliente recusa (ainda tocando) ou desliga */
  router.post('/api/publico/suporte/chamado/:token/ligacao/:id/encerrar', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    await pool.query(
      `UPDATE ligacoes SET situacao = IF(situacao = 'chamando', 'recusada', 'encerrada'), encerrada_em = NOW()
        WHERE id = ? AND chamado_id = ? AND situacao IN ('chamando', 'atendida')`,
      [req.params.id, c.id],
    );
    res.json({ success: true });
  }));

  router.post('/api/publico/suporte/chamado/:token/encerrar', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(409, 'Este atendimento já foi encerrado.');
    // Dúvida resolvida pelo assistente: encerrado (e o cliente avalia), não cancelado
    const resolvido = Boolean(req.body?.resolvido) && assistenteAtivo(c);
    const cancelar = !c.atendente_id && !resolvido;
    await pool.query('UPDATE chamados SET status = ?, encerrado_em = NOW() WHERE id = ?', [cancelar ? 'cancelado' : 'encerrado', c.id]);
    await gravarMensagem({
      chamado_id: c.id,
      autor: 'sistema',
      texto: resolvido
        ? 'Chamado encerrado pelo cliente: o assistente (bm-help) resolveu a dúvida, sem precisar de técnico.'
        : cancelar ? 'Chamado cancelado pelo cliente antes do atendimento (saiu da fila).' : 'Chamado encerrado pelo cliente.',
    });
    await fecharSecao(c.id, 'encerrado');
    res.json({ success: true, status: cancelar ? 'cancelado' : 'encerrado' });
  }));

  /**
   * Instalador do BMSoft Suporte (agente do MeshCentral, link de 24 h gerado pelo BMDesk) no cartão
   * "Acesso remoto". O técnico fica sabendo pelo evento no chamado, para vincular o computador no BMDesk.
   * O link passa pelo BMDesk com o chamado e o nome que o cliente deu ao computador: o computador instalado
   * fica em destaque no "Acessar computador" deste chamado e o nome vira o apelido ao vincular
   */
  router.post('/api/publico/suporte/chamado/:token/agente', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(409, 'Este atendimento foi encerrado.');
    const nome = texto(req.body?.nome, 60).trim();
    if (!nome) throw erro(400, 'Informe o nome deste computador (ex.: Recepção) para baixar o BMSoft Suporte.');
    const { url } = await chamarBmdesk(`/api/integracao/convite?${new URLSearchParams({ chamado: String(c.id), nome })}`).catch((e) => {
      console.error(`Suporte (site): ${e.message}`);
      throw erro(503, 'O BMSoft Suporte está indisponível agora. Tente de novo em alguns minutos.');
    });
    await gravarMensagem({
      chamado_id: c.id,
      autor: 'sistema',
      texto: `Cliente abriu o instalador do BMSoft Suporte para o computador "${nome}": depois de instalado, use "Acessar computador" e "Vincular e acessar" no computador em destaque.`,
    });
    res.json({ url });
  }));

  /**
   * BM-ClientChat: o cliente abriu a janela do chat depois do cutucão. Fica na linha do tempo
   * do chamado (o técnico sabe que a pessoa está na frente do computador)
   */
  router.post('/api/publico/suporte/chamado/:token/visto', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    await gravarMensagem({ chamado_id: c.id, autor: 'sistema', texto: 'Cliente abriu o BM-ClientChat depois do cutucão.' });
    res.json({ success: true });
  }));

  /** Avaliação de 1 a 5 do atendimento encerrado (entra em Avaliações, como a do WhatsApp) */
  router.post('/api/publico/suporte/chamado/:token/avaliar', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (c.status !== 'encerrado') throw erro(409, 'A avaliação é feita depois que o atendimento termina.');
    if (Number(c.avaliado)) throw erro(409, 'Este atendimento já foi avaliado. Obrigado!');
    const nota = Number(req.body?.nota);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw erro(400, 'Escolha uma nota de 1 a 5.');
    const comentario = texto(req.body?.comentario, 2000) || null;
    await pool.query(
      `INSERT INTO avaliacoes (empresa_id, telefone, pessoa_id, atendente_id, departamento_id, chamado_id, origem, nota, comentario, situacao, pedida_em, respondida_em)
       VALUES (?, ?, ?, ?, ?, ?, 'atendente', ?, ?, 'respondida', NOW(), NOW())`,
      [c.empresa_id, c.contato_telefone || '', c.pessoa_id, c.atendente_id, c.departamento_id, c.id, nota, comentario],
    );
    await gravarMensagem({
      chamado_id: c.id,
      autor: 'sistema',
      texto: `Cliente avaliou ${'⭐'.repeat(nota)} (${nota})${comentario ? `: ${comentario}` : ''}`,
    });
    res.json({ success: true });
  }));

  return router;
}
