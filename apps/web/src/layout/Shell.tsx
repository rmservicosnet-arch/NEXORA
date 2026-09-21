import { PERM, type PaginaPedidos, type PaginaProdutos } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';

import { pedir } from '../api/cliente';
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
  /** Qual contagem aparece no selo, quando houver. */
  readonly selo?: 'pedidos' | 'negativos';
}

const ICONE = {
  equipe: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16.5 5.6a3.4 3.4 0 0 1 0 4.8" />
      <path d="M18.5 20a6 6 0 0 0-2-4.4" />
    </>
  ),
  venda: (
    <>
      <path d="M4 6h16v13H4z" />
      <path d="M4 10h16" />
      <path d="M9 14h6" />
    </>
  ),
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
  caixaRegistradora: (
    <>
      <rect x="3" y="10" width="18" height="10" rx="2" />
      <path d="M7 10V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" />
      <path d="M8 15h3" />
    </>
  ),
  gaveta: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M3 12h18" />
      <path d="M10 16h4" />
    </>
  ),
  conta: (
    <>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </>
  ),
  pedido: (
    <>
      <path d="M8 4h9l3 3v13H8z" />
      <path d="M4 8v12h10" />
      <path d="M11 11h5" />
      <path d="M11 15h3" />
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
  catalogo: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 10h16" />
      <path d="M10 10v9" />
    </>
  ),
  compra: (
    <>
      <path d="M4 5h2l2.2 9.5a1.6 1.6 0 0 0 1.6 1.3h7.4a1.6 1.6 0 0 0 1.6-1.2L20 8H7" />
      <circle cx="10" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </>
  ),
  carteira: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="17" cy="14.5" r="1.2" />
    </>
  ),
  etiqueta: (
    <>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.4" />
    </>
  ),
  cliente: (
    <>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M17 4.5a3.5 3.5 0 0 1 0 6.8" />
      <path d="M21 20v-1.5a4 4 0 0 0-3-3.8" />
    </>
  ),
  engrenagem: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
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

/**
 * O menu da proposta, nos cinco grupos dela.
 *
 * `Compras` e `Contas` ainda não existem como módulo. Aparecem porque o menu
 * é o mapa do sistema — omitir faz o mapa mentir por omissão —, e levam a uma
 * página que diz o que falta, não a uma tela inventada.
 *
 * `Lojas` e `Tabelas de preço` não estão no desenho. Ficam em Cadastros: a
 * primeira já existia, a segunda foi pedida depois.
 */
const MENU: readonly ItemMenu[] = [
  {
    rotulo: 'Visão geral',
    para: '/',
    grupo: 'Operação',
    permissoes: [],
    icone: ICONE.painel,
  },
  {
    rotulo: 'PDV',
    para: '/pdv',
    grupo: 'Operação',
    permissoes: [PERM.venda.criar],
    icone: ICONE.caixaRegistradora,
  },

  {
    rotulo: 'Vendas',
    para: '/vendas',
    grupo: 'Operação',
    permissoes: [PERM.venda.criar],
    icone: ICONE.venda,
  },
  {
    rotulo: 'Pedidos',
    para: '/pedidos',
    grupo: 'Operação',
    permissoes: [PERM.pedido.visualizarFila],
    icone: ICONE.pedido,
    selo: 'pedidos',
  },
  {
    rotulo: 'Catálogo',
    para: '/catalogo',
    grupo: 'Operação',
    permissoes: [PERM.produto.visualizar],
    icone: ICONE.catalogo,
  },

  {
    rotulo: 'Produtos',
    para: '/produtos',
    grupo: 'Cadastros',
    permissoes: [PERM.produto.visualizar],
    icone: ICONE.caixa,
  },
  {
    rotulo: 'Tabelas de preço',
    para: '/tabelas-preco',
    grupo: 'Cadastros',
    permissoes: [PERM.preco.visualizar],
    icone: ICONE.etiqueta,
  },
  {
    rotulo: 'Clientes',
    para: '/clientes',
    grupo: 'Cadastros',
    permissoes: [PERM.cliente.visualizar],
    icone: ICONE.cliente,
  },
  {
    rotulo: 'Equipe',
    para: '/equipe',
    grupo: 'Cadastros',
    permissoes: [PERM.usuario.visualizar],
    icone: ICONE.equipe,
  },
  {
    rotulo: 'Fornecedores',
    para: '/fornecedores',
    grupo: 'Cadastros',
    permissoes: [PERM.compra.visualizar],
    icone: ICONE.compra,
  },
  {
    rotulo: 'Lojas',
    para: '/lojas',
    grupo: 'Cadastros',
    permissoes: [PERM.estoque.visualizar],
    icone: ICONE.loja,
  },

  {
    rotulo: 'Movimentações',
    para: '/estoque',
    grupo: 'Estoque',
    permissoes: [PERM.estoque.visualizar],
    icone: ICONE.movimento,
    selo: 'negativos',
  },
  {
    rotulo: 'Compras',
    para: '/compras',
    grupo: 'Estoque',
    permissoes: [PERM.compra.visualizar],
    icone: ICONE.compra,
  },

  {
    rotulo: 'Contas',
    para: '/financeiro',
    grupo: 'Financeiro',
    permissoes: [PERM.financeiro.visualizar],
    icone: ICONE.conta,
  },
  {
    rotulo: 'Carteiras',
    para: '/carteiras',
    grupo: 'Financeiro',
    permissoes: [PERM.carteira.visualizar],
    icone: ICONE.carteira,
  },
  {
    rotulo: 'Caixa',
    para: '/caixa',
    grupo: 'Financeiro',
    permissoes: [PERM.caixa.abrir],
    icone: ICONE.gaveta,
  },

  {
    rotulo: 'Relatórios',
    para: '/relatorios',
    grupo: 'Gestão',
    permissoes: [PERM.relatorio.visualizar],
    icone: ICONE.relatorio,
  },
  {
    rotulo: 'Configurações',
    para: '/configuracoes',
    grupo: 'Gestão',
    permissoes: [PERM.configuracao.visualizar],
    icone: ICONE.engrenagem,
  },
];

export function Shell() {
  const { usuario, restaurando, sair, pode } = useSessao();
  const local = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  /**
   * Os dois selos do menu: pedidos esperando a equipe e itens em saldo
   * negativo. São os números que fazem alguém abrir a tela sem ser chamado.
   *
   * `limite=1` porque só a contagem interessa; a lista vem na própria tela.
   */
  const fila = useQuery({
    queryKey: ['pedidos', 'selo'],
    queryFn: () => pedir<PaginaPedidos>('/pedidos?apenasFila=true&limite=1'),
    enabled: pode(PERM.pedido.visualizarFila),
    refetchInterval: 60_000,
  });

  const negativos = useQuery({
    queryKey: ['produtos', 'selo-negativos'],
    queryFn: () => pedir<PaginaProdutos>('/produtos?apenasDivergencia=true&limite=1'),
    enabled: pode(PERM.estoque.visualizar),
    refetchInterval: 60_000,
  });

  const contagem: Record<'pedidos' | 'negativos', number | undefined> = {
    pedidos: fila.data?.contagens.aguardando,
    negativos: negativos.data?.total,
  };

  // Fechar ao navegar. No celular o menu cobre a tela inteira; deixá-lo aberto
  // sobre a página recém-aberta esconde exatamente o que a pessoa foi ver.
  useEffect(() => {
    setMenuAberto(false);
  }, [local.pathname]);

  useEffect(() => {
    if (!menuAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(false);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [menuAberto]);

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
    /*
      Altura travada na tela, e quem rola é a página — não o corpo.
      Com o corpo rolando, o menu lateral sobe junto e some: numa lista de
      60 produtos a pessoa perde a navegação inteira para voltar.
    */
    <div className="flex h-dvh overflow-hidden">
      {menuAberto ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
          className="fixed inset-0 z-30 bg-neutral-900/50 md:hidden"
        />
      ) : null}

      <nav
        aria-label="Navegação principal"
        className={juntar(
          'fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-primary-800',
          'transition-transform duration-200 md:static md:translate-x-0',
          menuAberto ? 'translate-x-0' : '-translate-x-full',
        )}
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
                    <span className="flex-1">{item.rotulo}</span>
                    {item.selo && (contagem[item.selo] ?? 0) > 0 ? (
                      <span className="inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 font-mono text-[11px] font-medium text-primary-700">
                        {contagem[item.selo]}
                      </span>
                    ) : null}
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* A equipe confirma pedido pelo celular — é requisito, não adaptação.
            Acima de `md` esta barra some e a navegação volta a ser a coluna. */}
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-neutral-100 bg-white px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMenuAberto(true)}
            aria-label="Abrir menu"
            aria-expanded={menuAberto}
            className="flex size-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-50"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
          </button>
          <Marca compacto />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
