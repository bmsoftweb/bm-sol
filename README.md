# BM-SOL (Suporte On-line)

Cópia do bm-crm (`D:\projetos\bm-crm\code`) só com o atendimento da equipe de suporte:
Fila de Chamados, Chamados Ativos, WhatsApp, Painel de Suporte, Atividades, Ordens de Serviço
(e o app do técnico em `/tecnico`), Pesquisas de Satisfação, Avaliações, Visitas ao site e os
cadastros que o suporte usa (Pessoas, Departamentos, Templates, Categorias de chamado, Produtos,
Serviços). O widget de suporte do site (`/suporte`) e a tela remota (`/tela-remota`) continuam aqui.

Saiu tudo o que é de CRM: funil/Kanban, painel de vendas, negócios, propostas, pedidos, contratos,
leads, prospecção, segmentos, campanhas, consultas por IA, importações e Configurações.

## Mesmo banco do bm-crm

O `.env` aponta para o mesmo MySQL do bm-crm. Por isso:

- As rotinas de fundo (envio de WhatsApp, campanhas, automáticas, Bot das atividades, pesquisas por
  e-mail, contratos, Google Agenda, vigia da Evolution) e os webhooks (Evolution, D4Sign, aceite de
  proposta) **rodam só no bm-crm**. Aqui não há cron nem webhook.
- Configurações (WhatsApp, chatbot, e-mail, pesquisa...) são feitas no bm-crm.
- `usuarios.permissoes` é a mesma coluna nos dois: ao gravar as permissões aqui, as opções do CRM
  que o usuário tinha são preservadas (`mesclarPermissoes` em `server/permissoes.ts`).

## Como rodar

```bash
npm install
npm run dev
```

Sobe em <http://localhost:3000> (`PORT` muda a porta). Build de produção: `npm run build` e `npm start`.
