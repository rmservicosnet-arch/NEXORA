import { type DiaDoFluxo, type RelatorioFluxo } from '@estoque/contracts';
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

function dataCurta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

/**
 * Fluxo de caixa REALIZADO.
 *
 * Só baixa que aconteceu. Título em aberto com vencimento no período não
 * entra — ele é promessa, e misturar promessa com dinheiro que passou faz o
 * fluxo mentir exatamente no mês em que ninguém pagou.
 */
export function RelatorioFluxoTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const dias = Number(parametrosUrl.get('dias') ?? 30);

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'fluxo', dias],
    queryFn: () => pedir<RelatorioFluxo>(`/relatorios/financeiro/fluxo?dias=${String(dias)}`),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  /*
    A escala das barras sai do MAIOR dia do período, não de cada linha: barras
    normalizadas por linha fazem um dia de R$ 80 parecer igual a um de
    R$ 8.000, que é o oposto do que um gráfico serve para mostrar.
  */
  const teto = Math.max(
    1,
    ...(dados?.dias ?? []).map((d) => Math.max(Number(d.entrou), Number(d.saiu))),
  );

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'fluxo-de-caixa-realizado.csv',
      ['dia', 'entrou', 'saiu', 'liquido'],
      dados.dias.map((d) => [d.dia, d.entrou, d.saiu, d.liquido]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Fluxo de caixa realizado"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Fluxo de caixa realizado
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              O que <strong className="font-semibold text-neutral-900">passou</strong> — baixas que
              aconteceram, não vencimentos que vão chegar
            </p>
          </div>

          <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '30')}>
            {PERIODOS.map((d) => (
              <option key={d} value={d}>
                {rotuloPeriodo(d)}
              </option>
            ))}
          </Selecao>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Somando o que passou…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível montar o fluxo"
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
                rotulo="Entrou"
                valor={`R$ ${brl(dados.entrou)}`}
                nota="baixas de títulos a receber"
                tom={Number(dados.entrou) > 0 ? 'sucesso' : 'normal'}
              />
              <Indicador
                rotulo="Saiu"
                valor={`R$ ${brl(dados.saiu)}`}
                nota="baixas de títulos a pagar"
                tom={Number(dados.saiu) > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Líquido"
                valor={`R$ ${brl(dados.liquido)}`}
                nota={Number(dados.liquido) < 0 ? 'saiu mais do que entrou' : 'sobrou no período'}
                tom={Number(dados.liquido) < 0 ? 'perigo' : 'sucesso'}
              />
            </div>

            {/* A ressalva vem da API, não do texto da tela: quem consome a
                rota também precisa saber que isto não é previsão. */}
            <p className="shrink-0 rounded-md border border-neutral-100 bg-neutral-25 px-3.5 py-2.5 text-[12px] leading-4 text-neutral-500">
              {dados.observacao}
            </p>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[720px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.dias.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma baixa no período"
                      descricao="Aumente o período, ou dê baixa em algum título para o fluxo ter o que mostrar."
                    />
                  ) : (
                    dados.dias.map((d) => <Linha key={d.dia} dia={d} teto={teto} />)
                  )}
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'lg:grid-cols-[96px_130px_130px_minmax(180px,1fr)_130px]';

function Cabecalho() {
  const colunas = ['Dia', 'Entrou', 'Saiu', '', 'Líquido'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={i}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i === 1 || i === 2 || i === 4 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ dia, teto }: { readonly dia: DiaDoFluxo; readonly teto: number }) {
  const entrou = Number(dia.entrou);
  const saiu = Number(dia.saiu);
  const liquido = Number(dia.liquido);

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 lg:grid',
        GRADE,
      )}
    >
      <span className="font-mono text-[12.5px] text-neutral-600">{dataCurta(dia.dia)}</span>

      <span
        className={juntar(
          'font-mono text-[12.5px] tabular-nums lg:text-right',
          entrou > 0 ? 'text-[var(--color-sucesso)]' : 'text-neutral-300',
        )}
      >
        {entrou > 0 ? `R$ ${brl(entrou)}` : '—'}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] tabular-nums lg:text-right',
          saiu > 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-300',
        )}
      >
        {saiu > 0 ? `R$ ${brl(saiu)}` : '—'}
      </span>

      {/*
        As duas barras dividem o MESMO trilho, com a mesma escala: é o que
        deixa ver, de relance, em que dias saiu mais do que entrou. O trilho
        precisa de `h-full` — sem ele a altura em % vira `auto` e a barra some.
      */}
      <span className="hidden h-5 items-center gap-1 lg:flex">
        <span className="flex h-full flex-1 items-center justify-end">
          <span
            className="h-2.5 rounded-l-sm bg-[var(--color-sucesso)]"
            style={{ width: `${String((entrou / teto) * 100)}%` }}
          />
        </span>
        <span className="h-full w-px bg-neutral-200" />
        <span className="flex h-full flex-1 items-center">
          <span
            className="h-2.5 rounded-r-sm bg-[var(--color-perigo)]"
            style={{ width: `${String((saiu / teto) * 100)}%` }}
          />
        </span>
      </span>

      <span
        className={juntar(
          'ml-auto font-mono text-[13px] font-medium tabular-nums lg:ml-0 lg:text-right',
          liquido < 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
        )}
      >
        {liquido < 0 ? '− ' : ''}R$ {brl(Math.abs(liquido))}
      </span>
    </div>
  );
}
