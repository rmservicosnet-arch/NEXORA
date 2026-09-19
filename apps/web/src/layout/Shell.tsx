import { PERM } from '@estoque/contracts';
import type { ReactElement } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';

import { useSessao } from '../auth/sessao';
import { juntar } from '../ui/juntar';
import { Marca } from './Marca';

interface ItemMenu {
  readonly rotulo: string;
  readonly para: string;
  readonly grupo: string;
  /** Permissões necessárias para o item sequer aparecer. */
  readonly permissoes: readonly string[];
  // React 19 deixou de expor o namespace `JSX` global.
  readonly icone: ReactElement;
}

const ICONE = {
  painel: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  loja: (
    <>
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  caixa: (
    <>
      <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  movimento: (
    <>
      <path d="M4 8h13" />
      <path d="M14 5l3 3-3 3" />
      <path d="M20 16H7" />
      <path d="M10 13l-3 3 3 3" />
    </>
  ),
  relatorio: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M3 20h18" />
    </>
  ),
} as const;

const MENU: readonly ItemMenu[] = [
  {
    rotulo: 'Visão geral',
    para: '/',
    grupo: 'Operação',
    permissoes: [],
    icone: ICONE.painel,
  },
  {
    rotulo: 'Lojas',
    para: '/lojas',
    grupo: 'Operação',
    permissoes: [PERM.estoque.visualizar],
    icone: ICONE.loja,
  },
  {
    rotulo: 'Estoque',
    para: '/estoque',
    grupo: 'Operação',
    permissoes: [PERM.estoque.visualizar],
    icone: ICONE.movimento,
  },
  {
    rotulo: 'Produtos',
    para: '/produtos',
    grupo: 'Cadastros',
    permissoes: [PERM.produto.visualizar],
    icone: ICONE.caixa,
  },
  {
    rotulo: 'Relatórios',
    para: '/relatorios',
    grupo: 'Gestão',
    permissoes: [PERM.relatorio.visualizar],
    icone: ICONE.relatorio,
  },
];

export function Shell() {
  const { usuario, restaurando, sair, pode } = useSessao();
  const local = useLocation();

  if (restaurando) {
    return <div className="min-h-dvh bg-neutral-25" />;
  }

  if (!usuario) {
    // Guarda o destino: depois de entrar, o usuário volta para onde queria
    // ir, não para a página inicial.
    return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  }

  // O menu mostra apenas o que a pessoa pode acionar. É cortesia de UX — a
  // API decide de verdade.
  const visiveis = MENU.filter((item) => pode(...item.permissoes));
  const grupos = [...new Set(visiveis.map((i) => i.grupo))];

  const iniciais = usuario.nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex min-h-dvh">
      <nav
        aria-label="Navegação principal"
        className="flex w-60 shrink-0 flex-col bg-primary-800"
      >
        <div className="flex h-[60px] items-center border-b border-primary-700 px-4">
          <Marca claro compacto />
        </div>

        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden p-2.5">
          {grupos.map((grupo) => (
            <div key={grupo} className="contents">
              <p className="mx-2 mb-1 mt-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-primary-400">
                {grupo}
              </p>
              {visiveis
                .filter((i) => i.grupo === grupo)
                .map((item) => (
                  <NavLink
                    key={item.para}
                    to={item.para}
                    end={item.para === '/'}
                    className={({ isActive }) =>
                      juntar(
                        'flex h-[33px] items-center gap-2.5 rounded-md px-2 text-[13.5px] no-underline',
                        isActive
                          ? 'bg-primary-600 font-medium text-white'
                          : 'text-primary-100 hover:bg-primary-700',
                      )
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {item.icone}
                    </svg>
                    {item.rotulo}
                  </NavLink>
                ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2.5 border-t border-primary-700 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-500 text-[12px] font-semibold text-white">
            {iniciais}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white">{usuario.nome}</p>
            <p className="truncate text-[11.5px] text-primary-300">{usuario.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void sair()}
            aria-label="Sair"
            title="Sair"
            className="flex size-7 items-center justify-center rounded-md text-primary-300 hover:bg-primary-700 hover:text-white"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
              <path d="M10 16l-4-4 4-4" />
              <path d="M6 12h10" />
            </svg>
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
