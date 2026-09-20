import * as Label from '@radix-ui/react-label';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { juntar } from './juntar';

export interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly rotulo: string;
  /**
   * Mensagem de erro.
   *
   * **Sempre textual.** Borda vermelha sozinha não comunica nada a quem não
   * distingue as cores — e nem a quem está com pressa. DESIGN_SYSTEM.md §8.
   */
  readonly erro?: string;
  readonly ajuda?: string;
  readonly acessorio?: ReactNode;
  /** Botão dentro do campo, à direita — o olho da senha, por exemplo. */
  readonly sufixo?: ReactNode;
}

export function Campo({ rotulo, erro, ajuda, acessorio, sufixo, className, ...resto }: CampoProps) {
  const id = useId();
  const idErro = `${id}-erro`;
  const idAjuda = `${id}-ajuda`;

  const descritoPor = [erro ? idErro : null, ajuda ? idAjuda : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label.Root
          htmlFor={id}
          className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600"
        >
          {rotulo}
        </Label.Root>
        {acessorio}
      </div>

      <div className="relative">
        <input
          id={id}
          className={juntar(
            'h-[42px] w-full rounded-md border bg-white px-3 text-[14px] text-neutral-900',
            'placeholder:text-neutral-400',
            sufixo ? 'pr-11' : '',
            erro ? 'border-[var(--color-perigo)]' : 'border-neutral-200',
            className,
          )}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor || undefined}
          {...resto}
        />
        {sufixo ? <span className="absolute right-1 top-1">{sufixo}</span> : null}
      </div>

      {ajuda ? (
        <p id={idAjuda} className="text-[12.5px] text-neutral-500">
          {ajuda}
        </p>
      ) : null}

      {erro ? (
        <p id={idErro} className="text-[12.5px] font-medium text-[var(--color-perigo)]">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
