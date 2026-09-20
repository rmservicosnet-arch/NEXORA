import {
  type DimensaoVendas,
  type LojaPainel,
  type RelatorioVendas as RelatorioVendasDto,
} from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

const QUEBRA = String.fromCharCode(10);

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DIAS = [
  { valor: 7, rotulo: '7 dias' },
  { valor: 14, rotulo: '14 dias' },
  { valor: 30, rotulo: '30 dias' },
  { valor: 90, rotulo: '90 dias' },
];

const DIMENSOES: { chave: DimensaoVendas; nome: string; descricao: string }[] = [
  {
    chave: 'vendedor',
    nome: 'Vendedor',
    descricao: 'Quem vendeu. A margem revela quem vende no desconto.',
  },
  {
    chave: 'produto',
    nome: 'Produto',
    descricao: 'O que mais saiu, em valor. A quantidade está na exportação.',
  },
  { chave: 'cliente', nome: 'Cliente', descricao: 'Quem compra mais. Sem cliente = consumidor.' },
  {
    chave: 'tabela',
    nome: 'Tabela de preço',
    descricao: 'Por qual política o faturamento entrou.',
  },
  { chave: 'categoria', nome: 'Categoria', descricao: 'Onde está o faturamento, por categoria.' },
];

const FORMAS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  PRAZO: 'A prazo',
  CARTEIRA: 'Carteira',
};

/**
 * A rampa de uma cor só, do escuro ao claro.
 *
 * Forma de pagamento não tem ordem natural de categoria — o que ordena é o
 * tamanho. Uma rampa sequencial diz isso; cinco matizes diferentes diriam
 * que são cinco coisas sem relação. DESIGN_SYSTEM.md §4.
 */
const RAMPA = [
  'var(--color-primary-700)',
  'var(--color-primary-500)',
  'var(--color-primary-400)',
  'var(--color-primary-300)',
  'var(--color-primary-200)',
  'var(--color-primary-100)',
  'var(--color-neutral-200)',
  'var(--color-neutral-100)',
];

/**
 * Vendas no período.
 *
 * A margem sai do custo congelado no item da venda. Usar o custo médio de
 * hoje faria a margem de março mudar quando chegasse uma compra em outubro.
 */
export function RelatorioVendas() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const [dias, setDias] = useState(14);
  const [lojaId, setLojaId] = useState('');

  const daUrl = parametrosUrl.get('dimensao') as DimensaoVendas | null;
  const dimensao: DimensaoVendas =
    daUrl && DIMENSOES.some((d) => d.chave === daUrl) ? daUrl : 'vendedor';

  function trocarDimensao(nova: DimensaoVendas) {
    const limpos = new URLSearchParams(parametrosUrl);
    limpos.set('dimensao', nova);
    setParametrosUrl(limpos, { replace: true });
  }

  const lojas = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
  });

  const consulta = useQuery({
    queryKey: ['relatorios', 'vendas', dias, lojaId, dimensao],
    queryFn: () => {
      const p = new URLSearchParams({ dias: String(dias), dimensao });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioVendasDto>(`/relatorios/vendas?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const escolhida = DIMENSOES.find((d) => d.chave === dimensao)!;

  function exportar() {
    if (!dados) return;

    const colunas = ['dia', 'total', 'vendas'];
    const linhas = dados.porDia.map((d) => [d.dia, d.total, String(d.vendas)].join(';'));
    const marcaUtf8 = String.fromCharCode(0xfeff);
    const url = URL.createObjectURL(
      new Blob([marcaUtf8 + [colunas.join(';'), ...linhas].join(QUEBRA)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vendas-no-periodo.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <Link
          to="/relatorios"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Relatórios
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-[13.5px] font-medium text-neutral-900">Vendas no período</span>

        <div className="flex-1" />

        <Filtro rotulo="Período">
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            aria-label="Período"
            className="bg-transparent text-[13px] font-medium text-neutral-900 outline-none"
          >
            {DIAS.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </select>
        </Filtro>

        <Filtro rotulo="Loja">
          <select
            value={lojaId}
            onChange={(e) => setLojaId(e.target.value)}
            aria-label="Loja"
            className="bg-transparent text-[13px] font-medium text-neutral-900 outline-none"
          >
            <option value="">Todas</option>
            {(lojas.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </Filtro>

        <Botao variante="secundario" onClick={exportar} disabled={!dados}>
          Exportar
        </Botao>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-6">
        <div className="shrink-0">
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Vendas no período
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            {dados
              ? `${new Date(`${dados.de}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${dados.ate}T12:00:00`).toLocaleDateString('pt-BR')} · ${lojaId ? (lojas.data?.find((l) => l.id === lojaId)?.nome ?? '') : 'todas as lojas'} · vendas concluídas no balcão`
              : 'Carregando…'}
          </p>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Somando as vendas…" /> : null}

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
            <div className="grid shrink-0 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                rotulo="Faturamento"
                valor={`R$ ${brl(dados.total)}`}
                nota={`${dados.vendas} ${dados.vendas === 1 ? 'venda concluída' : 'vendas concluídas'}`}
              />
              <Kpi
                rotulo="Ticket médio"
                valor={`R$ ${brl(dados.ticketMedio)}`}
                nota="por venda concluída"
              />
              <Kpi rotulo="Itens vendidos" valor={dados.itens} nota="unidades que saíram" />
              {dados.margem !== undefined ? (
                <Kpi
                  rotulo="Margem bruta"
                  valor={dados.margem === null ? '—' : `${dados.margem}%`}
                  nota="sobre o custo congelado na saída"
                  restrito
                />
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 xl:flex-row">
              <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-neutral-100 bg-white p-4 shadow-sm sm:p-5">
                <Grafico dados={dados} />

                <div className="mt-4 shrink-0 border-t border-neutral-50 pt-4">
                  <h3 className="mb-2.5 font-display text-[14px] font-semibold text-neutral-900">
                    Formas de pagamento
                  </h3>

                  {dados.formasPagamento.length === 0 ? (
                    <p className="text-[12.5px] text-neutral-400">Nada recebido no período.</p>
                  ) : (
                    <>
                      {/* Uma barra só, empilhada: a comparação é entre partes
                          de um todo, e cinco barras soltas perderiam o todo. */}
                      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
                        {dados.formasPagamento.map((f, i) => (
                          <div
                            key={f.forma}
                            title={`${FORMAS[f.forma] ?? f.forma} · R$ ${brl(f.total)} · ${f.participacao}%`}
                            style={{
                              width: `${f.participacao}%`,
                              background: RAMPA[i] ?? RAMPA[RAMPA.length - 1],
                            }}
                          />
                        ))}
                      </div>

                      <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                        {dados.formasPagamento.map((f, i) => (
                          <div key={f.forma} className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="size-2 shrink-0 rounded-[2px]"
                                style={{ background: RAMPA[i] ?? RAMPA[RAMPA.length - 1] }}
                              />
                              <span className="truncate text-[12px] text-neutral-700">
                                {FORMAS[f.forma] ?? f.forma}
                              </span>
                            </div>
                            <p className="mt-0.5 font-mono text-[12.5px] font-medium text-neutral-900">
                              R$ {brl(f.total)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-4 shrink-0 border-t border-neutral-50 pt-3.5">
                  <h3 className="mb-2 font-display text-[14px] font-semibold text-neutral-900">
                    Por loja
                  </h3>

                  {dados.porLoja.length === 0 ? (
                    <p className="text-[12.5px] text-neutral-400">Nenhuma venda no período.</p>
                  ) : (
                    dados.porLoja.map((l) => (
                      <div key={l.loja} className="flex h-7 items-center gap-3">
                        <span className="w-[108px] shrink-0 truncate text-[12.5px] text-neutral-700">
                          {l.loja}
                        </span>
                        <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-50">
                          <span
                            className="block h-full rounded-full bg-primary-300"
                            style={{
                              width: `${Math.min(Number(l.participacao), 100).toFixed(1)}%`,
                            }}
                          />
                        </span>
                        <span className="w-[96px] shrink-0 text-right font-mono text-[12.5px] text-neutral-900">
                          R$ {brl(l.total)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section
                aria-label="Ranking de vendas"
                className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm xl:w-[460px]"
              >
                <div className="shrink-0 px-4 pb-3 pt-4">
                  <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                    Ranking por {escolhida.nome.toLowerCase()}
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-neutral-500">{escolhida.descricao}</p>
                </div>

                <div
                  role="tablist"
                  aria-label="Dimensão do ranking"
                  className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-3"
                >
                  {DIMENSOES.map((d) => (
                    <button
                      key={d.chave}
                      type="button"
                      role="tab"
                      aria-selected={dimensao === d.chave}
                      onClick={() => trocarDimensao(d.chave)}
                      className={juntar(
                        'h-8 rounded-full border px-3 text-[12px] font-medium',
                        dimensao === d.chave
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25',
                      )}
                    >
                      {d.nome}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4">
                  {dados.ranking.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma venda no período"
                      descricao="Aumente o período ou troque a loja."
                    />
                  ) : (
                    dados.ranking.map((r, i) => (
                      <div key={r.nome} className="border-b border-neutral-50 py-2.5 last:border-0">
                        <div className="flex items-baseline gap-2.5">
                          <span className="w-4 shrink-0 font-mono text-[11.5px] text-neutral-300">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900">
                            {r.nome}
                          </span>
                          <span className="shrink-0 font-mono text-[13px] font-medium text-neutral-900">
                            R$ {brl(r.valor)}
                          </span>
                        </div>

                        <div className="mt-1.5 flex items-center gap-2.5">
                          <span className="w-4 shrink-0" />
                          <span className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-50">
                            <span
                              className={juntar(
                                'block h-full rounded-full',
                                i === 0 ? 'bg-primary-600' : 'bg-primary-300',
                              )}
                              style={{
                                width: `${Math.min(Number(r.participacao), 100).toFixed(1)}%`,
                              }}
                            />
                          </span>
                          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-neutral-500">
                            {r.participacao}%
                          </span>
                          <span
                            className={juntar(
                              'w-[74px] shrink-0 text-right text-[11px]',
                              r.margem === undefined
                                ? 'text-neutral-300'
                                : r.margem === null
                                  ? 'text-neutral-300'
                                  : Number(r.margem) < 25
                                    ? 'text-[var(--color-perigo)]'
                                    : 'text-[var(--color-sucesso)]',
                            )}
                          >
                            {r.margem === undefined
                              ? `${r.quantidade} un`
                              : r.margem === null
                                ? 'sem custo'
                                : `margem ${r.margem}%`}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex shrink-0 items-center justify-between border-t border-neutral-100 bg-neutral-25 px-4 py-2.5">
                  <span className="text-[12px] text-neutral-500">
                    {dados.ranking.length === 12
                      ? `Top 12 por ${escolhida.nome.toLowerCase()}`
                      : `Total de ${dados.ranking.length} ${dados.ranking.length === 1 ? 'linha' : 'linhas'}`}
                  </span>
                  <span className="font-mono text-[13px] font-semibold text-neutral-900">
                    R$ {brl(dados.total)}
                  </span>
                </div>
              </section>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

/** Filtro no cabeçalho: rótulo à esquerda, valor escolhido em destaque. */
function Filtro({
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

function Kpi({
  rotulo,
  valor,
  nota,
  restrito = false,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  readonly restrito?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
          {rotulo}
        </p>
        {restrito ? (
          <span className="text-neutral-400" title="Exige permissão de custo">
            <Cadeado />
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 font-display text-[27px] font-bold leading-8 text-neutral-900">
        {valor}
      </p>
      <p className="mt-1 text-[12px] text-neutral-500">{nota}</p>
    </div>
  );
}

/**
 * Faturamento por dia.
 *
 * O dia sem venda aparece com barra rasa em vez de sumir: pular o dia parado
 * faria a semana parecer contínua.
 */
function Grafico({ dados }: { readonly dados: RelatorioVendasDto }) {
  const maior = dados.porDia.reduce((m, p) => Math.max(m, Number(p.total)), 0);
  const teto = maior > 0 ? maior : 1;
  const fracoes = [1, 0.66, 0.33, 0];

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">
          Faturamento por dia
        </h2>
        <span className="text-[12.5px] text-neutral-500">
          média diária R$ {brl(dados.mediaDiaria)}
        </span>
      </div>

      <div className="mt-4 flex gap-2.5">
        <div className="flex h-[168px] w-8 shrink-0 flex-col items-end justify-between">
          {fracoes.map((f) => (
            <span key={f} className="font-mono text-[10.5px] leading-none text-neutral-400">
              {maior === 0
                ? '0'
                : (teto * f).toLocaleString('pt-BR', {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  })}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-[168px]">
            <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
              {fracoes.map((f, i) => (
                <div
                  key={f}
                  className={juntar(
                    'border-t',
                    i === fracoes.length - 1
                      ? 'border-neutral-200'
                      : 'border-dashed border-neutral-100',
                  )}
                />
              ))}
            </div>

            <div className="absolute inset-0 flex items-end gap-2">
              {dados.porDia.map((p, indice) => {
                const vazio = Number(p.total) === 0;
                const altura = vazio ? 2 : Math.max((Number(p.total) / teto) * 100, 2);
                const ultimo = indice === dados.porDia.length - 1;

                return (
                  <div
                    key={p.dia}
                    /* `h-full` no trilho: o pai usa `items-end`, que desliga o
                       `stretch`, e sem altura a porcentagem vira `auto`. */
                    className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                    title={`${new Date(`${p.dia}T12:00:00`).toLocaleDateString('pt-BR')} · R$ ${brl(p.total)} · ${String(p.vendas)} ${p.vendas === 1 ? 'venda' : 'vendas'}`}
                  >
                    {ultimo && !vazio ? (
                      <span className="whitespace-nowrap font-mono text-[11px] font-medium text-neutral-900">
                        {brl(p.total)}
                      </span>
                    ) : null}
                    <div
                      className={juntar(
                        'w-full rounded-t',
                        vazio ? 'bg-neutral-100' : ultimo ? 'bg-primary-600' : 'bg-primary-300',
                      )}
                      style={{ height: `${altura.toFixed(1)}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-1.5 flex gap-2">
            {dados.porDia.map((p) => (
              <span
                key={p.dia}
                className="flex-1 text-center font-mono text-[10.5px] text-neutral-400"
              >
                {p.dia.slice(8)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cadeado() {
  return (
    <svg
      width="12"
      height="12"
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
