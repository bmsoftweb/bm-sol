import {
  ResourceDef,
  ListaPaginada,
  FiltroAvancado,
  RegistroCrud,
  OpcaoRef,
  DashboardData,
  Usuario,
  EmpresaSessao,
  Funil,
  CardNegocio,
  FichaNegocio,
  ProdutoBusca,
  Id,
  CampoPersonalizado,
  Endereco,
} from '../types';

/** O token da sessão acompanha toda requisição no header Authorization */
let tokenAtual: string | null = null;
let aoExpirar: ((msg: string) => void) | null = null;

export function setTokenSessao(token: string | null) {
  tokenAtual = token;
}

/** Chamado quando o servidor recusa o token (sessão expirada ou usuário desativado) */
export function setAoExpirarSessao(fn: ((msg: string) => void) | null) {
  aoExpirar = fn;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (tokenAtual) h.Authorization = `Bearer ${tokenAtual}`;
  return h;
}

async function parseOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Falha na requisição (HTTP ${res.status}).`;
    if (res.status === 401 && aoExpirar) aoExpirar(msg);
    throw new Error(msg);
  }
  return data;
}

const get = (url: string) => fetch(url, { headers: headers() }).then(parseOrThrow);
const enviar = (method: string, url: string, corpo?: unknown) =>
  fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }).then(parseOrThrow);

// ------------------------------------------------------------
// Autenticação e preferências
// ------------------------------------------------------------
export async function login(payload: { email: string; senha: string }): Promise<{
  success: boolean;
  primeiroAcesso?: boolean;
  message?: string;
  token: string;
  usuario: Usuario;
  empresa: EmpresaSessao;
}> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Falha no login (HTTP ${res.status}).`);
  return data;
}

/**
 * Confere se a sessão guardada no navegador ainda vale.
 * Retorna false só quando o servidor recusa; falha de rede ou de banco devolve null,
 * para não deslogar ninguém por instabilidade.
 */
export async function validarSessao(): Promise<{ valida: boolean | null; error?: string; usuario?: Usuario }> {
  try {
    const res = await fetch('/api/sessao', { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { valida: false, error: data?.error };
    return { valida: res.ok ? true : null, error: data?.error, usuario: res.ok ? data?.usuario : undefined };
  } catch {
    return { valida: null };
  }
}

/** Troca da própria senha (confere a atual no servidor) */
export const trocarMinhaSenha = (atual: string, nova: string) => enviar('POST', '/api/minha-senha', { atual, nova });

export const fetchConfigListas = (): Promise<Record<string, unknown>> => get('/api/config-listas');

export async function saveConfigListas(config: Record<string, unknown>): Promise<void> {
  await enviar('PUT', '/api/config-listas', config);
}

// ------------------------------------------------------------
// Metadados e painel
// ------------------------------------------------------------
export const fetchResources = (): Promise<ResourceDef[]> => get('/api/meta/resources');

// ------------------------------------------------------------
// CRUD genérico
// ------------------------------------------------------------
export function listRecords(
  resource: string,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    filterField?: string;
    filterValue?: string;
    filters?: FiltroAvancado[];
    /** Recurso em árvore: só as raízes */
    arvore?: 'raizes';
    /** Só as do usuário logado (recurso com filtro "minhas") */
    minhas?: boolean;
  } = {},
): Promise<ListaPaginada> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.dir) qs.set('dir', params.dir);
  if (params.filterField && params.filterValue) {
    qs.set('filter_field', params.filterField);
    qs.set('filter_value', params.filterValue);
  }
  if (params.filters && params.filters.length) qs.set('filters', JSON.stringify(params.filters));
  if (params.arvore) qs.set('arvore', params.arvore);
  if (params.minhas) qs.set('minhas', '1');
  return get(`/api/crud/${resource}?${qs.toString()}`);
}

export const getRecord = (resource: string, id: Id): Promise<RegistroCrud> =>
  get(`/api/crud/${resource}/${encodeURIComponent(String(id))}`);

/** Atividades gravadas por este usuário neste navegador: não geram o aviso de "atividade para você" */
export const atividadesGravadasAqui = new Set<number>();

// Gravar muda a lista do recurso: os combos dele são relidos (ex.: segmento criado na Prospecção)
/** aviso: o que o servidor fez a mais ao gravar (ex.: campanha gerou os disparos) */
export const createRecord = (resource: string, payload: RegistroCrud): Promise<{ success: boolean; id: string; aviso?: string | null }> =>
  enviar('POST', `/api/crud/${resource}`, payload).then((r: any) => {
    invalidateOptions(resource);
    if (resource === 'atividades') atividadesGravadasAqui.add(Number(r.id));
    return r;
  });

export const updateRecord = (resource: string, id: Id, payload: RegistroCrud): Promise<{ success: boolean; aviso?: string | null }> => {
  if (resource === 'atividades') atividadesGravadasAqui.add(Number(id));
  return enviar('PUT', `/api/crud/${resource}/${encodeURIComponent(String(id))}`, payload).then((r: any) => {
    invalidateOptions(resource);
    return r;
  });
};

export const deleteRecord = (resource: string, id: Id): Promise<{ success: boolean }> =>
  enviar('DELETE', `/api/crud/${resource}/${encodeURIComponent(String(id))}`).then((r: any) => {
    invalidateOptions(resource);
    return r;
  });

export const buscarProdutos = (q: string): Promise<ProdutoBusca[]> => get(`/api/crm/produtos?q=${encodeURIComponent(q)}`);

/** Ordem de serviço completa para impressão (server/os.ts) */
export const fetchOS = (id: Id): Promise<RegistroCrud> => get(`/api/os/${encodeURIComponent(String(id))}`);
/** Cria a OS a partir da atividade (menu das Atividades); devolve a OS para abrir */
export const gerarOSDaAtividade = (atividadeId: Id): Promise<{ id: number; numero: number }> =>
  enviar('POST', `/api/os/da-atividade/${encodeURIComponent(String(atividadeId))}`);
/** Fechamento da OS pela web: o que foi feito, horários, quem assinou e a lista inteira de serviços */
export const encerrarOS = (id: Id, dados: RegistroCrud): Promise<{ ok: boolean }> =>
  enviar('POST', `/api/os/${encodeURIComponent(String(id))}/encerrar`, dados);

// ------------------------------------------------------------
// Combos de chave estrangeira, com cache em memória
// ------------------------------------------------------------
const optionsCache = new Map<string, OpcaoRef[]>();

export async function fetchOptions(resource: string, labelField: string): Promise<OpcaoRef[]> {
  const key = `${resource}:${labelField}`;
  const cached = optionsCache.get(key);
  if (cached) return cached;
  const data = await get(`/api/options/${resource}?label_field=${encodeURIComponent(labelField)}`);
  optionsCache.set(key, data);
  return data;
}

/** Invalida o cache de combos após gravações que alteram listas de referência */
export function invalidateOptions(resource?: string) {
  if (!resource) {
    optionsCache.clear();
    return;
  }
  for (const key of Array.from(optionsCache.keys())) {
    if (key.startsWith(`${resource}:`)) optionsCache.delete(key);
  }
}

/** Usuários envolvidos no negócio (ids e nomes) */
export const fetchParticipantes = (id: Id, recurso: 'negocios' | 'atividades' = 'negocios'): Promise<{ id: number; nome: string }[]> =>
  get(`/api/${recurso}/${id}/${recurso === 'atividades' ? 'envolvidos' : 'participantes'}`).then((l) => {
    if (!Array.isArray(l)) throw new Error('Não foi possível carregar os envolvidos: resposta inesperada do servidor.');
    return l;
  });

/** Endereços da pessoa, o principal primeiro */
export const fetchEnderecos = (pessoaId: Id): Promise<Endereco[]> =>
  get(`/api/pessoas/${pessoaId}/enderecos`).then((l) => {
    // Resposta que não é lista (ex.: servidor desatualizado devolvendo a página) não pode chegar ao formulário
    if (!Array.isArray(l)) throw new Error('Não foi possível carregar os endereços: resposta inesperada do servidor.');
    return l;
  });

/** Grava no Vercel Blob a foto do produto já reduzida (JPEG) na posição 1 a 4 e devolve o endereço */
export const enviarFotoProduto = (produtoId: Id, posicao: number, imagem: string): Promise<{ url: string }> =>
  enviar('POST', `/api/produtos/${encodeURIComponent(String(produtoId))}/fotos/${posicao}`, { imagem });
/** Baixa pelo servidor uma imagem da internet (o navegador não lê imagem de outro site) */
export const buscarFotoInternet = (url: string): Promise<{ imagem: string }> => enviar('POST', '/api/produtos/fotos/buscar', { url });

// ------------------------------------------------------------
// Configurações da empresa (tabela config)
// ------------------------------------------------------------
export const fetchConfig = <T = any>(grupo: string, chave: string): Promise<{ valor: T | null }> =>
  get(`/api/config/${grupo}/${chave}`);
/** Permissões do usuário: opções do menu que acessa (null = todas) */
export const salvarPermissoes = (usuarioId: number, permissoes: string[] | null): Promise<{ success: boolean }> =>
  enviar('PUT', `/api/usuarios/${usuarioId}/permissoes`, { permissoes });

/**
 * Campos personalizados de pessoas, com cache: a definição muda raramente e é lida
 * a cada abertura do formulário.
 */
let camposPessoaCache: Promise<CampoPersonalizado[]> | null = null;

export function fetchCamposPersonalizados(): Promise<CampoPersonalizado[]> {
  if (!camposPessoaCache) {
    camposPessoaCache = fetchConfig<CampoPersonalizado[]>('pessoas', 'campos_personalizados')
      .then(({ valor }) => (Array.isArray(valor) ? valor : []))
      .catch((err) => {
        camposPessoaCache = null; // falha não fica em cache
        throw err;
      });
  }
  return camposPessoaCache;
}

// ------------------------------------------------------------
// Campanhas
// ------------------------------------------------------------
export interface RegraCriterio {
  regra: string;
  rotulo: string;
  valor: 'numero' | 'texto' | 'sim_nao' | 'tipo_pessoa' | 'segmento' | 'lista' | 'publico';
  /** Campo personalizado decimal: casas do valor */
  casas?: number;
  /** Campo personalizado de lista: as opções */
  opcoes?: string[];
}
let regrasCache: Promise<RegraCriterio[]> | null = null;
/** Botão "Testar" dos critérios da campanha: total do público e as 50 primeiras pessoas */
export interface TesteCriterios {
  total: number;
  pessoas: { id: number; nome: string; tipo: string; cod_integracao: string | null; telefone: string | null; email: string | null; cidade: string | null }[];
  /** Seleção com IA: o comando que rodou no banco */
  sqlExecutado?: string;
}
export const testarCriterios = (criterios: unknown): Promise<TesteCriterios> => enviar('POST', '/api/campanhas/criterios/testar', { criterios });

/** Campanhas › "Selecionar com IA": a IA monta o SQL do público a partir do pedido (server/selecaoIa.ts) */
export interface SelecaoIa {
  modo: 'ia';
  pedido: string;
  sql: string;
  explicacao: string;
}
export const gerarSelecaoIa = (pedido: string): Promise<SelecaoIa & { total: number }> => enviar('POST', '/api/campanhas/ia/gerar', { pedido });

export const fetchRegrasCriterio = (): Promise<RegraCriterio[]> =>
  (regrasCache ??= get('/api/campanhas/regras').catch((err: Error) => {
    regrasCache = null;
    throw err;
  }));

/** Painel de Suporte: indicadores do período e do anterior equivalente (server/painelSuporte.ts) */
export interface ResumoSuporte {
  chamados: { abertos: number; encerrados: number; min_assumir: number | null; min_resolver: number | null };
  whatsapp: { total: number; so_bot_pct: number | null; min_duracao: number | null };
  satisfacao: { respondidas: number; media: number | null; resposta_pct: number | null };
}
export interface Contagem {
  nome: string;
  qtd: number;
  extra?: number;
}
export interface PainelSuporteDados {
  periodo: { chave: string; atual: { de: string; ate: string }; anterior: { de: string; ate: string } };
  atual: ResumoSuporte;
  anterior: ResumoSuporte;
  /** hoje = chamados abertos hoje; ontem = abertos ontem (o dia inteiro) */
  agora: { em_aberto: number; na_fila: number; sla_estourado: number; pendente_cliente: number; pausados: number; hoje: number; ontem: number };
  serie: { unidade: 'dia' | 'semana' | 'mes'; pontos: { k: string; abertos: number; encerrados: number; whatsapp: number }[] };
  canais: Contagem[];
  categorias: Contagem[];
  prioridades: Contagem[];
  departamentos: Contagem[];
  motivos: Contagem[];
  notas: Contagem[];
  mapa: { dia: number; hora: number; n: number }[];
  clientes: Contagem[];
  tecnicos: { id: number; nome: string; encerrados: number; min_resolver: number | null; whatsapp: number; media: number | null; avaliacoes: number }[];
}
export const painelSuporte = (periodo: string): Promise<PainelSuporteDados> => get(`/api/suporte/painel?periodo=${encodeURIComponent(periodo)}`);

/** Trava do contrato assinado: só muda por aditivo, depois de liberado por um administrador */
export interface TravaContrato {
  assinado: boolean;
  liberado_em: string | null;
  liberado_por: string | null;
  pode_liberar: boolean;
  /** Assinado e não liberado para aditivo */
  travado: boolean;
  /** Campos do contrato que continuam editáveis quando travado */
  campos_livres: string[];
}
export const travaContrato = (id: Id): Promise<TravaContrato> => get(`/api/contratos/${encodeURIComponent(String(id))}/trava`);

// ------------------------------------------------------------
// Conversas do WhatsApp
// ------------------------------------------------------------
export interface ConversaResumo {
  telefone: string;
  pessoa_id: number | null;
  /** Lead dono do número (quando não há pessoa) */
  lead_id?: number | null;
  nome: string | null;
  /** Contato da pessoa dono do número (pessoas_contatos), com departamento ou cargo */
  contato_id: number | null;
  contato_nome: string | null;
  contato_setor: string | null;
  /** Nome do perfil no WhatsApp (quem não está em Pessoas) */
  nome_contato: string | null;
  direcao: 'recebida' | 'enviada';
  tipo: string;
  texto: string | null;
  arquivo_nome: string | null;
  situacao: string;
  data_hora: string;
  nao_vistas: number;
  /** Departamento escolhido no menu do chatbot */
  departamento: string | null;
  /** bot = com o bot/jornada; aguardando = esperando alguém atender; atendimento = alguém pegou; encerrado = encerrado e o cliente ainda não escreveu de novo */
  estado: 'bot' | 'aguardando' | 'atendimento' | 'encerrado' | null;
  atendente_id: number | null;
  atendente_nome: string | null;
  atendido_em: string | null;
  aguardando_desde: string | null;
  /** 1ª mensagem do cliente no atendimento atual (depois do último encerramento) */
  chegou_em: string | null;
  /** Número por onde a conversa entrou: provedor (padrão) ou campanhas */
  conta: 'provedor' | 'campanhas';
  /** Técnico padrão do cliente (pessoas.tecnico_padrao_id) */
  tecnico_padrao_nome: string | null;
  /** Pausada por quem atendia: voltou para a Fila de Chamados */
  pausada: boolean;
  /** Última mensagem privada (oculta: de outro departamento, sem o conteúdo) */
  privada?: { departamento: string; oculta?: boolean } | null;
}

export interface MensagemWhatsApp {
  id: number;
  direcao: 'recebida' | 'enviada';
  tipo: string;
  texto: string | null;
  arquivo_nome: string | null;
  situacao: 'pendente' | 'enviada' | 'entregue' | 'lida' | 'falhou' | 'recebida';
  usuario_nome: string | null;
  campanha: boolean;
  /** Mensagem automática (Configurações › Mensagens automáticas) */
  automatica: boolean;
  /** Resposta do chatbot */
  bot: boolean;
  /** Motivo, quando não saiu */
  erro: string | null;
  data_hora: string;
  /** Privada de um departamento (oculta: o usuário não é de lá; vem sem o conteúdo) */
  privada?: { departamento: string; oculta?: boolean } | null;
  /** Mensagem que esta responde (citação); texto null = privada de outro departamento */
  resposta?: { id: number; direcao: 'enviada' | 'recebida' | null; tipo: string | null; texto: string | null; arquivo_nome: string | null } | null;
  /** Segundos que faltam para quem enviou poder apagar (1 minuto); null = não pode */
  apagar_seg?: number | null;
}

/** minhas: as sem departamento, as do meu departamento e as que eu assumi */
export const fetchConversas = (busca = '', minhas = false): Promise<ConversaResumo[]> =>
  get(`/api/whatsapp/conversas?busca=${encodeURIComponent(busca)}${minhas ? '&minhas=1' : ''}`);
/** Mensagens da conversa; abrir marca as recebidas como vistas */
export const fetchConversa = (
  telefone: string,
): Promise<{
  pessoa: { id: number; nome: string } | null;
  /** Sem pessoa: o lead com esse número (Marketing › Leads) */
  lead: { id: number; nome: string } | null;
  contato: { id: number; nome: string; cargo: string | null; departamento: string | null } | null;
  /** Com o chatbot ligado: quem atende a conversa (null = chatbot desligado) */
  atendimento: 'bot' | 'humano' | null;
  /** Departamento escolhido no menu do chatbot */
  departamento: string | null;
  /** Nome do assistente (Configurações › Chatbot): as respostas do bot aparecem como "Eloisa (bot)" */
  bot_nome: string | null;
  /** bot = com o bot/jornada; aguardando = esperando alguém atender; atendimento = alguém pegou */
  estado: 'bot' | 'aguardando' | 'atendimento' | 'encerrado';
  /** Quem pegou a conversa (trava: só ele responde) */
  atendente: { id: number; nome: string } | null;
  atendido_em: string | null;
  aguardando_desde: string | null;
  eu_atendo: boolean;
  sou_admin: boolean;
  /** Bot ou jornada atendem este número (há para onde devolver) */
  com_bot: boolean;
  /** Número por onde o cliente escreveu por último: a resposta já vem com ele escolhido */
  conta: 'provedor' | 'campanhas';
  /** Há WhatsApp das campanhas configurado (a tela mostra a escolha do número) */
  tem_campanhas: boolean;
  /** Há atendimento em andamento (o botão Encerrar aparece) */
  encerravel: boolean;
  nome_contato: string | null;
  mensagens: MensagemWhatsApp[];
}> =>
  get(`/api/whatsapp/conversas/${encodeURIComponent(telefone)}`);
/** Envia pela conversa; com a atividade que a abriu, conclui a atividade. telefone: o número da conversa (pode vir sem o 9) */
/** Arquivo para enviar na conversa (base64 sem o prefixo data:) */
export interface ArquivoConversa {
  tipo: 'imagem' | 'video' | 'audio' | 'documento';
  base64: string;
  mimetype: string;
  nome: string;
}
/** Responde a conversa com texto, ou com um arquivo (o texto vira a legenda) */
export const responderConversa = (
  telefone: string,
  texto: string,
  atividadeId?: number | null,
  arquivo?: ArquivoConversa | null,
  /** Mensagem da conversa que esta responde (aparece citada no WhatsApp do cliente) */
  respostaDe?: number | null,
  /** Número que envia: o principal ou o das campanhas */
  conta?: 'provedor' | 'campanhas',
): Promise<{ success: boolean; telefone: string; atividade_concluida: boolean }> =>
  enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}`, {
    texto,
    atividade_id: atividadeId ?? null,
    arquivo: arquivo ?? undefined,
    resposta_de: respostaDe ?? null,
    conta,
  });
/** Conversa de uma atividade WhatsApp: o número do cliente (pessoa da atividade ou do negócio) */
export const fetchConversaDaAtividade = (
  id: Id,
): Promise<{ telefone: string; nome: string | null; atividade: { id: number; assunto: string; concluida: boolean } }> =>
  get(`/api/whatsapp/atividades/${encodeURIComponent(String(id))}/conversa`);
/** Imagem, áudio ou vídeo de uma mensagem do WhatsApp, como endereço local (blob:) */
export async function fetchMidiaMensagem(id: number): Promise<string> {
  const res = await fetch(`/api/whatsapp/mensagens/${id}/midia`, { headers: headers() });
  if (!res.ok) await parseOrThrow(res);
  return URL.createObjectURL(await res.blob());
}
/** Conversa passada ao departamento do usuário que ninguém assumiu (aviso sonoro) */
export interface Encaminhada {
  telefone: string;
  nome: string | null;
  departamento: string;
  desde: string;
}
export const fetchNaoVistas = (): Promise<{
  total: number;
  encaminhadas: Encaminhada[];
  /** Última conversa transferida para o usuário por outra pessoa (id do evento) */
  transferida: { id: number; telefone: string; nome: string | null; de: string | null } | null;
  /** Conversas minhas em que o cliente espera a minha resposta há X minutos (id da última mensagem dele) */
  esperando?: { id: number; telefone: string; nome: string | null }[];
}> => get('/api/whatsapp/nao-vistas');
/** Encerrar a sessão da conversa: como se o tempo de devolver ao bot tivesse passado */
export const encerrarConversa = (telefone: string): Promise<{ success: boolean }> =>
  enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/encerrar`);
/** Tira de Aguardando a mensagem que não pedia atendimento (sem pesquisa, não conta como atendimento) */
/** Procura de novo o dono do número depois de corrigir o cadastro (server/conversas.ts) */
export const religarConversa = (telefone: string): Promise<{ success: boolean; pessoa_id: number | null; lead_id: number | null }> =>
  enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/religar`);
export const descartarConversa = (telefone: string): Promise<{ success: boolean }> =>
  enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/descartar`);
/** Template de mensagem (Cadastros › Templates) */
export interface TemplateMensagem {
  id: number;
  descricao: string;
  texto: string;
}
/** Templates ativos do canal, para o botão dos chats */
export const fetchTemplatesAtivos = (canal: 'whatsapp' | 'suporte'): Promise<TemplateMensagem[]> => get(`/api/templates/ativos?canal=${canal}`);
/** Limpar a conversa (só administrador): apaga as mensagens do número no CRM */
export const limparConversa = (telefone: string): Promise<{ success: boolean; apagadas: number }> =>
  enviar('DELETE', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}`);
/** Assumir a conversa (o chatbot para) ou devolvê-la ao chatbot */
export const mudarAtendimentoConversa = (telefone: string, atendimento: 'bot' | 'humano'): Promise<{ success: boolean }> =>
  enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/atendimento`, { atendimento });
/** Atender: pega a conversa e trava para o usuário */
/** Mensagem privada: privada=false torna pública; sem departamento, vale o do usuário (o administrador escolhe) */
export const marcarMensagemPrivada = (id: number, privada: boolean, departamentoId?: string | number | null): Promise<{ success: boolean }> =>
  enviar('POST', `/api/whatsapp/mensagens/${id}/privada`, { privada, departamento_id: departamentoId ?? null });
/** Apagar para todos: só quem enviou, até 1 minuto depois */
export const apagarMensagem = (id: number): Promise<{ success: boolean }> => enviar('DELETE', `/api/whatsapp/mensagens/${id}`);
export const atenderConversa = (telefone: string): Promise<{ success: boolean }> => enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/atender`);
/** Pausar: a conversa sai de quem atende e volta para a Fila de Chamados */
export const pausarConversa = (telefone: string): Promise<{ success: boolean }> => enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/pausar`);
/** Transferir para um atendente ou um departamento */
export const transferirConversa = (telefone: string, destino: { usuario_id?: number; departamento_id?: number }): Promise<{ success: boolean }> =>
  enviar('POST', `/api/whatsapp/conversas/${encodeURIComponent(telefone)}/transferir`, destino);

/** Para quem dá para abrir uma conversa: pessoa, contato ou o número digitado */
export interface DestinoConversa {
  tipo: 'pessoa' | 'contato' | 'numero';
  pessoa_id: number | null;
  contato_id: number | null;
  nome: string;
  /** Contato: setor e a pessoa (empresa-cliente) */
  detalhe: string | null;
  /** Como está no cadastro */
  fone: string | null;
  /** Número da conversa; null quando não dá para mandar (aviso diz o motivo) */
  telefone: string | null;
  aviso: string | null;
}
/** Número da conversa de uma pessoa ou de um contato (ícone do WhatsApp nas listas) */
export const fetchNumeroConversa = (de: { pessoaId?: Id; contatoId?: Id; telefone?: string }): Promise<{ telefone: string; nome: string }> =>
  get(
    `/api/whatsapp/numero?${
      de.telefone
        ? `telefone=${encodeURIComponent(de.telefone)}`
        : de.contatoId
          ? `contato_id=${encodeURIComponent(String(de.contatoId))}`
          : `pessoa_id=${encodeURIComponent(String(de.pessoaId))}`
    }`,
  );
export const fetchDestinosConversa = (busca: string): Promise<DestinoConversa[]> =>
  get(`/api/whatsapp/destinos?busca=${encodeURIComponent(busca)}`);

// ------------------------------------------------------------
// Chamados de suporte (server/chamados.ts)
// ------------------------------------------------------------

export interface ChamadoResumo {
  id: number;
  numero: number;
  titulo: string;
  status: 'aguardando' | 'em_andamento' | 'pendente_cliente' | 'pausado' | 'encerrado' | 'cancelado';
  prioridade: 'baixa' | 'normal' | 'alta' | 'urgente';
  canal: string;
  pessoa_id: number | null;
  pessoa_nome: string | null;
  /** Quem abriu pelo site (nome da pessoa, não da empresa) */
  contato_nome: string | null;
  categoria_nome: string | null;
  categoria_cor: string | null;
  atendente_id: number | null;
  atendente_nome: string | null;
  departamento_nome: string | null;
  /** Técnico padrão do cliente (pessoas.tecnico_padrao_id): quem deve atender; outro pode assumir */
  tecnico_padrao_id: number | null;
  tecnico_padrao_nome: string | null;
  criado_em: string;
  assumido_em: string | null;
  encerrado_em: string | null;
  sla_prazo: string | null;
  espera_min: number;
  sla_vencido: boolean;
  /** Houve ligação atendida com o cliente (telefone do chat do site) */
  ligou?: boolean;
  ultima: string | null;
  /** Só na fila */
  posicao?: number;
  /** Posição entre os chamados abertos (na fila ou em atendimento), por ordem de chegada; encerrado: null */
  nr_fila: number | null;
}

export interface ChamadoMensagem {
  id: number;
  autor: 'equipe' | 'cliente' | 'sistema' | 'assistente';
  texto: string;
  interna: boolean;
  criado_em: string;
  usuario_nome: string | null;
  /** Tem print (chat do site): a imagem vem por baixarImagemChamado */
  tem_imagem?: number | boolean;
}

export interface ChamadoDetalhe extends ChamadoResumo {
  descricao: string | null;
  /** Conclusão escrita pelo técnico ao encerrar */
  conclusao: string | null;
  aberto_por_nome: string | null;
  pessoa_telefone: string | null;
  /** Telefones informados por quem abriu pelo site: celular/WhatsApp e fixo (opcional) */
  contato_telefone: string | null;
  contato_fixo: string | null;
  /** Número do AnyDesk do cadastro da pessoa */
  anydesk_id: string | null;
  eu_atendo: boolean;
  sou_admin: boolean;
  mensagens: ChamadoMensagem[];
  /** Tarefas do chamado (atividades com chamado_id), as pendentes primeiro */
  tarefas: TarefaChamado[];
  /** Quantos outros chamados o mesmo cliente tem (botão Histórico) */
  historico_qtd: number;
}

/** Outro chamado do mesmo cliente (Histórico do chamado aberto) */
export interface ChamadoHistorico {
  id: number;
  numero: number;
  titulo: string;
  status: ChamadoResumo['status'];
  canal: string;
  criado_em: string;
  encerrado_em: string | null;
  conclusao: string | null;
  atendente_nome: string | null;
  categoria_nome: string | null;
  nota: number | null;
}
export const fetchHistoricoChamado = (id: number): Promise<ChamadoHistorico[]> => get(`/api/chamados/${id}/historico`);

export interface TarefaChamado {
  id: number;
  assunto: string;
  tipo: string;
  data_vencimento: string;
  hora_vencimento: string | null;
  concluida: boolean;
  concluida_em: string | null;
  observacao: string | null;
  quem_executa: string;
  envolvidos: string | null;
  executor_bot: number;
  bot_resumo: string | null;
}

/** Conversas do bot de uma atividade (server/atividadeBot.ts) */
export interface ConversaBotAtividade {
  id: number;
  assunto: string;
  executor_bot: number;
  bot_iniciado_em: string | null;
  bot_resumo: string | null;
  concluida: number;
  conversas: {
    id: number;
    nome: string | null;
    canal: 'whatsapp' | 'email';
    destino: string;
    situacao: 'conversando' | 'concluida' | 'humano' | 'sem_resposta' | 'enviado' | 'falhou';
    resumo: string | null;
    criado_em: string;
    encerrada_em: string | null;
    mensagens: { id: number; direcao: 'enviada' | 'recebida'; texto: string; criado_em: string }[];
  }[];
}
export const fetchConversaBot = (atividadeId: Id): Promise<ConversaBotAtividade> => get(`/api/atividades/${atividadeId}/bot`);

/** Nova tarefa no chamado: mesma janela e mesmos campos da atividade (server/chamados.ts) */
export const criarTarefaChamado = (chamadoId: number, dados: RegistroCrud): Promise<{ id: number }> =>
  enviar('POST', `/api/chamados/${chamadoId}/tarefas`, dados).then((r: any) => {
    atividadesGravadasAqui.add(Number(r.id));
    return r;
  });

/** Atividades pendentes que o usuário executa ou do departamento dele (aviso de atividade nova) */
export const fetchMinhasAtividades = (): Promise<{
  id: number;
  assunto: string;
  vencimento: string | null;
  hora: string | null;
  /** Preenchido quando é do departamento (sem usuário definido) */
  departamento: string | null;
}[]> =>
  get('/api/crm/minhas-atividades');

export type FiltroChamados = 'meus' | 'todos' | 'aguardando' | 'andamento' | 'encerrados';

export const fetchFilaChamados = (): Promise<ChamadoResumo[]> => get('/api/chamados/fila');

/** Notificações do usuário logado (campainha do cabeçalho; server/notificacoes.ts) */
export interface Notificacao {
  id: number;
  tipo: string;
  titulo: string;
  texto: string | null;
  /** Tela que abre (id do menu), com o que ela precisa depois de "|" (ex.: "conversas|5547999998888") */
  link: string | null;
  registro_id: number | null;
  lida_em: string | null;
  criada_em: string;
}
export const fetchNotificacoes = (soNaoLidas = false): Promise<{ itens: Notificacao[]; naoLidas: number }> =>
  get(`/api/notificacoes${soNaoLidas ? '?naoLidas=1' : ''}`);
export const marcarNotificacaoLida = (id: number, lida = true) => enviar('POST', `/api/notificacoes/${id}/lida`, { lida });
export const marcarTodasLidas = () => enviar('POST', '/api/notificacoes/lidas');
/** Tipos de notificação desligados para o usuário (Usuários › Permissões › Notificações) */
export const fetchNotificacoesDesligadas = (usuarioId: number): Promise<{ desligadas: string[] }> => get(`/api/usuarios/${usuarioId}/notificacoes`);
export const salvarNotificacoesDesligadas = (usuarioId: number, desligadas: string[]) => enviar('PUT', `/api/usuarios/${usuarioId}/notificacoes`, { desligadas });
export const fetchContagemChamados = (): Promise<{
  /** Ligação de outro técnico tocando para o usuário (oferta WebRTC de quem liga) */
  ligacao: { id: number; de: string; oferta: string } | null;
  fila: number;
  /** Chamado da fila esperando há mais de 10 minutos (o mais antigo): buzina */
  atrasado: { id: number; numero: number; nome: string | null; espera_min: number } | null;
  /** Último chamado da fila (o mais novo) */
  novo: { id: number; numero: number; nome: string | null } | null;
  /** O usuário é do departamento Suporte: ouve o aviso de chamado novo */
  suporte: boolean;
  /** Última mensagem de cliente nos chamados abertos que o usuário atende */
  mensagem: { id: number; chamado_id: number; numero: number; nome: string | null } | null;
  /** Último chamado aberto transferido para o usuário por outra pessoa (id do evento) */
  transferido: { id: number; chamado_id: number; numero: number; nome: string | null; de: string | null } | null;
  /** Último chamado transferido para o departamento do usuário por outra pessoa (id do evento) */
  transferido_departamento: { id: number; chamado_id: number; numero: number; nome: string | null; de: string | null; departamento: string } | null;
}> => get('/api/chamados/contagem');
/** Ligação entre técnicos (ramal, src/components/Telefone.tsx) */
export const ligarPara = (para_usuario_id: number, oferta: string): Promise<{ id: number }> => enviar('POST', '/api/ligacoes', { para_usuario_id, oferta });
export const fetchLigacao = (id: number): Promise<{ situacao: 'chamando' | 'atendida' | 'recusada' | 'perdida' | 'encerrada'; resposta: string | null }> =>
  get(`/api/ligacoes/${id}`);
export const atenderLigacao = (id: number, resposta: string) => enviar('POST', `/api/ligacoes/${id}/atender`, { resposta });
export const encerrarLigacao = (id: number) => enviar('POST', `/api/ligacoes/${id}/encerrar`);
/** Gravação da ligação com o cliente: direto para o Blob (sem o limite de 4,5 MB da Vercel); o servidor manda analisar */
export async function enviarGravacaoLigacao(ligacaoId: number, audio: Blob, segundos: number): Promise<void> {
  const { upload } = await import('@vercel/blob/client');
  const tipo = audio.type.split(';')[0];
  const blob = await upload(`ligacoes/${ligacaoId}-gravacao.${tipo === 'audio/mp4' ? 'mp4' : 'webm'}`, audio, {
    access: 'public',
    handleUploadUrl: '/api/ligacoes/gravacao/upload',
    clientPayload: JSON.stringify({ ligacao_id: ligacaoId }),
    contentType: tipo,
    headers: headers(),
    multipart: audio.size > 5 * 1024 * 1024,
  });
  await enviar('POST', `/api/ligacoes/${ligacaoId}/gravacao`, { url: blob.url, segundos });
}
/** Player e transcrição da nota da ligação (url vazia: passou dos 90 dias) */
export const fetchGravacaoLigacao = (id: number): Promise<{ url: string | null; segundos: number | null; transcricao: string | null }> => get(`/api/ligacoes/${id}/gravacao`);
export const analisarLigacaoDeNovo = (id: number) => enviar('POST', `/api/ligacoes/${id}/analisar`);
export const ligarParaCliente = (chamadoId: number, oferta: string): Promise<{ id: number }> => enviar('POST', `/api/chamados/${chamadoId}/ligar`, { oferta });
export const fetchChamados = (filtro: FiltroChamados, q = ''): Promise<ChamadoResumo[]> =>
  get(`/api/chamados?filtro=${filtro}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
/** Técnicos e quantos atendimentos fazem agora (chamados abertos com ele e conversas do WhatsApp) */
export const fetchTecnicosChamados = (): Promise<{
  tecnicos: { id: number; nome: string; chamados: number; whatsapp: number }[];
  /** Id de quem consulta (sem o telefone na linha dele) */
  eu: number;
  /** Na fila agora: chamados e conversas do WhatsApp aguardando atendente */
  fila: { chamados: number; whatsapp: number };
  /** Atendimentos hoje: chamados abertos e atendimentos do WhatsApp iniciados hoje */
  hoje: { chamados: number; whatsapp: number };
}> => get('/api/chamados/tecnicos');
export const fetchChamado = (id: number): Promise<ChamadoDetalhe> => get(`/api/chamados/${id}`);
export const buscarPessoasChamado = (q: string): Promise<{ id: number; nome: string; telefone: string | null }[]> =>
  get(`/api/chamados/pessoas?q=${encodeURIComponent(q)}`);
export const criarChamado = (dados: {
  titulo: string;
  descricao: string;
  pessoa_id: number | null;
  categoria_id: number | null;
  prioridade: string;
  canal: string;
  atender: boolean;
}): Promise<{ id: number; numero: number }> => enviar('POST', '/api/chamados', dados);
export const assumirChamado = (id: number) => enviar('POST', `/api/chamados/${id}/assumir`);
export const encerrarChamado = (id: number, conclusao: string) => enviar('POST', `/api/chamados/${id}/encerrar`, { conclusao });
export const transferirChamado = (id: number, destino: { usuario_id?: number; departamento_id?: number; observacao?: string }) =>
  enviar('POST', `/api/chamados/${id}/transferir`, destino);
/** Pede ao cliente (chat do site) para abrir o AnyDesk */
/** Chama a atenção do cliente no chat do site (som e tremida) */
/** Pausa o atendimento: volta para a fila, sem atendente */
export const pausarChamado = (id: number): Promise<{ success: boolean; aviso: string | null }> => enviar('POST', `/api/chamados/${id}/pausar`);
/** computadores: quantos computadores do cliente (com o BMSoft Suporte) receberam o "trazer o chat para frente" */
export const cutucarCliente = (id: number): Promise<{ success: boolean; computadores: number }> => enviar('POST', `/api/chamados/${id}/cutucar`);
export const pedirTelaRemota = (id: number) => enviar('POST', `/api/chamados/${id}/tela-remota`);
/** Computador no BMDesk (MeshCentral) */
export interface ComputadorBmdesk {
  id: string;
  nome: string;
  online: boolean;
  sistema: string;
  ip?: string;
  /** Apelido dado pela equipe ("Recepção", "Caixa 1") */
  apelido?: string;
  /** Usuários logados no Windows */
  usuario?: string;
  /** Sem cliente: instalado pelo cliente deste chamado (mesmo IP de quem baixou pelo chat) */
  doChamado?: boolean;
  /** Nome que o cliente deu ao computador no chat, antes de baixar (vira o apelido ao vincular) */
  nomeSugerido?: string;
}
/** Grava o apelido do computador no BMDesk (vazio apaga) */
export const apelidarComputador = (id: number, pc: ComputadorBmdesk, apelido: string): Promise<{ apelido: string }> =>
  enviar('POST', `/api/chamados/${id}/apelido-computador`, { computador: pc.id, apelido });
/** Os do cliente do chamado e os online ainda sem cliente (recém-instalados pelo widget) */
export const computadoresDoChamado = (id: number): Promise<{ doCliente: ComputadorBmdesk[]; semCliente: ComputadorBmdesk[] }> =>
  get(`/api/chamados/${id}/computadores`);
/** Vincula ao cliente do chamado um computador ainda sem cliente */
export const vincularComputador = (id: number, pc: ComputadorBmdesk) =>
  enviar('POST', `/api/chamados/${id}/vincular-computador`, { computador: pc.id, nome: pc.nome, apelido: pc.nomeSugerido || '' });
/** Endereço da tela remota do computador (abre em outra aba) */
export const acessarComputador = (id: number, pc: ComputadorBmdesk): Promise<{ url: string }> =>
  enviar('POST', `/api/chamados/${id}/acessar-computador`, { computador: pc.id, nome: pc.nome });
export const enviarMensagemChamado = (id: number, texto: string, interna: boolean, imagem?: string | null): Promise<{ success: boolean; aviso: string | null }> =>
  enviar('POST', `/api/chamados/${id}/mensagens`, { texto, interna, imagem: imagem || undefined });
/** Imagem de uma mensagem do chamado (com o token: o <img> sozinho não manda o cabeçalho) */
export async function baixarImagemChamado(id: number, msgId: number): Promise<Blob> {
  const r = await fetch(`/api/chamados/${id}/mensagens/${msgId}/imagem`, { headers: headers() });
  if (!r.ok) await parseOrThrow(r);
  return r.blob();
}

// ------------------------------------------------------------
// Pesquisa de satisfação (Suporte › Pesquisa de Satisfação; server/pesquisasSatisfacao.ts)
// ------------------------------------------------------------

export type CanalPesquisa = 'whatsapp' | 'email' | 'ligacao';

export interface FiltroPesquisa {
  data_de?: string | null;
  data_ate?: string | null;
  origens?: string[];
  notas?: number[];
  sem_nota?: boolean;
  segmentos?: number[];
  pessoas?: number[];
  atendentes?: number[];
  departamentos?: number[];
  categorias?: number[];
  excluir_dias?: number;
}

export interface PesquisaResumo {
  id: number;
  descricao: string;
  canal: CanalPesquisa;
  situacao: 'rascunho' | 'em_andamento' | 'concluida' | 'cancelada';
  quantidade: number;
  total_filtrados: number | null;
  criado_em: string;
  executada_em: string | null;
  concluida_em: string | null;
  criado_por_nome: string | null;
  selecionados: number;
  respondidos: number;
  media: number | null;
}

export interface ItemPesquisa {
  id: number;
  lote: number;
  origem: 'chamado' | 'whatsapp';
  chamado_numero: number | null;
  pessoa_nome: string | null;
  /** WhatsApp do cadastro (sem ele, o telefone) e e-mail: para onde o contato vai */
  pessoa_telefone: string | null;
  pessoa_email: string | null;
  atendente_nome: string | null;
  data_atendimento: string | null;
  assunto: string | null;
  selecionado: boolean;
  situacao: 'sorteado' | 'enviado' | 'em_conversa' | 'respondido' | 'sem_resposta' | 'falhou';
  atividade_id: number | null;
  executor_bot: number | null;
  destino: string | null;
  nota: number | null;
  comentario: string | null;
  resumo: string | null;
  precisa_retorno: boolean | null;
  tarefa_id: number | null;
  registrado_por_nome: string | null;
  enviado_em: string | null;
  respondido_em: string | null;
}

export interface Pesquisa {
  id: number;
  descricao: string;
  objetivo: string | null;
  canal: CanalPesquisa;
  /** WhatsApp por onde a pesquisa sai (canal whatsapp) */
  conta: 'provedor' | 'campanhas';
  filtro: FiltroPesquisa;
  quantidade: number;
  total_filtrados: number | null;
  responsavel_id: number | null;
  situacao: PesquisaResumo['situacao'];
  itens: ItemPesquisa[];
}

export type DadosPesquisa = Pick<Pesquisa, 'descricao' | 'objetivo' | 'canal' | 'conta' | 'filtro' | 'quantidade' | 'responsavel_id'>;

export const fetchPesquisa = (id: number): Promise<Pesquisa> => get(`/api/pesquisas-satisfacao/${id}`);
export const criarPesquisa = (d: DadosPesquisa): Promise<{ id: number }> => enviar('POST', '/api/pesquisas-satisfacao', d);
export const salvarPesquisa = (id: number, d: DadosPesquisa) => enviar('PUT', `/api/pesquisas-satisfacao/${id}`, d);
/** Concluir a pesquisa à força (pela lista), mesmo com gente sem responder */
export const concluirPesquisa = (id: number) => enviar('POST', `/api/pesquisas-satisfacao/${id}/concluir`);
export const previaPesquisa = (filtro: FiltroPesquisa, id?: number): Promise<{ filtrados: number }> => enviar('POST', '/api/pesquisas-satisfacao/previa', { filtro, id });
export const sortearPesquisa = (id: number, quantidade?: number): Promise<{ sorteados: number; filtrados: number }> =>
  enviar('POST', `/api/pesquisas-satisfacao/${id}/sortear`, quantidade ? { quantidade } : {});
export const marcarItemPesquisa = (itemId: number, selecionado: boolean) => enviar('PUT', `/api/pesquisas-satisfacao/itens/${itemId}`, { selecionado });
export const executarPesquisa = (id: number): Promise<{ executados: number; falhas: number; erro: string | null }> => enviar('POST', `/api/pesquisas-satisfacao/${id}/executar`);
export const registrarRetornoPesquisa = (
  itemId: number,
  d: { nao_atendeu?: boolean; nota?: number; comentario?: string; resumo?: string; precisa_retorno?: boolean; motivo_retorno?: string },
) => enviar('POST', `/api/pesquisas-satisfacao/itens/${itemId}/retorno`, d);
export const fetchItemDaAtividade = (
  atividadeId: Id,
): Promise<{ id: number; pessoa_nome: string | null; pessoa_telefone: string | null; assunto: string | null; data_br: string | null; atendente_nome: string | null; objetivo: string | null; situacao: string; pesquisa_descricao: string }> =>
  get(`/api/pesquisas-satisfacao/da-atividade/${encodeURIComponent(String(atividadeId))}`);
export const buscarPessoasPesquisa = (q: string): Promise<{ id: number; nome: string }[]> => get(`/api/pesquisas-satisfacao-pessoas?q=${encodeURIComponent(q)}`);
