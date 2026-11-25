# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.0.4 — 2026-11-25

- Suporte: sai a tela Visitas do Site (e a rota da última visita). O aviso "entrou no site" não aparece no sino do bm-sol (fica no bm-crm); a gravação pelo widget continua, e a permissão de Visitas do Site no bm-crm é preservada.

## 0.0.3 — 2026-11-24

- Cadastros: Produtos e Grupos de Produtos saem do menu (fica só Serviços). Os itens da OS continuam aceitando produto, e a permissão de Produtos no bm-crm é preservada ao gravar permissões aqui.

## 0.0.2 — 2026-11-24

- Vercel: tirado o `memory` do `vercel.json` (ignorado no Active CPU, dava aviso no build).

## 0.0.1 — 2026-11-24

- Primeira versão: cópia do bm-crm 0.0.212 só com o atendimento do suporte (chamados, WhatsApp, painel de suporte, atividades, OS e app do técnico, pesquisas de satisfação, avaliações, visitas ao site e os cadastros usados pelo suporte).
- Fora: funil/Kanban, painel de vendas, negócios, propostas, pedidos, contratos, leads, prospecção, segmentos, campanhas, consultas por IA, importações e Configurações.
- Mesmo banco do bm-crm: webhooks e rotinas de fundo ficam só no bm-crm; as permissões de CRM do usuário são preservadas ao gravar permissões aqui.
