import {
  type LinhaInventario,
  type LojaPainel,
  type RelatorioInventario,
} from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  brl,
  CabecalhoRelatorio,
  dataHora,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

/**
 * Divergências de inventário: o contado contra o sistema.
 *
 * Sobra e falta não se compensam. Somar as duas daria "quase zero" numa loja
 * onde metade do estoque está guardado no lugar errado — e é exatamente essa
 * loja que precisa do relatório.
 */
export function RelatorioInventarioTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 90);
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
    queryKey: ['relatorios', 'inventario', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioInventario>(`/relatorios/inventario?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const comCusto = dados?.efeitoLiquido !== undefined;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'divergencias-de-inventario.csv',
      [
        'data',
        'sku',
        'produto',
        'variacao',
        'loja',
        'local',
        'antes',
        'depois',
        'diferenca',
        ...(comCusto ? ['valor'] : []),
        'justificativa',
        'usuario',
      ],
      dados.itens.map((i) => [
        dataHora(i.em),
        i.sku,
        i.produto,
        i.descricaoVariacao,
        i.loja,
        i.local,
        i.saldoAntes,
        i.saldoDepois,
        i.diferenca,
        ...(comCusto ? [i.valor ?? ''] : []),
        i.justificativa ?? '',
        i.ator ?? '',
      ]),
    );
  }

  const liquido = Number(dados?.efeitoLiquido ?? 0);

  return (
    <>
      <CabecalhoRelatorio
        titulo="Divergências de inventário"
        comCusto={comCusto}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Divergências de inventário
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · sobra e falta contadas separadamente, sem se anularem
                </>
              ) : (
                'Carregando…'
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '90')}>
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

        {consulta.isPending ? <EstadoCarregando titulo="Comparando com a contagem…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar as divergências"
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
            <div
              className={juntar(
                'grid shrink-0 auto-rows-fr gap-3',
                comCusto ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
              )}
            >
              <Indicador
                rotulo="Ajustes de contagem"
                valor={String(dados.contagens)}
                nota={`em ${rotuloPeriodo(dados.dias)}`}
              />
              <Indicador
                rotulo="Sobras"
                valor={String(dados.sobras)}
                nota="contado a mais que o sistema"
                tom={dados.sobras > 0 ? 'sucesso' : 'normal'}
              />
              <Indicador
                rotulo="Faltas"
                valor={String(dados.faltas)}
                nota="contado a menos que o sistema"
                tom={dados.faltas > 0 ? 'perigo' : 'normal'}
              />
              {comCusto ? (
                <Indicador
                  rotulo="Efeito no patrimônio"
                  valor={`${liquido < 0 ? '− ' : ''}R$ ${brl(liquido)}`}
                  nota="sobras menos faltas, a custo"
                  tom={liquido < 0 ? 'perigo' : 'normal'}
                />
              ) : null}
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1320px]">
                <Cabecalho comCusto={comCusto} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma divergência no período"
                      descricao="A contagem bateu com o sistema, ou ainda não houve contagem."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.id} item={i} comCusto={comCusto} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length} de {dados.contagens} · da mais recente
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

const GRADE_COM_CUSTO =
  'sm:grid-cols-[124px_112px_minmax(220px,1fr)_150px_66px_66px_78px_110px_150px_120px]';
const GRADE_SEM_CUSTO =
  'sm:grid-cols-[124px_112px_minmax(220px,1fr)_150px_66px_66px_78px_150px_120px]';

function Cabecalho({ comCusto }: { readonly comCusto: boolean }) {
  const colunas = [
    'Data',
    'SKU',
    'Variação',
    'Local',
    'Antes',
    'Depois',
    'Diferença',
    ...(comCusto ? ['Valor'] : []),
    'Justificativa',
    'Usuário',
  ];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
      )}
    >
      {colunas.map((c) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            ['Antes', 'Depois', 'Diferença', 'Valor'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item, comCusto }: { readonly item: LinhaInventario; readonly comCusto: boolean }) {
  const diferenca = Number(item.diferenca);
  const falta = diferenca < 0;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
        falta && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span className="font-mono text-[11.5px] text-neutral-600">{item.sku}</span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 sm:flex-none">
        {item.produto}
        <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
      </span>

      <span className="truncate text-[12px] text-neutral-500">
        {item.loja} · {item.local}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        {item.saldoAntes}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-700 sm:text-right">
        {item.saldoDepois}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-semibold sm:text-right',
          falta ? 'text-[var(--color-perigo)]' : 'text-[var(--color-sucesso)]',
        )}
      >
        {falta ? '−' : '+'}
        {Math.abs(diferenca)}
      </span>

      {comCusto ? (
        <span
          className={juntar(
            'font-mono text-[13px] font-medium sm:text-right',
            falta ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
          )}
        >
          {falta ? '− ' : ''}R$ {brl(item.valor ?? 0)}
        </span>
      ) : null}

      <span className="truncate text-[12.5px] text-neutral-600" title={item.justificativa ?? ''}>
        {item.justificativa ?? '—'}
      </span>

      <span className="truncate text-[12.5px] text-neutral-500">{item.ator ?? '—'}</span>
    </div>
  );
}
