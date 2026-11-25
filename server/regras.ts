import { pool } from './db.js';
import { gravarMensagem } from './chamados.js';
import { assuntoComIcone } from './schema.js';

/**
 * Regras aplicadas antes e depois de qualquer gravação, venha ela das telas genéricas de CRUD
 * ou das rotinas (OS, Bot, pesquisas). Assim os campos calculados nunca dependem de qual tela gravou.
 *
 * As datas usam NOW() do MySQL, que roda em UTC-3 (ver db.ts).
 */

type Executor = { query: typeof pool.query };

/** Ajustes e validações no que vai ser gravado */
export async function antesDeGravar(recurso: string, payload: Record<string, any>, empresaId?: string) {
  // Contato: a pessoa precisa ser da empresa logada (o campo não é um vínculo escolhido na tela)
  if (recurso === 'pessoas_contatos' && payload.pessoa_id != null) {
    const [rows] = await pool.query<any[]>('SELECT 1 FROM pessoas WHERE id = ? AND empresa_id = ?', [payload.pessoa_id, empresaId]);
    if (!rows.length) throw new Error('A pessoa do contato não existe nesta empresa.');
  }
  if (recurso === 'atividades' && [payload.executor_id, payload.departamento_id, Number(payload.executor_bot) || null].filter(Boolean).length > 1) {
    throw new Error('Quem executa: escolha um usuário, um departamento ou o Bot, só um deles (nenhum = qualquer pessoa).');
  }
  if (recurso === 'atividades' && Number(payload.executor_bot) && payload.lembrete_para === 'nenhum') {
    throw new Error('Com o Bot executando, escolha em "Lembrete para" com quem ele conversa.');
  }
  // Reunião externa/interna/virtual: ícone no começo do assunto (a tela manda assunto e tipo juntos)
  // ponytail: gravação parcial com só um dos dois não ajusta o ícone; ler o registro aqui se isso passar a existir
  if (recurso === 'atividades' && 'assunto' in payload && 'tipo' in payload) {
    payload.assunto = assuntoComIcone(payload.assunto, payload.tipo);
  }
  // Item da OS: um serviço ou um produto, nunca os dois nem nenhum
  if (recurso === 'os_itens' && ['os_id', 'servico_id', 'produto_id'].some((k) => k in payload) && Boolean(payload.servico_id) === Boolean(payload.produto_id)) {
    throw new Error('Escolha um serviço ou um produto (só um dos dois).');
  }
  if (recurso === 'os_itens' && (payload.servico_id || payload.produto_id)) {
    // Sem valor informado, vale o preço do cadastro: o do serviço ou o de tabela do produto
    if (payload.preco_unitario == null || payload.preco_unitario === '') {
      const [rows] =
        payload.servico_id
          ? await pool.query<any[]>('SELECT preco FROM servicos WHERE id = ?', [payload.servico_id])
          : await pool.query<any[]>('SELECT preco_tabela AS preco FROM produtos WHERE id = ?', [payload.produto_id]);
      payload.preco_unitario = Number(rows[0]?.preco) || 0;
    }
    const quantidade = Number(payload.quantidade ?? 1);
    const bruto = quantidade * Number(payload.preco_unitario || 0);
    const desconto = Number(payload.desconto || 0);
    // Em branco = sem desconto (a coluna da OS não aceita vazio)
    payload.desconto = desconto;
    if (quantidade <= 0) throw new Error('A quantidade deve ser maior que zero.');
    if (desconto < 0 || desconto > bruto) throw new Error('O desconto não pode passar do valor do item.');
    payload.subtotal = Math.round((bruto - desconto) * 100) / 100;
  }
}

/** usuarioId: quem fez a alteração (atividade concluída agora grava quem concluiu; null = o sistema, ex.: o Bot) */
export async function aposGravar(recurso: string, id: string | null, db: Executor = pool, usuarioId: number | null = null) {
  // Cadastro feito aqui ganha o código "CRMWEB-<id>" (o mesmo do bm-crm, de onde vieram os cadastros); quem veio de fora
  // (importação do bmsoft, por exemplo) já chega com o código do sistema de origem
  if (recurso === 'pessoas' && id) {
    await db.query("UPDATE pessoas SET cod_integracao = CONCAT('CRMWEB-', id) WHERE id = ? AND cod_integracao IS NULL", [id]);
  }

  // OS: sem endereço, o principal do cliente (ou o primeiro); concluída sem término, termina agora
  if (recurso === 'ordens_servico' && id) {
    await db.query(
      `UPDATE ordens_servico o SET
          o.endereco = COALESCE(NULLIF(o.endereco, ''), (
            SELECT CONCAT_WS(', ', NULLIF(CONCAT_WS(', ', e.logradouro, e.numero), ''), e.complemento, e.bairro,
                             CONCAT_WS('/', e.cidade, e.uf), IF(e.cep IS NULL, NULL, CONCAT('CEP ', e.cep)))
              FROM pessoas_enderecos e WHERE e.pessoa_id = o.pessoa_id ORDER BY e.principal DESC, e.id LIMIT 1)),
          o.fim_em = IF(o.status = 'concluida', COALESCE(o.fim_em, NOW()), o.fim_em)
        WHERE o.id = ?`,
      [id],
    );
  }

  // Contato: um principal só por pessoa, e ativo (sem nenhum marcado, o primeiro ativo assume)
  if (recurso === 'pessoas_contatos' && id) {
    const [rows] = await db.query<any[]>('SELECT pessoa_id, principal, ativo FROM pessoas_contatos WHERE id = ?', [id]);
    const c = rows[0];
    if (c) {
      if (Number(c.principal) && !Number(c.ativo)) await db.query('UPDATE pessoas_contatos SET principal = 0 WHERE id = ?', [id]);
      else if (Number(c.principal)) await db.query('UPDATE pessoas_contatos SET principal = 0 WHERE pessoa_id = ? AND id <> ?', [c.pessoa_id, id]);
      await db.query(
        `UPDATE pessoas_contatos SET principal = 1
          WHERE id = (SELECT id FROM (SELECT id FROM pessoas_contatos WHERE pessoa_id = ? AND ativo = 1 ORDER BY id LIMIT 1) primeiro)
            AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM pessoas_contatos WHERE pessoa_id = ? AND principal = 1 AND ativo = 1) marcado)`,
        [c.pessoa_id, c.pessoa_id],
      );
    }
  }

  if (recurso === 'atividades' && id) {
    // Tarefa de chamado concluída (ou reaberta) agora: fica registrado na linha do tempo do chamado
    const [antes] = await db.query<any[]>('SELECT chamado_id, assunto, concluida, concluida_em FROM atividades WHERE id = ?', [id]);
    const t = antes[0];
    if (t?.chamado_id && Boolean(Number(t.concluida)) !== Boolean(t.concluida_em)) {
      const [u] = usuarioId ? await db.query<any[]>('SELECT nome FROM usuarios WHERE id = ?', [usuarioId]) : [[]];
      const por = Number(t.concluida) && u[0]?.nome ? ` por ${u[0].nome}` : '';
      await gravarMensagem({ chamado_id: t.chamado_id, usuario_id: usuarioId, autor: 'sistema', texto: `Tarefa ${Number(t.concluida) ? 'concluída' : 'reaberta'}${por}: ${t.assunto}.` });
    }
    // Quem concluiu: gravado só na passagem para concluída (concluida_em ainda vazia); reaberta, apaga.
    // concluida_por vem antes no SET: o MySQL aplica em ordem, e ele precisa ver a concluida_em de antes
    await db.query(
      `UPDATE atividades SET concluida_por = IF(concluida = 1, IF(concluida_em IS NULL, ?, concluida_por), NULL),
                             concluida_em = IF(concluida = 1, COALESCE(concluida_em, NOW()), NULL)
        WHERE id = ?`,
      [usuarioId, id],
    );
  }
}
