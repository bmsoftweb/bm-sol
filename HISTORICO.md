# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.0.8 — 2026-11-27

- Ligação entre usuários: quem liga ouve o som de linha chamando ("tuuu" de 425 Hz por 1 s, a cada 5 s) até atenderem; quem recebe continua com o trinado de telefone.
- Sobras das Visitas do Site saem do código: registro de visitas no `widget.js` e no servidor (`/api/publico/suporte/:empresa/visitas`), o aviso "Alguém entrou no site" da campainha e das permissões, e o selo "Visitando...".

## 0.0.7 — 2026-11-25

- CRM fora do código: leads, negócios, funis e etapas, propostas, pedidos e contratos, campanhas (e o número das campanhas, "SAIR"), prospecção, segmentos, mensagens automáticas, Google Agenda, D4Sign e revezamento de vendedores, no servidor e nas telas.
- Bot e Automação: o bot só passa a conversa para um humano; saem os nós Registrar lead e Registrar Prospecção e a condição "negócio aberto".
- Conversas: sem lead e sem escolha de número; "Cadastrar" cria o cliente em Pessoas. Configurações › WhatsApp só com o número do suporte.
- Pesquisas de satisfação: saem o filtro por segmento e o "Sai pelo". Pessoas sem Tipo e "Não receber campanhas"; Usuários sem Revezamento.
- Sai o endpoint público `/api/publico/leads` (Agendar apresentação do site). Permissões gravadas sem preservar as do bm-crm.
- Correção: volta a busca de produtos do Encerrar OS (`/api/crm/produtos`).
- Script para apagar tabelas e colunas do CRM no bmsol: `sqls/remover_crm_bmsol.sql` (fora do código, rodado à parte).

## 0.0.6 — 2026-11-25

- Banco próprio: o bm-sol passa a usar o banco `bmsol` (cópia do `crmweb`), no `.env`, na Vercel e no padrão do `server/db.ts`. As tabelas de CRM continuam por enquanto e saem depois.
- Voltam ao bm-sol o webhook da Evolution (número do suporte, sem a parte de campanhas) e as rotinas do suporte: inatividade, Bot das atividades, Automação, respostas da pesquisa por e-mail, vigia do WhatsApp (só o número do suporte) e limpeza das gravações antigas (cron da Vercel e `setInterval` local).
- Travas do MySQL com nome próprio (`bmsol_`), para não esbarrar nas do bm-crm no mesmo servidor.

## 0.0.5 — 2026-11-25

- Configurações volta ao menu (Sistema, só administrador) com as abas do suporte: WhatsApp (número do atendimento), Automação (fluxo do atendimento), Chatbot e pesquisa, IA e E-mail do suporte. Mesma tabela `config` do bm-crm: o que muda aqui vale lá. As abas do CRM continuam só no bm-crm.
- Servidor: voltam a rota dos arquivos da Automação e a lista de funis (só leitura) para o nó Registrar Prospecção.

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
