import { type LinhaCustoAquisicao, type RelatorioCustoAquisicao } from '@estoque/contracts';
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

/**
 * Quanto o item custava e quanto custa agora.
 *
 * Sai do item da NOTA, não do custo médio: a média mistura entradas de datas
 * e fornecedores diferentes. O que se quer saber aqui é o que o fornecedor
 * COBROU, nota a nota — é isso que se leva para uma negociação.
 */
export function RelatorioCustoAquisicaoTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const dias = Number(parametrosUrl.get('dias') ?? 180);

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'custo-aquisicao', dias],
    queryFn: () =>
      pedir<RelatorioCustoAquisicao>(
        `/relatorios/compras/custo-aquisicao?dias=${String(dias)}&limite=100`,
      ),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'custo-de-aquisicao.csv',
      [
        'sku',
        'produto',
        'variacao',
        'compras',
        'primeiro_custo',
        'ultimo_custo',
        'menor_custo',
        'maior_custo',
        'variacao_percentual',
        'ultimo_fornecedor',
      ],
      dados.itens.map((i) => [
        i.sku,
        i.produto,
        i.descricaoVariacao,
        i.compras,
        i.primeiroCusto,
        i.ultimoCusto,
        i.menorCusto,
        i.maiorCusto,
        i.variacaoPercentual ?? '',
        i.ultimoFornecedor,
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Evolução do custo de aquisição"
        comCusto
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Evolução do custo de aquisição
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              O que o fornecedor <strong className="font-semibold text-neutral-900">cobrou</strong>,
              nota a nota — não o custo médio, que mistura datas e fornecedores
            </p>
          </div>

          <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '180')}>
            {PERIODOS.map((d) => (
              <option key={d} value={d}>
                {rotuloPeriodo(d)}
              </option>
            ))}
          </Selecao>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Comparando notas…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível montar o relatório"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {dados ? (
          <>
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-3">
              <Indicador
                rotulo="Subiram"
                valor={String(dados.subiram)}
                nota="a última nota veio mais cara"
                tom={dados.subiram > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Caíram"
                valor={String(dados.cairam)}
                nota="a última nota veio mais barata"
                tom={dados.cairam > 0 ? 'sucesso' : 'normal'}
              />
              <Indicador
                rotulo="Estáveis"
                valor={String(dados.estaveis)}
                nota="mesmo custo da primeira à última"
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[980px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhum item com compra no período"
                      descricao="Aumente o período, ou receba notas em Compras para haver o que comparar."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.variacaoId} item={i} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 lg:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    {dados.itens.length} {dados.itens.length === 1 ? 'item' : 'itens'} · ordenados
                    pela maior variação em reais
                  </span>
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'lg:grid-cols-[minmax(200px,1fr)_68px_104px_104px_112px_150px]';

function Cabecalho() {
  const colunas = ['Item', 'Compras', 'Primeiro', 'Último', 'Variação', 'Último fornecedor'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i >= 1 && i <= 4 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaCustoAquisicao }) {
  const variacao = item.variacaoPercentual === null ? null : Number(item.variacaoPercentual);
  const subiu = variacao !== null && variacao > 0;
  const caiu = variacao !== null && variacao < 0;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 lg:grid',
        GRADE,
        subiu && variacao > 20 && 'bg-[#fdf5f5]',
      )}
    >
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        <span className="block truncate text-[13px] text-neutral-900">
          {item.produto} <span className="text-neutral-500">· {item.descricaoVariacao}</span>
        </span>
        <span className="block truncate font-mono text-[10.5px] text-neutral-400">
          {item.sku} · entre {brl(item.menorCusto)} e {brl(item.maiorCusto)}
        </span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 lg:text-right">{item.compras}</span>

      <span className="font-mono text-[12.5px] tabular-nums text-neutral-500 lg:text-right">
        {brl(item.primeiroCusto)}
      </span>

      <span className="font-mono text-[13px] font-medium tabular-nums text-neutral-900 lg:text-right">
        {brl(item.ultimoCusto)}
      </span>

      {/*
        Custo inicial zero não vira "subiu infinito%": sem base não há
        variação, e o texto diz isso em vez de um número inventado.
      */}
      <span
        className={juntar(
          'font-mono text-[12.5px] font-medium tabular-nums lg:text-right',
          variacao === null
            ? 'text-neutral-400'
            : subiu
              ? 'text-[var(--color-perigo)]'
              : caiu
                ? 'text-[var(--color-sucesso)]'
                : 'text-neutral-500',
        )}
      >
        {variacao === null ? 'sem base' : `${subiu ? '+' : ''}${brl(variacao)}%`}
      </span>

      <span className="truncate text-[12px] text-neutral-500">{item.ultimoFornecedor}</span>
    </div>
  );
}
