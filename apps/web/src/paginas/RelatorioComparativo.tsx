import { type LinhaLojaComparada, type RelatorioComparativo } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  brl,
  CabecalhoRelatorio,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

/** As métricas comparáveis, na ordem em que a pergunta costuma vir. */
const METRICAS = [
  { chave: 'faturamento', nome: 'Faturamento' },
  { chave: 'ticketMedio', nome: 'Ticket médio' },
  { chave: 'itensPorVenda', nome: 'Itens por venda' },
  { chave: 'taxaDesconto', nome: 'Taxa de desconto' },
  { chave: 'taxaCancelamento', nome: 'Taxa de cancelamento' },
  { chave: 'margem', nome: 'Margem bruta' },
] as const;

type Metrica = (typeof METRICAS)[number]['chave'];

/** Nestas, menor é melhor: a barra mais longa é a pior loja. */
const MENOR_MELHOR = new Set<Metrica>(['taxaDesconto', 'taxaCancelamento']);

function valorDa(loja: LinhaLojaComparada, metrica: Metrica): number {
  if (metrica === 'margem') return Number(loja.margem ?? 0);
  return Number(loja[metrica]);
}

function formatar(valor: number, metrica: Metrica): string {
  if (metrica === 'faturamento' || metrica === 'ticketMedio') return `R$ ${brl(valor)}`;
  if (metrica === 'itensPorVenda') return valor.toFixed(1);
  return `${valor.toFixed(1)}%`;
}

/**
 * Comparativo entre lojas.
 *
 * Faturamento sozinho premia a loja maior. Ticket médio, itens por venda e
 * taxa de desconto é que dizem se a loja vende melhor ou só vende mais: uma
 * loja pode faturar o dobro descontando o triplo.
 */
export function RelatorioComparativoTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 30);
  const daUrl = parametrosUrl.get('metrica') as Metrica | null;
  const metrica: Metrica = daUrl && METRICAS.some((m) => m.chave === daUrl) ? daUrl : 'faturamento';

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'comparativo', dias],
    queryFn: () =>
      pedir<RelatorioComparativo>(`/relatorios/comparativo-lojas?dias=${String(dias)}`),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const comCusto = dados?.lojas.some((l) => l.margem !== undefined) ?? false;

  const metricas = METRICAS.filter((m) => m.chave !== 'margem' || comCusto);

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'comparativo-entre-lojas.csv',
      [
        'loja',
        'vendas',
        'faturamento',
        'participacao',
        'ticket_medio',
        'itens',
        'itens_por_venda',
        'clientes',
        'taxa_desconto',
        'canceladas',
        'taxa_cancelamento',
        ...(comCusto ? ['margem'] : []),
      ],
      dados.lojas.map((l) => [
        l.loja,
        l.vendas,
        l.faturamento,
        l.participacao,
        l.ticketMedio,
        l.itens,
        l.itensPorVenda,
        l.clientes,
        l.taxaDesconto,
        l.canceladas,
        l.taxaCancelamento,
        ...(comCusto ? [l.margem ?? ''] : []),
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Comparativo entre lojas"
        comCusto={comCusto}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Comparativo entre lojas
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · {dados.lojas.length} {dados.lojas.length === 1 ? 'loja' : 'lojas'} com movimento
                </>
              ) : (
                'Carregando…'
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '30')}>
              {PERIODOS.map((d) => (
                <option key={d} value={d}>
                  {rotuloPeriodo(d)}
                </option>
              ))}
            </Selecao>

            <Selecao
              rotulo="Comparar"
              valor={metrica}
              aoMudar={(v) => trocar('metrica', v, 'faturamento')}
            >
              {metricas.map((m) => (
                <option key={m.chave} value={m.chave}>
                  {m.nome}
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Comparando as lojas…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível comparar as lojas"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {dados ? (
          dados.lojas.length === 0 ? (
            <EstadoVazio
              titulo="Nenhuma loja com movimento"
              descricao="Aumente o período para encontrar vendas."
            />
          ) : (
            <>
              <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-3">
                <Indicador
                  rotulo="Faturamento do grupo"
                  valor={`R$ ${brl(dados.faturamento)}`}
                  nota={`${dados.vendas} vendas concluídas`}
                />
                <Indicador
                  rotulo="Maior participação"
                  valor={`${dados.lojas[0]?.participacao ?? '0.0'}%`}
                  nota={dados.lojas[0]?.loja ?? '—'}
                />
                <Indicador
                  rotulo="Ticket médio do grupo"
                  valor={`R$ ${brl(dados.vendas > 0 ? Number(dados.faturamento) / dados.vendas : 0)}`}
                  nota="faturamento dividido pelas vendas"
                />
              </div>

              <Barras dados={dados} metrica={metrica} />

              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1060px]">
                  <Cabecalho comCusto={comCusto} />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.lojas.map((l) => (
                      <Linha key={l.lojaId} item={l} comCusto={comCusto} />
                    ))}
                  </div>
                </div>
              </Painel>
            </>
          )
        ) : null}
      </main>
    </>
  );
}

/**
 * Uma métrica por vez, lojas lado a lado.
 *
 * Duas escalas no mesmo gráfico — faturamento e margem juntos — compara
 * coisas que não se comparam. Quem quer outra métrica troca o filtro.
 */
function Barras({
  dados,
  metrica,
}: {
  readonly dados: RelatorioComparativo;
  readonly metrica: Metrica;
}) {
  const valores = dados.lojas.map((l) => valorDa(l, metrica));
  const maior = Math.max(...valores, 0);
  const invertida = MENOR_MELHOR.has(metrica);
  const nome = METRICAS.find((m) => m.chave === metrica)?.nome ?? '';

  return (
    <section className="shrink-0 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[14px] font-semibold text-neutral-900">{nome}</h2>
        {invertida ? (
          <span className="text-[12px] text-neutral-500">Aqui a barra menor é a melhor loja.</span>
        ) : null}
      </div>

      <div className="mt-3.5 flex flex-col gap-2.5">
        {dados.lojas.map((l) => {
          const valor = valorDa(l, metrica);
          const parte = maior > 0 ? (valor / maior) * 100 : 0;

          return (
            <div key={l.lojaId} className="flex items-center gap-3">
              <span className="w-[150px] shrink-0 truncate text-[12.5px] text-neutral-700">
                {l.loja}
              </span>

              <span className="h-[22px] min-w-0 flex-1 rounded-[3px] bg-neutral-50">
                <span
                  className={juntar(
                    'block h-full rounded-[3px]',
                    invertida && valor === maior && maior > 0
                      ? 'bg-[var(--color-atencao)]'
                      : 'bg-[var(--color-primary-500)]',
                  )}
                  style={{ width: `${parte}%` }}
                />
              </span>

              <span className="w-[112px] shrink-0 text-right font-mono text-[12.5px] font-medium text-neutral-900">
                {formatar(valor, metrica)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const GRADE_COM_CUSTO =
  'sm:grid-cols-[minmax(150px,1fr)_66px_130px_66px_110px_60px_72px_74px_74px_74px]';
const GRADE_SEM_CUSTO =
  'sm:grid-cols-[minmax(150px,1fr)_66px_130px_66px_110px_60px_72px_74px_74px]';

function Cabecalho({ comCusto }: { readonly comCusto: boolean }) {
  const colunas = [
    'Loja',
    'Vendas',
    'Faturamento',
    'Part.',
    'Ticket médio',
    'Itens',
    'Clientes',
    'Desc.',
    'Canc.',
    ...(comCusto ? ['Margem'] : []),
  ];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i > 0 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({
  item,
  comCusto,
}: {
  readonly item: LinhaLojaComparada;
  readonly comCusto: boolean;
}) {
  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
      )}
    >
      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">{item.loja}</span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">{item.vendas}</span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        R$ {brl(item.faturamento)}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        {item.participacao}%
      </span>

      <span className="font-mono text-[12.5px] text-neutral-700 sm:text-right">
        R$ {brl(item.ticketMedio)}
      </span>

      {/* Itens por venda, não itens: o total repete o que "Vendas" já disse. */}
      <span
        className="font-mono text-[12.5px] text-neutral-600 sm:text-right"
        title={`${item.itens} unidades no período`}
      >
        {item.itensPorVenda}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        {item.clientes}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          Number(item.taxaDesconto) > 10
            ? 'font-medium text-[var(--color-atencao)]'
            : 'text-neutral-600',
        )}
      >
        {item.taxaDesconto}%
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          Number(item.taxaCancelamento) > 8
            ? 'font-medium text-[var(--color-perigo)]'
            : 'text-neutral-600',
        )}
      >
        {item.taxaCancelamento}%
      </span>

      {comCusto ? (
        <span
          className={juntar(
            'font-mono text-[12.5px] sm:text-right',
            item.margem === null || item.margem === undefined
              ? 'text-neutral-300'
              : 'font-medium text-neutral-900',
          )}
        >
          {item.margem === null || item.margem === undefined ? '—' : `${item.margem}%`}
        </span>
      ) : null}
    </div>
  );
}
