import { Navigate, NavLink, Outlet } from 'react-router';

import { useSessaoPlataforma } from '../auth/sessaoPlataforma';
import { juntar } from '../ui/juntar';

/**
 * O shell da plataforma.
 *
 * Nada de menu lateral de empresa: esta é outra superfície, e parecer a mesma
 * convidaria à confusão entre "administrar a MINHA empresa" e "administrar
 * TODAS". O selo e o fundo escuro do topo existem para essa diferença ser
 * vista sem ser lida.
 *
 * "· sem empresa" ao lado do nome não é enfeite: é o que distingue este
 * principal dos outros dois. O token dele não carrega `tid`, e é por isso que
 * nenhuma rota de empresa o aceita.
 */
export function PlataformaShell() {
  const { admin, restaurando, sair } = useSessaoPlataforma();

  if (restaurando) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-25">
        <p className="text-[13.5px] text-neutral-500">Carregando…</p>
      </main>
    );
  }

  if (!admin) {
    return <Navigate to="/plataforma/login" replace />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-neutral-25">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#2A3573] bg-[#1B2350] px-4 sm:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 34 34" fill="none" aria-hidden="true">
            <rect
              x="1.25"
              y="1.25"
              width="31.5"
              height="31.5"
              rx="7"
              stroke="#FFFFFF"
              strokeWidth="2.6"
            />
            <path
              d="M9 12.5 L17 8 L25 12.5 L25 21.5 L17 26 L9 21.5 Z"
              stroke="#FFFFFF"
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-[15px] font-bold text-white">Estoque</span>
          <span className="hidden h-[21px] items-center rounded-full bg-[#3A4784] px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-white sm:inline-flex">
            Plataforma
          </span>
        </div>

        <nav aria-label="Seções da plataforma" className="flex gap-1">
          <NavLink
            to="/plataforma"
            end
            className={({ isActive }) =>
              juntar(
                'inline-flex h-[30px] items-center rounded-md px-3 text-[13px] no-underline',
                isActive ? 'bg-[#3A4784] font-medium text-white' : 'text-[#B9C1E6]',
              )
            }
          >
            Empresas
          </NavLink>
        </nav>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="hidden text-[13px] text-white sm:inline">{admin.nome}</span>
          <span className="hidden text-[11.5px] text-[#8B98D4] sm:inline">· sem empresa</span>
          <button
            type="button"
            onClick={() => void sair()}
            className="h-[30px] rounded-md border border-[#3A4784] px-2.5 text-[12px] text-[#B9C1E6] hover:border-[#4C5B9E] hover:text-white"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Quem rola é a região de dentro: o topo não sobe junto. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
