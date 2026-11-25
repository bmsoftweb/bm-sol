import React, { useState } from 'react';
import { Usuario } from '../types';
import { ConfigEmail } from './ConfigEmail';
import { ConfigWhatsApp } from './ConfigWhatsApp';
import { ConfigChatbot } from './ConfigChatbot';
import { ConfigIA } from './ConfigIA';
import { ConfigPesquisa } from './ConfigPesquisa';
import { ConfigJornada } from './ConfigJornada';
import { AbasRolagem } from './AbasRolagem';

/** Configurações da empresa. Gravam na tabela `config` (empresa + grupo + chave) */
const ABAS = [
  {
    id: 'whatsapp',
    titulo: 'WhatsApp',
    descricao: 'Número do WhatsApp do atendimento.',
  },
  {
    id: 'jornada',
    titulo: 'Automação',
    descricao: 'Atendimento automático do WhatsApp desenhado em nós: menus, perguntas, condições, esperas, chamadas de API, IA (com o texto-base) e departamentos.',
  },
  {
    id: 'chatbot',
    titulo: 'Chatbot',
    descricao: 'Nome do assistente, tempo para liberar o atendente, análise das conversas e pesquisa de satisfação.',
  },
  {
    id: 'ia',
    titulo: 'IA',
    descricao: 'A IA usada no app (Gemini, Claude ou DeepSeek, com chave e modelo): Automação do WhatsApp, análise das conversas, Bot das atividades e pesquisas.',
  },
  {
    id: 'email',
    titulo: 'E-mail (SMTP)',
    descricao: 'Conta de e-mail do suporte: pesquisa de satisfação (envio e leitura das respostas) e o Bot das atividades de chamados. Em branco: usa o e-mail comercial (configurado no bm-crm).',
  },
];

interface Props {
  usuario: Usuario | null;
  onToast: (msg: string) => void;
}

export const ConfiguracoesView: React.FC<Props> = ({ usuario, onToast }) => {
  const [aba, setAba] = useState(ABAS[0].id);
  const somenteLeitura = usuario?.tipo !== 'admin';
  const atual = ABAS.find((a) => a.id === aba) || ABAS[0];

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-stone-900">
      {/* Abas dos grupos de configuração */}
      <AbasRolagem className="bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 shrink-0">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-3 text-xs font-bold shrink-0 border-b-2 transition-all cursor-pointer ${
              aba === a.id
                ? 'border-blue-600 text-blue-600 bg-white dark:bg-stone-900 dark:text-blue-400'
                : 'border-transparent text-stone-500 hover:text-stone-700 dark:hover:text-stone-200'
            }`}
          >
            {a.titulo}
          </button>
        ))}
      </AbasRolagem>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 py-4">
          <div className="mb-3">
            <h2 className="text-base font-bold text-stone-900 dark:text-stone-100">{atual.titulo}</h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{atual.descricao}</p>
          </div>

          {somenteLeitura && (
            <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
              Somente administradores alteram as configurações da empresa.
            </div>
          )}

          {aba === 'whatsapp' && <ConfigWhatsApp somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'jornada' && <ConfigJornada somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'chatbot' && (
            <>
              <ConfigChatbot somenteLeitura={somenteLeitura} onToast={onToast} />
              <ConfigPesquisa somenteLeitura={somenteLeitura} onToast={onToast} />
            </>
          )}
          {aba === 'ia' && <ConfigIA somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'email' && <ConfigEmail chave="smtp_suporte" somenteLeitura={somenteLeitura} onToast={onToast} />}
        </div>
      </div>
    </div>
  );
};
