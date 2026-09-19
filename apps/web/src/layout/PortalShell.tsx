import { NavLink, Navigate, Outlet, useLocation } from 'react-router';

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

  return (
    <header className="sticky top-0 z-20 flex flex-col border-b border-neutral-100 bg-white">
      <div className="flex h-[54px] items-center gap-3 px-4">
        <Marca compacto />
        <div className="flex-1" />
        <span className="hidden truncate text-[12.5px] text-neutral-500 sm:block">
          {cliente?.nome}
        </span>
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
              <span className="rounded-full bg-primary-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
                {noCarrinho}
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
          <div className="mx-auto flex w-full max-w-[940px] flex-col gap-4 p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </ProvedorCarrinho>
  );
}
