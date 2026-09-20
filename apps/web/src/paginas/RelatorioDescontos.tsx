import { type LinhaDesconto, type LojaPainel, type RelatorioDescontos } from '@estoque/contracts';
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

/** Acima disso o desconto deixa de ser negociação e vira política sem decisão. */
const TAXA_ALTA = 10;

/**
 * Descontos concedidos.
 *
 * Controle, não curiosidade: a pergunta é quem abre mão de quanto, e se o
 * acréscimo está compensando. Desconto mora em dois lugares — no item e no
 * fechamento — e os dois saem do mesmo bolso.
 */
export function RelatorioDescontosTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 30);
  const lojaId = parametrosUrl.get('lojaId') ?? '';

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const lojas = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
  });

  const consulta = useQuery({
    queryKey: ['relatorios', 'descontos', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioDescontos>(`/relatorios/descontos?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'descontos-concedidos.csv',
      [
        'vendedor',
        'vendas',
        'vendas_com_desconto',
        'bruto',
        'desconto',
        'acrescimo',
        'liquido',
        'taxa',
        'maior_taxa',
      ],
      dados.vendedores.map((v) => [
        v.vendedor,
        v.vendas,
        v.comDesconto,
        v.bruto,
        v.desconto,
        v.acrescimo,
        v.liquido,
        v.taxa,
        v.maiorTaxa,
      ]),
    );
  }

  const parteComDesconto = dados && dados.vendas > 0 ? (dados.comDesconto / dados.vendas) * 100 : 0;

  return (
    <>
      <CabecalhoRelatorio
        titulo="Descontos concedidos"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Descontos concedidos
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · desconto do item e do fechamento, somados
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

            <Selecao rotulo="Loja" valor={lojaId} aoMudar={(v) => trocar('lojaId', v, '')}>
              <option value="">Todas</option>
              {(lojas.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Somando os descontos…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível somar os descontos"
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
            <div className="flex shrink-0 flex-col gap-3.5 lg:flex-row">
              <QuantoSaiu dados={dados} />

              <div className="grid flex-1 auto-rows-fr gap-3 sm:grid-cols-2">
                <Indicador
                  rotulo="Taxa de desconto"
                  valor={`${dados.taxa}%`}
                  nota="sobre o valor antes do desconto"
                  tom={Number(dados.taxa) > TAXA_ALTA ? 'atencao' : 'normal'}
                />
                <Indicador
                  rotulo="Vendas com desconto"
                  valor={`${parteComDesconto.toFixed(0)}%`}
                  nota={`${dados.comDesconto} de ${dados.vendas} vendas`}
                />
                <Indicador
                  rotulo="Acréscimos cobrados"
                  valor={`R$ ${brl(dados.acrescimo)}`}
                  nota="o que voltou por juros e taxas"
                  tom={Number(dados.acrescimo) > 0 ? 'sucesso' : 'normal'}
                />
                <Indicador
                  rotulo="Vendedores no período"
                  valor={String(dados.vendedores.length)}
                  nota="ordenados pelo maior desconto"
                />
              </div>
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1000px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.vendedores.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma venda no período"
                      descricao="Aumente o período ou troque a loja."
                    />
                  ) : (
                    dados.vendedores.map((v) => <Linha key={v.vendedorId} item={v} />)
                  )}
                </div>

                <div
                  className={juntar(
                    'hidden shrink-0 items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:grid',
                    GRADE,
                  )}
                >
                  <span className="text-[12.5px] font-semibold text-neutral-700">Total</span>
                  <span className="text-right font-mono text-[12.5px] text-neutral-600">
                    {dados.vendas}
                  </span>
                  <span className="text-right font-mono text-[12.5px] text-neutral-600">
                    {dados.comDesconto}
                  </span>
                  <span className="text-right font-mono text-[12.5px] text-neutral-600">
                    R$ {brl(dados.bruto)}
                  </span>
                  <span className="text-right font-mono text-[14px] font-semibold text-[var(--color-perigo)]">
                    − R$ {brl(dados.desconto)}
                  </span>
                  <span className="text-right font-mono text-[12.5px] text-neutral-600">
                    R$ {brl(dados.acrescimo)}
                  </span>
                  <span className="text-right font-mono text-[14px] font-semibold text-neutral-900">
                    R$ {brl(dados.liquido)}
                  </span>
                  <span className="text-right font-mono text-[12.5px] font-semibold text-neutral-700">
                    {dados.taxa}%
                  </span>
                  <span />
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

/**
 * O caminho do bruto ao líquido, em três linhas.
 *
 * Mostrar só "R$ 4.000 de desconto" não diz se é muito: muito é em relação ao
 * que se deixou de cobrar sobre o que se vendeu.
 */
function QuantoSaiu({ dados }: { readonly dados: RelatorioDescontos }) {
  return (
    <section className="w-full shrink-0 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[420px]">
      <h2 className="mb-3 font-display text-[14px] font-semibold text-neutral-900">
        Do bruto ao líquido
      </h2>

      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-neutral-700">
          <span className="size-2.5 rounded-[2px] bg-[var(--color-primary-500)]" />
          Antes do desconto
        </span>
        <span className="font-mono text-[16px] font-medium text-neutral-900">
          R$ {brl(dados.bruto)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t border-neutral-50 py-2.5">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-neutral-700">
          <span className="size-2.5 rounded-[2px] bg-[var(--color-perigo)]" />
          Desconto concedido
        </span>
        <span className="font-mono text-[16px] font-medium text-[var(--color-perigo)]">
          − R$ {brl(dados.desconto)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t border-neutral-50 py-2.5">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-neutral-700">
          <span className="size-2.5 rounded-[2px] bg-[var(--color-sucesso)]" />
          Acréscimo cobrado
        </span>
        <span className="font-mono text-[16px] font-medium text-[var(--color-sucesso)]">
          + R$ {brl(dados.acrescimo)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 border-t-2 border-neutral-900 pt-2.5">
        <span className="font-display text-[15px] font-bold text-neutral-900">Faturado</span>
        <span className="font-display text-[30px] font-bold leading-9 text-neutral-900">
          R$ {brl(dados.liquido)}
        </span>
      </div>

      <p className="mt-2.5 text-[12px] leading-[17px] text-neutral-500">
        <strong className="text-neutral-700">{dados.taxa}%</strong> do que poderia ter sido cobrado
        ficou na mesa. Desconto de item e de fechamento contam juntos.
      </p>
    </section>
  );
}

const GRADE = 'sm:grid-cols-[minmax(180px,1fr)_66px_86px_120px_130px_110px_130px_70px_92px]';

function Cabecalho() {
  const colunas = [
    'Vendedor',
    'Vendas',
    'C/ desc.',
    'Bruto',
    'Desconto',
    'Acréscimo',
    'Faturado',
    'Taxa',
    'Maior venda',
  ];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        GRADE,
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

function Linha({ item }: { readonly item: LinhaDesconto }) {
  const alta = Number(item.taxa) > TAXA_ALTA;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
        alta && 'bg-[#fdfaf6]',
      )}
    >
      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.vendedor}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">{item.vendas}</span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        {item.comDesconto}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        R$ {brl(item.bruto)}
      </span>

      <span className="font-mono text-[13px] font-medium text-[var(--color-perigo)] sm:text-right">
        − R$ {brl(item.desconto)}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          Number(item.acrescimo) > 0 ? 'text-[var(--color-sucesso)]' : 'text-neutral-400',
        )}
      >
        {Number(item.acrescimo) > 0 ? `+ R$ ${brl(item.acrescimo)}` : '—'}
      </span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        R$ {brl(item.liquido)}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-semibold sm:text-right',
          alta ? 'text-[var(--color-atencao)]' : 'text-neutral-700',
        )}
      >
        {item.taxa}%
      </span>

      {/*
        A maior venda descontada é o que a média esconde: 3% de taxa com um
        pico de 40% numa venda é uma decisão que alguém tomou sozinho.
      */}
      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          Number(item.maiorTaxa) > TAXA_ALTA * 2
            ? 'font-semibold text-[var(--color-perigo)]'
            : 'text-neutral-500',
        )}
      >
        até {item.maiorTaxa}%
      </span>
    </div>
  );
}
