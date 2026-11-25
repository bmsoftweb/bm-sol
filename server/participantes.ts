import { Router, Request, Response } from 'express';
import { pool } from './db.js';

/**
 * Envolvidos na atividade (tabela atividade_envolvidos): outros usuários da empresa, além de quem executa.
 * O formulário manda a lista completa de ids em `envolvidos` e aqui ela é sincronizada.
 */

const MAX_PARTICIPANTES = 50;

/** Ids únicos, validados como usuários da empresa (antes de gravar) */
export async function normalizarParticipantes(bruto: unknown, empresaId: string): Promise<number[]> {
  if (!Array.isArray(bruto)) throw new Error('Envolvidos em formato inválido.');
  const ids = Array.from(new Set(bruto.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  if (ids.length > MAX_PARTICIPANTES) throw new Error(`Informe no máximo ${MAX_PARTICIPANTES} envolvidos.`);
  if (!ids.length) return [];
  const [rows] = await pool.query<any[]>('SELECT id FROM usuarios WHERE empresa_id = ? AND id IN (?)', [empresaId, ids]);
  if (rows.length !== ids.length) throw new Error('Um dos envolvidos não é usuário desta empresa.');
  return ids;
}

/**
 * Deixa os envolvidos da atividade (tabela atividade_envolvidos) iguais à lista; quem executa não entra.
 * A tabela não tem empresa_id: o tenant vem da atividade (os ids já foram validados na empresa).
 */
export async function gravarEnvolvidosAtividade(atividadeId: string | number, ids: number[]) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM atividade_envolvidos WHERE atividade_id = ?${ids.length ? ' AND usuario_id NOT IN (?)' : ''}`,
      ids.length ? [atividadeId, ids] : [atividadeId],
    );
    if (ids.length) {
      await conn.query('INSERT IGNORE INTO atividade_envolvidos (atividade_id, usuario_id) VALUES ?', [
        ids.map((u) => [atividadeId, u]),
      ]);
    }
    await conn.query(
      `DELETE e FROM atividade_envolvidos e JOIN atividades a ON a.id = e.atividade_id AND a.executor_id = e.usuario_id WHERE e.atividade_id = ?`,
      [atividadeId],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export function createParticipantesRouter(): Router {
  const router = Router();

  router.get('/atividades/:id/envolvidos', async (req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT e.usuario_id AS id, u.nome FROM atividade_envolvidos e
           JOIN atividades a ON a.id = e.atividade_id JOIN usuarios u ON u.id = e.usuario_id
          WHERE a.empresa_id = ? AND e.atividade_id = ? ORDER BY u.nome`,
        [String(res.locals.empresaId), req.params.id],
      );
      res.json(rows);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
