import {
  type LinhaTransferencia,
  type LojaPainel,
  type RelatorioTransferencias,
} from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  CabecalhoRelatorio,
  dataHora,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

/**
 * Transferências entre locais.
 *
 * Uma transferência são DOIS movimentos ligados pelo mesmo documento: a saída
 * de um local e a entrada no outro. Em trânsito é a saída que ainda não tem a
 * entrada par — mercadoria que deixou um lugar e não chegou no outro. É o
 * único número desta tela que alguém precisa perseguir.
 */
export function RelatorioTransferenciasTela() {
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
    queryKey: ['relatorios', 'transferencias', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioTransferencias>(`/relatorios/transferencias?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'transferencias.csv',
      ['data', 'sku', 'produto', 'variacao', 'quantidade', 'origem', 'destino', 'usuario'],
      dados.itens.map((i) => [
        dataHora(i.em),
        i.sku,
        i.produto,
        i.descricaoVariacao,
        i.quantidade,
        i.origem,
        i.destino ?? 'em trânsito',
        i.ator ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Transferências"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Transferências
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · transferência não muda o patrimônio, muda de lugar
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

            <Selecao rotulo="Origem" valor={lojaId} aoMudar={(v) => trocar('lojaId', v, '')}>
              <option value="">Todas as lojas</option>
              {(lojas.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Seguindo a mercadoria…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar as transferências"
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
                rotulo="Enviadas"
                valor={String(dados.enviadas)}
                nota={`saídas em ${rotuloPeriodo(dados.dias)}`}
              />
              <Indicador
                rotulo="Recebidas"
                valor={String(dados.recebidas)}
                nota="chegaram ao destino"
                tom={dados.recebidas > 0 ? 'sucesso' : 'normal'}
              />
              <Indicador
                rotulo="Em trânsito"
                valor={String(dados.emTransito)}
                nota="saíram e ainda não chegaram"
                tom={dados.emTransito > 0 ? 'atencao' : 'normal'}
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1080px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma transferência no período"
                      descricao="Aumente o período ou troque a loja de origem."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.id} item={i} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length} de {dados.enviadas} · da mais recente
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

const GRADE = 'sm:grid-cols-[124px_112px_minmax(200px,1fr)_72px_180px_180px_130px]';

function Cabecalho() {
  const colunas = ['Data', 'SKU', 'Variação', 'Qtd.', 'Origem', 'Destino', 'Usuário'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        GRADE,
      )}
    >
      {colunas.map((c) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            c === 'Qtd.' ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaTransferencia }) {
  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
        item.emTransito && 'bg-[#fdfaf6]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span className="font-mono text-[11.5px] text-neutral-600">{item.sku}</span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 sm:flex-none">
        {item.produto}
        <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
      </span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        {item.quantidade}
      </span>

      <span className="truncate text-[12.5px] text-neutral-600">{item.origem}</span>

      {/*
        Em trânsito é um aviso visível, não um `title`: no celular não há
        hover, e é no celular que o estoquista confere a chegada.
      */}
      <span className="truncate text-[12.5px]">
        {item.destino ?? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdf3e3] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-atencao)]">
            Em trânsito
          </span>
        )}
      </span>

      <span className="truncate text-[12.5px] text-neutral-500">{item.ator ?? '—'}</span>
    </div>
  );
}
