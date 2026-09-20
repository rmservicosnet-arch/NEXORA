import { Link } from 'react-router';

import { Botao } from '../ui/Botao';
import { juntar } from '../ui/juntar';

/**
 * As peças que todos os relatórios repetem.
 *
 * Cabeçalho, filtro, indicador e exportação são o mesmo desenho em todas as
 * telas do grupo. Copiar em cada uma faria oito cópias que divergem na
 * primeira correção de dois pixels.
 */

const QUEBRA = String.fromCharCode(10);
/** BOM literal no fonte vira erro de lint e some em qualquer cópia. */
const MARCA_UTF8 = String.fromCharCode(0xfeff);

/** Valor em reais, sempre em módulo — o sinal é decisão de quem exibe. */
export function brl(v: string | number): string {
  return Math.abs(Number(v)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Períodos oferecidos. Os mesmos em todo relatório que olha para trás. */
export const PERIODOS = [7, 15, 30, 60, 90, 180, 365] as const;

export function rotuloPeriodo(dias: number): string {
  if (dias === 365) return '12 meses';
  if (dias % 30 === 0) return `${dias / 30} ${dias === 30 ? 'mês' : 'meses'}`;
  return `${dias} dias`;
}

/** Filtro no alto: rótulo à esquerda, escolha em destaque. */
export function Filtro({
  rotulo,
  children,
}: {
  readonly rotulo: string;
  readonly children: React.ReactNode;
}) {
  return (
    <span className="flex h-[35px] items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5">
      <span className="text-[13px] text-neutral-500">{rotulo}</span>
      {children}
    </span>
  );
}

const CLASSE_SELECAO = 'bg-transparent text-[13px] font-medium text-neutral-900 outline-none';

export function Selecao({
  rotulo,
  valor,
  aoMudar,
  children,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Filtro rotulo={rotulo}>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label={rotulo}
        className={CLASSE_SELECAO}
      >
        {children}
      </select>
    </Filtro>
  );
}

export function Indicador({
  rotulo,
  valor,
  nota,
  tom = 'normal',
  aoClicar,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  readonly tom?: 'normal' | 'atencao' | 'perigo' | 'sucesso';
  readonly aoClicar?: () => void;
}) {
  const conteudo = (
    <>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1.5 font-display text-[24px] font-bold leading-7',
          tom === 'perigo'
            ? 'text-[var(--color-perigo)]'
            : tom === 'atencao'
              ? 'text-[var(--color-atencao)]'
              : tom === 'sucesso'
                ? 'text-[var(--color-sucesso)]'
                : 'text-neutral-900',
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-[12px] text-neutral-500">{nota}</p>
    </>
  );

  const classe = juntar(
    'rounded-lg border bg-white px-4 py-3 text-left shadow-sm',
    tom === 'perigo'
      ? 'border-[#f0c9cb]'
      : tom === 'atencao'
        ? 'border-[#ebd6a8]'
        : 'border-neutral-100',
  );

  if (!aoClicar) return <div className={classe}>{conteudo}</div>;

  return (
    <button type="button" onClick={aoClicar} className={juntar(classe, 'hover:bg-neutral-25')}>
      {conteudo}
    </button>
  );
}

export function Cadeado() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Cabeçalho comum: caminho de volta, aviso de custo e exportação. */
export function CabecalhoRelatorio({
  titulo,
  comCusto,
  aoExportar,
  podeExportar,
}: {
  readonly titulo: string;
  readonly comCusto: boolean;
  readonly aoExportar: () => void;
  readonly podeExportar: boolean;
}) {
  return (
    <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
      <Link
        to="/relatorios"
        className="text-[13.5px] text-neutral-500 no-underline hover:underline"
      >
        Relatórios
      </Link>
      <span className="text-neutral-300">/</span>
      <span className="text-[13.5px] font-medium text-neutral-900">{titulo}</span>

      <div className="flex-1" />

      {comCusto ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-50 px-2.5 py-1 text-[11.5px] font-semibold text-neutral-600">
          <Cadeado />
          Contém custo — acesso restrito
        </span>
      ) : null}

      <Botao variante="secundario" onClick={aoExportar} disabled={!podeExportar}>
        Exportar
      </Botao>
    </header>
  );
}

/**
 * CSV separado por ponto e vírgula, com marca UTF-8.
 *
 * Sem a marca o Excel em português abre "Camiseta Algodão" como "AlgodÃ£o", e
 * quem exporta conclui que o sistema gravou errado.
 */
export function baixarCsv(nome: string, colunas: string[], linhas: (string | number)[][]) {
  const corpo = linhas.map((l) => l.map((c) => String(c).replaceAll(';', ',')).join(';'));
  const url = URL.createObjectURL(
    new Blob([MARCA_UTF8 + [colunas.join(';'), ...corpo].join(QUEBRA)], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Painel branco que rola por dentro — a página inteira nunca rola. */
export function Painel({ children }: { readonly children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">{children}</div>
    </section>
  );
}
