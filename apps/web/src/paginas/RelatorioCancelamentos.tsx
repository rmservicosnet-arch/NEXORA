import {
  type LinhaCancelamento,
  type LojaPainel,
  type RelatorioCancelamentos,
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

/** Abaixo disso o cancelamento é digitação; acima, é mercadoria que voltou. */
const NA_HORA = 10;

/** Acima disso a taxa deixa de ser ruído do balcão. */
const TAXA_ALTA = 8;

function tempo(minutos: number): string {
  if (minutos < 1) return 'na hora';
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 60 * 24) return `${Math.floor(minutos / 60)} h`;
  return `${Math.floor(minutos / (60 * 24))} d`;
}

/**
 * Cancelamentos e devoluções.
 *
 * Cancelar em dois minutos e cancelar três dias depois são problemas
 * diferentes: o primeiro é digitação, o segundo é mercadoria que voltou. Um
 * número só junta os dois e não serve para decidir nada.
 */
export function RelatorioCancelamentosTela() {
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
    queryKey: ['relatorios', 'cancelamentos', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioCancelamentos>(`/relatorios/cancelamentos?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'cancelamentos.csv',
      ['numero', 'cancelada_em', 'loja', 'vendedor', 'cliente', 'total', 'minutos', 'motivo'],
      dados.itens.map((i) => [
        i.numero,
        dataHora(i.em),
        i.loja,
        i.vendedor,
        i.cliente ?? '',
        i.total,
        i.minutosAte,
        i.motivo ?? '',
      ]),
    );
  }

  const depois = dados ? dados.canceladas - dados.naHora : 0;

  return (
    <>
      <CabecalhoRelatorio
        titulo="Cancelamentos e devoluções"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Cancelamentos e devoluções
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · pela data do cancelamento, não da venda
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

        {consulta.isPending ? <EstadoCarregando titulo="Procurando o que foi desfeito…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar os cancelamentos"
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
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo="Taxa de cancelamento"
                valor={`${dados.taxa}%`}
                nota={`${dados.canceladas} de ${dados.canceladas + dados.concluidas} vendas fechadas`}
                tom={Number(dados.taxa) > TAXA_ALTA ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Valor cancelado"
                valor={`R$ ${brl(dados.valorCancelado)}`}
                nota="não entrou no faturamento"
              />
              <Indicador
                rotulo={`Desfeitas em ${NA_HORA} min`}
                valor={String(dados.naHora)}
                nota="erro de digitação no balcão"
              />
              <Indicador
                rotulo="Desfeitas depois"
                valor={String(depois)}
                nota="mercadoria que já tinha saído"
                tom={depois > 0 ? 'atencao' : 'normal'}
              />
            </div>

            {/*
              O zero da devolução é ausência de RECURSO, não boa notícia. Um
              "0 devoluções" tranquilizador esconderia que ninguém consegue
              registrar uma. Ver a coluna `venda_item.quantidade_devolvida`.
            */}
            <p className="shrink-0 rounded-lg border border-[#ebd6a8] bg-[#fdfaf6] px-3.5 py-2.5 text-[12.5px] leading-[18px] text-neutral-700">
              <strong className="text-neutral-900">Devolução parcial ainda não existe.</strong> Só é
              possível cancelar a venda inteira. O sistema encontrou {dados.devolucoesRegistradas}{' '}
              {dados.devolucoesRegistradas === 1 ? 'item devolvido' : 'itens devolvidos'} — e
              nenhuma tela grava esse número, então ele é ausência de recurso, não ausência de
              devolução.
            </p>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[790px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Nenhum cancelamento no período"
                        descricao="Aumente o período ou troque a loja."
                      />
                    ) : (
                      dados.itens.map((i) => <Linha key={i.id} item={i} />)
                    )}
                  </div>

                  <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:flex">
                    <span className="text-[12.5px] font-semibold text-neutral-700">
                      Exibindo {dados.itens.length} de {dados.canceladas} · do mais recente
                    </span>
                  </div>
                </div>
              </Painel>

              <PorMotivo dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

/** Motivo é texto livre: agrupa o que foi escrito, sem inventar categoria. */
function PorMotivo({ dados }: { readonly dados: RelatorioCancelamentos }) {
  const maior = dados.porMotivo.reduce((m, p) => Math.max(m, p.quantidade), 0);

  return (
    <section className="w-full shrink-0 self-start rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[320px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">Por motivo</h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        O que quem cancelou escreveu, agrupado como foi digitado.
      </p>

      {dados.porMotivo.length === 0 ? (
        <p className="mt-4 text-[13px] text-neutral-400">Nenhum cancelamento no período.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3">
          {dados.porMotivo.map((m) => (
            <div key={m.motivo}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700">
                  {m.motivo}
                </span>
                <span className="font-mono text-[12.5px] font-medium text-neutral-900">
                  {m.quantidade}
                </span>
              </div>

              <div className="mt-1 h-[6px] rounded-full bg-neutral-50">
                <div
                  className="h-full rounded-full bg-[var(--color-perigo)]"
                  style={{ width: `${maior > 0 ? (m.quantidade / maior) * 100 : 0}%` }}
                />
              </div>

              <p className="mt-0.5 font-mono text-[11.5px] text-neutral-500">R$ {brl(m.valor)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const GRADE = 'sm:grid-cols-[70px_116px_minmax(160px,1fr)_170px_110px_90px]';

function Cabecalho() {
  const colunas = ['Venda', 'Cancelada em', 'Motivo', 'Quem / cliente', 'Total', 'Depois de'];

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
            ['Total', 'Depois de'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaCancelamento }) {
  const tarde = item.minutosAte >= NA_HORA;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
        tarde && 'bg-[#fdfaf6]',
      )}
    >
      <span className="font-mono text-[12px] text-neutral-600">#{item.numero}</span>

      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span className="min-w-0 truncate text-[13px] text-neutral-900" title={item.motivo ?? ''}>
        {item.motivo ?? <span className="text-neutral-400">Sem motivo informado</span>}
      </span>

      {/* Vendedor e cliente na mesma coluna: duas linhas cabem onde duas
          colunas empurrariam a tabela para fora do painel. */}
      <span className="min-w-0 truncate text-[12.5px] text-neutral-600">
        {item.vendedor}
        {item.cliente ? (
          <span className="block truncate text-[11.5px] text-neutral-400">{item.cliente}</span>
        ) : null}
      </span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        R$ {brl(item.total)}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          tarde ? 'font-medium text-[var(--color-atencao)]' : 'text-neutral-500',
        )}
      >
        {tempo(item.minutosAte)}
      </span>
    </div>
  );
}
