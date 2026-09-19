import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { juntar } from './juntar';

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';
export type TamanhoBotao = 'padrao' | 'pdv' | 'compacto';

export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variante?: VarianteBotao;
  readonly tamanho?: TamanhoBotao;
  readonly carregando?: boolean;
  /** Renderiza como o filho — usado para transformar um `<a>` em botão. */
  readonly comoFilho?: boolean;
  readonly children?: ReactNode;
}

const VARIANTES: Record<VarianteBotao, string> = {
  primario: 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm',
  secundario: 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50',
  fantasma: 'bg-transparent text-neutral-700 hover:bg-neutral-50',
  perigo: 'bg-white text-[--color-perigo] border border-neutral-200 hover:bg-[--color-perigo-fundo]',
};

const TAMANHOS: Record<TamanhoBotao, string> = {
  padrao: 'h-[38px] px-4 text-[14px]',
  // 48px: alvo de toque para uso sob pressão. DESIGN_SYSTEM.md §6.
  pdv: 'h-12 px-5 text-[15px] font-semibold',
  compacto: 'h-8 px-3 text-[13px]',
};

export function Botao({
  variante = 'secundario',
  tamanho = 'padrao',
  carregando = false,
  comoFilho = false,
  className,
  disabled,
  children,
  ...resto
}: BotaoProps) {
  const Componente = comoFilho ? Slot : 'button';

  return (
    <Componente
      className={juntar(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTES[variante],
        TAMANHOS[tamanho],
        className,
      )}
      disabled={disabled || carregando}
      // `aria-busy` diz ao leitor de tela que a ação está em andamento.
      // Só mudar o rótulo para "Entrando…" não comunica isso.
      aria-busy={carregando || undefined}
      {...resto}
    >
      {/*
        Com `comoFilho`, o `Slot` do Radix repassa as props ao ÚNICO filho —
        e aqui só pode haver um. Emitir `{spinner}{children}` manda dois
        (mesmo que o primeiro seja `null`, vira um array) e o Radix lança
        "Slot failed to slot onto its children".

        Não é perda: `comoFilho` existe para vestir um `<Link>` de botão, e
        link não fica carregando — a navegação é imediata.
      */}
      {comoFilho ? (
        children
      ) : (
        <>
          {carregando ? <Girando /> : null}
          {children}
        </>
      )}
    </Componente>
  );
}

function Girando() {
  return (
    <svg
      className="animate-spin"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
