import type { ReactNode } from 'react';

import { Botao } from './Botao';

/**
 * Estados vazio, carregando e de erro.
 *
 * São telas projetadas, não `null`. Uma lista vazia sem explicação deixa o
 * operador sem saber se não há dados, se o filtro está errado ou se a
 * aplicação quebrou. DESIGN_SYSTEM.md §1.
 */

interface EstadoBase {
  readonly titulo: string;
  readonly descricao?: string;
  readonly acao?: ReactNode;
}

function Moldura({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-14 text-center">
      {children}
    </div>
  );
}

export function EstadoVazio({ titulo, descricao, acao }: EstadoBase) {
  return (
    <Moldura>
      <div className="flex size-14 items-center justify-center rounded-full bg-neutral-50">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-neutral-400)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
          <path d="M3.5 7.5 12 12l8.5-4.5" />
          <path d="M12 12v9" />
        </svg>
      </div>
      <p className="font-display text-[16px] font-semibold text-neutral-700">{titulo}</p>
      {descricao ? (
        <p className="max-w-[320px] text-[13.5px] leading-5 text-neutral-500">{descricao}</p>
      ) : null}
      {acao}
    </Moldura>
  );
}

export function EstadoCarregando({ titulo = 'Carregando…' }: { readonly titulo?: string }) {
  return (
    <Moldura>
      <svg
        className="animate-spin"
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="var(--color-neutral-300)"
          strokeWidth="2.5"
          opacity="0.35"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="var(--color-primary-600)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {/* `role="status"` faz o leitor de tela anunciar sem roubar o foco. */}
      <p role="status" className="text-[13.5px] text-neutral-500">
        {titulo}
      </p>
    </Moldura>
  );
}

export function EstadoErro({
  titulo = 'Não foi possível carregar',
  descricao,
  aoTentarNovamente,
}: EstadoBase & { readonly aoTentarNovamente?: () => void }) {
  return (
    <Moldura>
      <div className="flex size-14 items-center justify-center rounded-full bg-[--color-perigo-fundo]">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-perigo)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <p className="font-display text-[16px] font-semibold text-neutral-700">{titulo}</p>
      {descricao ? (
        <p className="max-w-[360px] text-[13.5px] leading-5 text-neutral-500">{descricao}</p>
      ) : null}
      {aoTentarNovamente ? (
        <Botao variante="secundario" onClick={aoTentarNovamente}>
          Tentar novamente
        </Botao>
      ) : null}
    </Moldura>
  );
}
