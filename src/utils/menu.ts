import {
  BarChart3,
  Handshake,
  CalendarCheck,
  History,
  FileSignature,
  ShoppingCart,
  Building2,
  Users,
  Package,
  Layers,
  CreditCard,
  Filter,
  Columns3,
  KeyRound,
  ListOrdered,
  Tags,
  Network,
  Megaphone,
  ScrollText,
  Target,
  MessageSquareText,
  MessageCircle,
  Send,
  Star,
  Inbox,
  Headset,
  Database,
  ClipboardCheck,
  Globe,
  Wrench,
  Hammer,
  Receipt,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { ResourceDef, ResourceGroup, Usuario } from '../types';
import { GROUP_LABELS } from './formatters';

/** Mapa dos ícones declarados no registro de metadados do servidor */
const ICONS: Record<string, LucideIcon> = {
  Handshake,
  CalendarCheck,
  History,
  FileSignature,
  ShoppingCart,
  Building2,
  Users,
  Package,
  Layers,
  CreditCard,
  Filter,
  Columns3,
  KeyRound,
  ListOrdered,
  Tags,
  Network,
  Megaphone,
  ScrollText,
  Target,
  MessageSquareText,
  Send,
  Star,
  Globe,
  Wrench,
  Hammer,
  Receipt,
  ClipboardCheck,
};

const GROUP_ORDER: ResourceGroup[] = ['cadastros'];

/** Cadastros que aparecem na Visão Geral em vez do grupo deles */
const NA_VISAO_GERAL = ['atividades'];

export interface ItemMenu {
  id: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
  /** Só administrador: aparece no menu dele, mas não entra nas permissões */
  somenteAdmin?: boolean;
}

/** Opções só de administrador (mesma lista de SO_ADMIN em server/permissoes.ts) */
const SO_ADMIN = ['usuarios', 'configuracoes'];

/**
 * Opções do menu, agrupadas como na barra lateral. É a mesma lista das permissões do usuário
 * (Usuários › Permissões): o id de cada opção é o que fica gravado em usuarios.permissoes.
 * Usuários fica de fora: é só para administradores, que acessam tudo.
 */
export function gruposDoMenu(resources: ResourceDef[]): { titulo: string; itens: ItemMenu[] }[] {
  const grupos = [
    {
      titulo: 'Visão Geral',
      itens: [
        // Atividades/Tarefas: o dia a dia da equipe (chamados, pendências, Bot)
        ...resources
          .filter((r) => NA_VISAO_GERAL.includes(r.name) && !r.oculto)
          .map((r) => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database })),
      ],
    },
    {
      titulo: 'Suporte',
      itens: [
        { id: 'painel_suporte', label: 'Painel de Suporte', descricao: 'Indicadores dos atendimentos', icone: BarChart3 },
        { id: 'chamados_fila', label: 'Fila de Chamados', descricao: 'Chamados aguardando atendimento', icone: Inbox },
        { id: 'conversas', label: 'Whatsapp', descricao: 'Mensagens do WhatsApp', icone: MessageCircle },
        { id: 'chamados_ativos', label: 'Chamados Ativos', descricao: 'Atendimento dos chamados', icone: Headset },
        // Cadastros do grupo suporte entram aqui, depois das telas (Templates foi para Cadastros)
        ...resources
          .filter((r) => r.group === 'suporte' && !r.oculto)
          .map((r) => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database })),
      ],
    },
    ...GROUP_ORDER.map((group) => ({
      titulo: GROUP_LABELS[group] || group,
      itens: [
        ...resources
          .filter((r) => r.group === group && !r.oculto && r.name !== 'usuarios' && !NA_VISAO_GERAL.includes(r.name))
          .map((r) => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database })),
      ],
    })),
    // Só as abas do suporte (src/components/ConfiguracoesView.tsx)
    { titulo: 'Sistema', itens: [{ id: 'configuracoes', label: 'Configurações', descricao: 'Preferências do suporte', icone: Settings, somenteAdmin: true }] },
  ];
  return grupos.filter((g) => g.itens.length);
}

/** O usuário acessa a opção: administrador acessa tudo; sem permissões gravadas, também */
export function podeAcessar(usuario: Usuario | null, id: string): boolean {
  if (!usuario) return false;
  if (SO_ADMIN.includes(id)) return usuario.tipo === 'admin';
  if (usuario.tipo === 'admin' || !Array.isArray(usuario.permissoes)) return true;
  return usuario.permissoes.includes(id);
}
