export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'time'
  | 'enum'
  | 'boolean'
  | 'password'
  | 'cnpj'
  /** Imagem embutida (data URI), reduzida no navegador antes de gravar */
  | 'imagem'
  /** Conjunto de campos definidos em Configurações, gravado como JSON */
  | 'personalizados'
  /** Até 4 fotos no Vercel Blob (endereços em JSON) */
  | 'fotos'
  /** Cor #RRGGBB escolhida numa tabela de cores */
  | 'cor';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  /** Não aparece na ficha embaixo da lista (ex.: campos já resumidos em outro, como os de executor) */
  foraDaFicha?: boolean;
  /** Na exibição, o valor de outro campo vai antes deste ("Luis : Implementar..."); não é gravado */
  prefixo?: { campo: string; exceto?: string };
  hint?: string;
  /** Campo imagem: guarda o arquivo como veio (até ~1,3 MB; maior, reduz para 1600 px) em vez de reduzir para 400×200 */
  imagemOriginal?: boolean;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  /** Só na alteração: o formulário de inclusão não mostra (ex.: fechamento da OS) */
  soNaAlteracao?: boolean;
  /** Campo só leitura mostrado dentro do formulário na edição (bloqueado), em vez da caixa de dados do banco */
  mostrarNaEdicao?: boolean;
  /** Campo de hora: ao preencher, acerta outro campo de hora somando estas horas (ex.: Das → Até + 2 h) */
  somarHoras?: { campo: string; horas: number };
  listed?: boolean;
  searchable?: boolean;
  /** Aparece no painel de busca avançada */
  filterable?: boolean;
  options?: { value: string; label: string }[];
  ref?: { resource: string; labelField: string };
  scale?: number;
  maxLength?: number;
  /** Desabilita (e zera) o campo quando outro campo tiver o valor indicado */
  disabledWhen?: { field: string; equals: string };
  /** Campo numérico que aceita valor negativo */
  allowNegative?: boolean;
  /** Valor inicial na inclusão */
  default?: string | number | boolean;
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Colunas que o campo ocupa no formulário (de 4); sem isto vale a regra padrão */
  span?: number;
  /** Coluna virtual: o valor mora dentro de um campo JSON do registro */
  json?: { campo: string; chave: string };
}

export type ResourceGroup = 'vendas' | 'marketing' | 'cadastros' | 'acesso' | 'suporte';

/** Grade filha exibida ao selecionar uma linha da listagem (mestre-detalhe) */
export interface DetailDef {
  resource: string;
  foreignKey: string;
  label: string;
  totalField?: string;
  editavel?: boolean;
}

export interface ResourceDef {
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  icon: string;
  group: ResourceGroup;
  oculto?: boolean;
  pk: string[];
  autoIncrement: boolean;
  labelField: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  details?: DetailDef[];
  /** Ao clicar numa linha, mostra embaixo a ficha com todos os campos (textos longos por inteiro) */
  ficha?: boolean;
  /** Atividades: além da lista, visões Semana e Mês (data_vencimento, hora_vencimento, duracao, assunto) */
  calendario?: boolean;
  /** Filtro aplicado só na visão Lista (o calendário mostra tudo), com o aviso que aparece no contador */
  filtroLista?: FiltroAvancado & { aviso: string };
  /**
   * Lista em árvore: registros com o mesmo `grupo` formam uma família; o de menor `ordem`
   * é a raiz e os demais aparecem como filhos (ex.: versões de uma proposta).
   */
  arvore?: { grupo: string; ordem: string };
  /** O formulário não mostra a caixa "Dados gerados pelo banco" */
  semDadosDoBanco?: boolean;
  /** A lista tem o filtro "Só as minhas" (as do usuário logado) */
  minhas?: boolean;
  /** Campo Sim/Não com filtro rápido Todas/Sim/Não na barra da lista */
  filtroRapido?: string;
  /** Valor com que o filtro rápido abre: '1' = Sim, '0' = Não (sem ele: Todas) */
  filtroRapidoPadrao?: '1' | '0';
  /** Toggle na barra da lista: desligado, acrescenta estes filtros (ex.: esconder as atividades do bot) */
  toggleMostrar?: { label: string; dica: string; ocultar: FiltroAvancado[] };
  fields: FieldDef[];
}

/** Empresa (tenant) do usuário logado: todos os dados do app são dela */
export interface EmpresaSessao {
  id: string;
  nome: string;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  /** admin = Administrador, client = Vendedor (ver PERFIS em server/schema.ts) */
  tipo?: 'admin' | 'gerente' | 'supervisor' | 'client' | 'funcionario';
  /** Opções do menu que acessa (ids de utils/menu.ts); null = todas. Administrador acessa tudo */
  permissoes?: string[] | null;
}

/** Chave primária: INT AUTO_INCREMENT (chega como número do servidor) */
export type Id = number | string;

export type RegistroCrud = Record<string, any>;

/** Operadores aceitos pela busca avançada */
export type FiltroOp = 'contains' | 'eq' | 'ne' | 'gte' | 'lte';

export interface FiltroAvancado {
  field: string;
  op: FiltroOp;
  value: string;
}

export interface ListaPaginada {
  data: RegistroCrud[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OpcaoRef {
  value: string;
  label: string;
}

/** Campo personalizado de pessoas, definido em Configurações */
/** Endereço da pessoa (pessoas_enderecos); id null = ainda não gravado */
export interface Endereco {
  id: number | null;
  tipo: string;
  principal: number | boolean;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_ibge: string | null;
  pais: string | null;
  obs: string | null;
}

export interface CampoPersonalizado {
  /** Chave gravada no registro; não muda depois de criado */
  nome: string;
  rotulo: string;
  tipo: 'texto' | 'textarea' | 'numero' | 'decimal' | 'data' | 'boolean' | 'lista';
  /** Opções de tipo 'lista' */
  opcoes?: string[];
  obrigatorio?: boolean;
  /** Aparece como coluna na lista */
  listado?: boolean;
}

export interface DbConnectionStatus {
  connected: boolean;
  latencyMs: number;
  version?: string;
  database?: string;
  host?: string;
  port?: number;
  user?: string;
  error?: string;
  tableCounts?: Record<string, number>;
}

export interface ProdutoBusca {
  id: number;
  codigo_sku: string | null;
  nome: string;
  preco_tabela: number;
  unidade_medida: string;
}
