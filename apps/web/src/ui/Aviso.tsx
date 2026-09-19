import type { ReactNode } from 'react';

import { juntar } from './juntar';

export type TomAviso = 'info' | 'sucesso' | 'atencao' | 'perigo';

const TONS: Record<TomAviso, { caixa: string; icone: string }> = {
  info: {
    caixa: 'bg-primary-50 border-primary-100 text-primary-800',
    icone: 'var(--color-primary-600)',
  },
  sucesso: {
    caixa: 'bg-[--color-sucesso-fundo] border-[#c6e4d3] text-[#155635]',
    icone: 'var(--color-sucesso)',
  },
  atencao: {
    caixa: 'bg-[--color-atencao-fundo] border-[#ebd6a8] text-[#7a5205]',
    icone: 'var(--color-atencao)',
  },
  perigo: {
    caixa: 'bg-[--color-perigo-fundo] border-[#f0c9cb] text-[#8c1a21]',
    icone: 'var(--color-perigo)',
  },
};

export interface AvisoProps {
  readonly tom?: TomAviso;
  readonly titulo?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Mensagem com tom.
 *
 * Sempre com ícone, nunca só cor: monitor de PDV costuma ser ruim, e parte
 * das pessoas não distingue vermelho de verde. DESIGN_SYSTEM.md §3.
 */
export function Aviso({ tom = 'info', titulo, children, className }: AvisoProps) {
  const estilo = TONS[tom];

  return (
    <div
      role={tom === 'perigo' ? 'alert' : 'status'}
      className={juntar('flex gap-3 rounded-md border px-3.5 py-3', estilo.caixa, className)}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke={estilo.icone}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 shrink-0"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        {tom === 'info' ? (
          <>
            <path d="M12 16v-5" />
            <path d="M12 8h.01" />
          </>
        ) : (
          <>
            <path d="M12 8v4.5" />
            <path d="M12 16h.01" />
          </>
        )}
      </svg>
      <div className="min-w-0 text-[13px] leading-[19px]">
        {titulo ? <p className="font-semibold">{titulo}</p> : null}
        <div className={titulo ? 'mt-0.5' : undefined}>{children}</div>
      </div>
    </div>
  );
}
