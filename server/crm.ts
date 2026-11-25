import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { friendlyDbError } from './crud.js';

/** Aviso das atividades novas e busca de produtos do Encerrar OS */
export function createCrmRouter() {
  const router = Router();

  // Atividades pendentes que executo ou do meu departamento (aviso de atividade nova no App)
  router.get('/crm/minhas-atividades', async (_req: Request, res: Response) => {
    try {
      const [r] = await pool.query<any[]>(
        `SELECT a.id, a.assunto, DATE_FORMAT(a.data_vencimento, '%d/%m/%Y') AS vencimento, TIME_FORMAT(a.hora_vencimento, '%H:%i') AS hora,
                IF(a.executor_id IS NULL, d.nome, NULL) AS departamento
           FROM atividades a
           LEFT JOIN departamentos d ON d.id = a.departamento_id
          WHERE a.empresa_id = ? AND COALESCE(a.concluida, 0) = 0
            AND (a.executor_id = ?
                 OR (a.executor_id IS NULL AND a.departamento_id = (SELECT u.departamento_id FROM usuarios u WHERE u.id = ?)))`,
        [String(res.locals.empresaId), res.locals.usuarioId, res.locals.usuarioId],
      );
      res.json(r);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err) });
    }
  });

  // Produtos ativos para a busca do Encerrar OS
  router.get('/crm/produtos', async (req: Request, res: Response) => {
    try {
      const q = `%${String(req.query.q || '').trim()}%`;
      const [rows] = await pool.query<any[]>(
        `SELECT id, codigo_sku, nome, preco_tabela, unidade_medida FROM produtos
          WHERE ativo = 1 AND empresa_id = ? AND (nome LIKE ? OR codigo_sku LIKE ? OR descricao LIKE ?)
          ORDER BY nome LIMIT 20`,
        [String(res.locals.empresaId), q, q, q],
      );
      res.json(rows.map((r) => ({ ...r, preco_tabela: Number(r.preco_tabela) })));
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err) });
    }
  });

  return router;
}
