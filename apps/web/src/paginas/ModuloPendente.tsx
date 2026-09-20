import { Link } from 'react-router';

import { Aviso } from '../ui/Aviso';

/**
 * Um módulo que o menu prevê e que ainda não existe.
 *
 * O menu é o mapa do sistema: tirar "Compras" e "Contas" dele faria o mapa
 * mentir por omissão. Mas levar a uma tela montada com dados inventados
 * mentiria pior. Esta página diz o que falta e para onde ir enquanto isso.
 */
export function ModuloPendente({
  titulo,
  oQueFaz,
  ondeEstaHoje,
}: {
  readonly titulo: string;
  readonly oQueFaz: string;
  readonly ondeEstaHoje: { readonly texto: string; readonly para: string } | null;
}) {
  return (
    <>
      <header className="flex min-h-[60px] shrink-0 items-center border-b border-neutral-100 bg-white px-4 sm:px-6">
        <h1 className="font-display text-[15px] font-semibold text-neutral-900">{titulo}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[620px] flex-col gap-3">
          <h2 className="font-display text-[22px] font-bold text-neutral-900">{titulo}</h2>
          <Aviso tom="info" titulo="Este módulo ainda não foi construído">
            {oQueFaz}
          </Aviso>
          {ondeEstaHoje ? (
            <p className="text-[13px] text-neutral-500">
              {ondeEstaHoje.texto}{' '}
              <Link to={ondeEstaHoje.para} className="font-medium text-primary-700">
                Ir para lá
              </Link>
              .
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
