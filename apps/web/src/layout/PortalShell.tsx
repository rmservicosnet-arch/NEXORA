import type { PaginaPedidos } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';

import { pedir } from '../api/cliente';
import { useSessaoPortal } from '../auth/sessaoPortal';
import { ProvedorCarrinho, useCarrinho } from '../portal/carrinho';
import { juntar } from '../ui/juntar';
import { Marca } from './Marca';

const ABAS = [
  { rotulo: 'Catálogo', para: '/portal' },
  { rotulo: 'Carrinho', para: '/portal/carrinho' },
  { rotulo: 'Meus pedidos', para: '/portal/pedidos' },
] as const;

/**
 * O portal é uma barra de abas, não uma coluna de navegação.
 *
 * São três destinos e o uso é predominantemente de celular — o cliente monta
 * o pedido no balcão da academia, não numa mesa com monitor. Uma coluna de
 * 240px repetiria o erro que a tela da equipe já cometeu uma vez.
 */
function Barra() {
  const { cliente, sair } = useSessaoPortal();
  const { itens } = useCarrinho();
  const noCarrinho = itens.reduce((soma, i) => soma + i.quantidade, 0);

  /**
   * Quantos pedidos esperam uma resposta DELE.
   *
   * O selo vive na barra porque o cliente pode estar em qualquer aba quando a
   * loja mexe no pedido: descobrir so ao abrir "Meus pedidos" e descobrir
   * tarde. Mesma chave da tela de pedidos — o TanStack serve as duas com uma
   * consulta so.
   */
  const esperando = useQuery({
    queryKey: ['portal', 'pedidos', 'esperando'],
    queryFn: () =>
      pedir<PaginaPedidos>('/portal/pedidos?limite=1&statusEm=AGUARDANDO_ACEITE_CLIENTE'),
    retry: false,
  });
  const meEsperam = esperando.data?.contagens.comOCliente ?? 0;

  return (
    <header className="sticky top-0 z-20 flex flex-col border-b border-neutral-100 bg-white">
      <div className="flex h-[54px] items-center gap-3 px-4">
        <Marca compacto />

        {/* A empresa, nao a pessoa: quem entrou aparece a direita. Um professor
            pode responder por mais de uma academia. */}
        {cliente?.empresa ? (
          <>
            <span className="h-[18px] w-px bg-neutral-100" />
            <span className="max-w-[260px] truncate text-[12.5px] text-neutral-500">
              {cliente.empresa}
            </span>
          </>
        ) : null}

        <div className="flex-1" />
        {/* O nome é o caminho para a conta: um item a mais na barra de abas
            competiria com Catálogo, Carrinho e Meus pedidos, que é onde o
            cliente realmente vai. */}
        <NavLink
          to="/portal/senha"
          className={({ isActive }) =>
            juntar(
              'max-w-[150px] truncate text-[12.5px] no-underline',
              isActive ? 'font-semibold text-primary-700' : 'text-neutral-500 hover:underline',
            )
          }
        >
          {cliente?.nome ?? 'Minha conta'}
        </NavLink>
        <button
          type="button"
          onClick={() => void sair()}
          className="h-8 rounded-md px-2.5 text-[12.5px] font-medium text-neutral-500 hover:bg-neutral-50"
        >
          Sair
        </button>
      </div>

      <nav aria-label="Seções do portal" className="flex gap-1 px-2">
        {ABAS.map((aba) => (
          <NavLink
            key={aba.para}
            to={aba.para}
            end={aba.para === '/portal'}
            className={({ isActive }) =>
              juntar(
                'flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13.5px] no-underline',
                isActive
                  ? 'border-primary-600 font-semibold text-primary-700'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800',
              )
            }
          >
            {aba.rotulo}
            {aba.para === '/portal/carrinho' && noCarrinho > 0 ? (
              <span className="flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-primary-600 px-1.5 font-mono text-[11px] font-medium text-white">
                {noCarrinho}
              </span>
            ) : null}
            {aba.para === '/portal/pedidos' && meEsperam > 0 ? (
              <span className="flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[var(--color-atencao-fundo)] px-1.5 text-[11px] font-semibold text-[var(--color-atencao)]">
                {meEsperam}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export function PortalShell() {
  const { cliente, restaurando } = useSessaoPortal();
  const local = useLocation();

  if (restaurando) {
    return <div className="min-h-dvh bg-neutral-25" />;
  }

  if (!cliente) {
    return <Navigate to="/portal/entrar" replace state={{ de: local.pathname }} />;
  }

  return (
    <ProvedorCarrinho clienteId={cliente.id}>
      <div className="flex min-h-dvh flex-col bg-neutral-25">
        <Barra />
        <main className="flex-1">
          {/* A largura do artboard: 1440 com 24px de folga dos dois lados. O
              limite de 940px estreitava a grade do catalogo para duas colunas
              e espremia a tabela do carrinho num monitor de verdade. */}
          <div className="mx-auto flex w-full max-w-[1392px] flex-col gap-4 p-4 sm:px-6 sm:py-[22px]">
            <Outlet />
          </div>
        </main>
      </div>
    </ProvedorCarrinho>
  );
}
