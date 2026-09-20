import { type LojaPainel, type RelatorioConfirmacao } from '@estoque/contracts';
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

const STATUS: Record<string, { nome: string; cor: string; decidido: boolean }> = {
  CONFIRMADO: { nome: 'Confirmado', cor: 'var(--color-sucesso)', decidido: true },
  CONFIRMADO_PARCIALMENTE: { nome: 'Confirmado em parte', cor: '#7aa98c', decidido: true },
  FATURADO: { nome: 'Faturado', cor: 'var(--color-primary-600)', decidido: true },
  CONCLUIDO: { nome: 'Concluído', cor: 'var(--color-primary-400)', decidido: true },
  DEVOLVIDO: { nome: 'Devolvido por falta', cor: 'var(--color-atencao)', decidido: true },
  RECUSADO: { nome: 'Recusado', cor: 'var(--color-perigo)', decidido: true },
  CANCELADO: { nome: 'Cancelado', cor: '#b08c8e', decidido: true },
  AGUARDANDO_CONFIRMACAO: {
    nome: 'Na fila da equipe',
    cor: 'var(--color-neutral-300)',
    decidido: false,
  },
  AGUARDANDO_ACEITE_CLIENTE: {
    nome: 'Esperando o cliente',
    cor: 'var(--color-neutral-200)',
    decidido: false,
  },
  RASCUNHO: { nome: 'Rascunho', cor: 'var(--color-neutral-200)', decidido: false },
};

/**
 * Taxa de confirmação.
 *
 * A taxa se mede sobre os pedidos DECIDIDOS, não sobre os enviados: um pedido
 * que chegou há dez minutos e ainda está na fila não é fracasso, é pendência.
 * Contá-lo como não confirmado faria a taxa piorar sozinha toda vez que a
 * loja recebesse pedido.
 */
export function RelatorioConfirmacaoTela() {
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
    queryKey: ['relatorios', 'confirmacao', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioConfirmacao>(`/relatorios/pedidos/confirmacao?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'taxa-de-confirmacao.csv',
      ['desfecho', 'pedidos', 'participacao', 'valor_solicitado'],
      dados.desfechos.map((d) => [
        STATUS[d.status]?.nome ?? d.status,
        d.pedidos,
        d.participacao,
        d.valor,
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Taxa de confirmação"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Taxa de confirmação
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Pedidos enviados nos últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · a taxa conta só os que já têm desfecho
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

        {consulta.isPending ? <EstadoCarregando titulo="Seguindo os desfechos…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível apurar a taxa"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {dados ? (
          dados.enviados === 0 ? (
            <EstadoVazio
              titulo="Nenhum pedido enviado no período"
              descricao="Aumente o período ou troque a loja."
            />
          ) : (
            <>
              <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Indicador
                  rotulo="Taxa de confirmação"
                  valor={`${dados.taxaConfirmacao}%`}
                  nota={`de ${dados.decididos} pedidos com desfecho`}
                  tom={Number(dados.taxaConfirmacao) < 70 ? 'atencao' : 'sucesso'}
                />
                {/*
                  O que está em aberto NÃO entra na taxa. Sem este cartão, o
                  número pareceria esconder pedido.
                */}
                <Indicador
                  rotulo="Ainda em aberto"
                  valor={String(dados.emAberto)}
                  nota="fora da conta: são pendência, não fracasso"
                />
                <Indicador
                  rotulo="Pedido pelo cliente"
                  valor={`R$ ${brl(dados.valorSolicitado)}`}
                  nota={`${dados.enviados} pedidos enviados`}
                />
                <Indicador
                  rotulo="Aproveitamento"
                  valor={`${dados.aproveitamento}%`}
                  nota={`R$ ${brl(dados.valorConfirmado)} confirmados`}
                />
              </div>

              <Desfechos dados={dados} />

              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[780px]">
                  <div
                    className={juntar(
                      'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
                      GRADE,
                    )}
                  >
                    {[
                      'Loja',
                      'Enviados',
                      'Decididos',
                      'Confirmados',
                      'Taxa',
                      'Valor confirmado',
                    ].map((c, i) => (
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

                  <div className="min-h-0 flex-1">
                    {dados.porLoja.map((l) => (
                      <div
                        key={l.loja}
                        className={juntar(
                          'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 sm:grid',
                          GRADE,
                        )}
                      >
                        <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
                          {l.loja}
                        </span>
                        <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
                          {l.enviados}
                        </span>
                        <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
                          {l.decididos}
                        </span>
                        <span className="font-mono text-[12.5px] text-neutral-700 sm:text-right">
                          {l.confirmados}
                        </span>
                        <span
                          className={juntar(
                            'font-mono text-[13px] font-semibold sm:text-right',
                            Number(l.taxa) < 70
                              ? 'text-[var(--color-atencao)]'
                              : 'text-[var(--color-sucesso)]',
                          )}
                        >
                          {l.taxa}%
                        </span>
                        <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
                          R$ {brl(l.valorConfirmado)}
                        </span>
                      </div>
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

const GRADE = 'sm:grid-cols-[minmax(180px,1fr)_90px_90px_100px_80px_140px]';

/**
 * Onde cada pedido parou.
 *
 * Os que ainda não têm desfecho aparecem em cinza e fora da taxa: escondê-los
 * faria a soma das barras não fechar com "enviados".
 */
function Desfechos({ dados }: { readonly dados: RelatorioConfirmacao }) {
  return (
    <section className="shrink-0 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">
        Onde cada pedido parou
      </h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Os {dados.enviados} pedidos enviados no período, inclusive os que ainda não foram decididos.
      </p>

      <div className="mt-3.5 flex h-[26px] w-full overflow-hidden rounded-[4px]">
        {dados.desfechos.map((d) => (
          <span
            key={d.status}
            className="h-full border-r-2 border-white last:border-r-0"
            style={{
              width: `${d.participacao}%`,
              background: STATUS[d.status]?.cor ?? 'var(--color-neutral-200)',
            }}
            title={`${STATUS[d.status]?.nome ?? d.status}: ${String(d.pedidos)} (${d.participacao}%)`}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {dados.desfechos.map((d) => (
          <span key={d.status} className="inline-flex items-center gap-2 text-[12.5px]">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: STATUS[d.status]?.cor ?? 'var(--color-neutral-200)' }}
            />
            <span className="text-neutral-700">{STATUS[d.status]?.nome ?? d.status}</span>
            <span className="font-mono font-medium text-neutral-900">{d.pedidos}</span>
            <span className="font-mono text-neutral-400">{d.participacao}%</span>
            {STATUS[d.status]?.decidido === false ? (
              <span className="text-[11px] text-neutral-400">fora da taxa</span>
            ) : null}
          </span>
        ))}
      </div>
    </section>
  );
}
