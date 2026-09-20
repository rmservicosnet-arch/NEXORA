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
  { valor: 7, rotulo: 'Últimos 7 dias' },
  { valor: 14, rotulo: 'Últimos 14 dias' },
  { valor: 30, rotulo: 'Últimos 30 dias' },
  { valor: 90, rotulo: 'Últimos 90 dias' },
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
    descricao: 'O que mais saiu, em valor. A quantidade está ao lado.',
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

  const escolhida = DIMENSOES.find((d) => d.chave === dimensao)!;

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

        <select
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
          aria-label="Período"
          className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12.5px]"
        >
          {DIAS.map((d) => (
            <option key={d.valor} value={d.valor}>
              {d.rotulo}
            </option>
          ))}
        </select>

        <select
          value={lojaId}
          onChange={(e) => setLojaId(e.target.value)}
          aria-label="Loja"
          className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12.5px]"
        >
          <option value="">Todas as lojas</option>
          {(lojas.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>

        <Botao variante="secundario" onClick={exportar} disabled={!dados}>
          Exportar
        </Botao>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-6">
        <div>
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador
                rotulo="Faturamento"
                valor={`R$ ${brl(dados.total)}`}
                nota={`${dados.vendas} ${dados.vendas === 1 ? 'venda' : 'vendas'}`}
              />
              <Indicador
                rotulo="Ticket médio"
                valor={`R$ ${brl(dados.ticketMedio)}`}
                nota="por venda concluída"
              />
              <Indicador rotulo="Itens vendidos" valor={dados.itens} nota="unidades que saíram" />
              {dados.margem !== undefined ? (
                <Indicador
                  rotulo="Margem bruta"
                  valor={dados.margem === null ? '—' : `${dados.margem}%`}
                  nota="sobre o custo congelado na saída"
                  tom={dados.margem !== null && Number(dados.margem) < 25 ? 'perigo' : 'normal'}
                />
              ) : null}
            </div>

            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Grafico dados={dados} />

              <div className="flex flex-col gap-3.5">
                <Distribuicao
                  titulo="Formas de pagamento"
                  linhas={dados.formasPagamento.map((f) => ({
                    nome: FORMAS[f.forma] ?? f.forma,
                    total: f.total,
                    participacao: f.participacao,
                  }))}
                />
                <Distribuicao
                  titulo="Por loja"
                  linhas={dados.porLoja.map((l) => ({
                    nome: l.loja,
                    total: l.total,
                    participacao: l.participacao,
                  }))}
                />
              </div>
            </div>

            <section className="flex flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                    Ranking por {escolhida.nome.toLowerCase()}
                  </h2>
                  <p className="text-[12.5px] text-neutral-500">{escolhida.descricao}</p>
                </div>

                <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                  {DIMENSOES.map((d) => (
                    <button
                      key={d.chave}
                      type="button"
                      aria-pressed={dimensao === d.chave}
                      onClick={() => trocarDimensao(d.chave)}
                      className={juntar(
                        'h-8 rounded-full border px-3 text-[12.5px] font-medium',
                        dimensao === d.chave
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25',
                      )}
                    >
                      {d.nome}
                    </button>
                  ))}
                </div>
              </div>

              {dados.ranking.length === 0 ? (
                <EstadoVazio
                  titulo="Nenhuma venda no período"
                  descricao="Aumente o período ou troque a loja."
                />
              ) : (
                <>
                  <div className="hidden grid-cols-[40px_minmax(0,1fr)_120px_110px_100px_90px] gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 sm:grid">
                    {['#', escolhida.nome, 'Valor', 'Participação', 'Qtd.', 'Margem']
                      .filter((c) => c !== 'Margem' || dados.ranking[0]?.margem !== undefined)
                      .map((c, i) => (
                        <span
                          key={c}
                          className={juntar(
                            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                            i >= 2 ? 'text-right' : '',
                          )}
                        >
                          {c}
                        </span>
                      ))}
                  </div>

                  {dados.ranking.map((r, i) => (
                    <div
                      key={r.nome}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 last:border-0 sm:grid sm:grid-cols-[40px_minmax(0,1fr)_120px_110px_100px_90px]"
                    >
                      <span className="font-mono text-[12px] text-neutral-400">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 sm:flex-none">
                        {r.nome}
                      </span>
                      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
                        R$ {brl(r.valor)}
                      </span>

                      {/* A participação é barra e número: a barra compara, o
                          número confere. */}
                      <span className="flex items-center gap-2 sm:justify-end">
                        <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-neutral-100 sm:block">
                          <span
                            className="block h-full rounded-full bg-primary-600"
                            style={{
                              width: `${Math.min(Number(r.participacao), 100).toFixed(1)}%`,
                            }}
                          />
                        </span>
                        <span className="font-mono text-[12.5px] text-neutral-600">
                          {r.participacao}%
                        </span>
                      </span>

                      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
                        {r.quantidade}
                      </span>

                      {r.margem !== undefined ? (
                        <span
                          className={juntar(
                            'font-mono text-[12.5px] font-medium sm:text-right',
                            r.margem === null
                              ? 'text-neutral-300'
                              : Number(r.margem) < 25
                                ? 'text-[var(--color-perigo)]'
                                : 'text-[var(--color-sucesso)]',
                          )}
                        >
                          {r.margem === null ? '—' : `${r.margem}%`}
                        </span>
                      ) : null}
                    </div>
                  ))}

                  <div className="flex h-11 shrink-0 items-center gap-4 border-t border-neutral-100 bg-neutral-25 px-4 text-[12.5px] text-neutral-500">
                    <span>
                      {dados.ranking.length} {dados.ranking.length === 1 ? 'linha' : 'linhas'} ·
                      ordenado por valor
                    </span>
                    <div className="flex-1" />
                    <span className="font-mono font-semibold text-neutral-900">
                      R$ {brl(dados.total)}
                    </span>
                  </div>
                </>
              )}
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}

function Indicador({
  rotulo,
  valor,
  nota,
  tom = 'normal',
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  readonly tom?: 'normal' | 'perigo';
}) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1 font-mono text-[22px] font-semibold',
          tom === 'perigo' ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
        )}
      >
        {valor}
      </p>
      <p className="mt-0.5 text-[11.5px] text-neutral-500">{nota}</p>
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
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">
          Faturamento por dia
        </h2>
        <span className="font-mono text-[12px] text-neutral-500">
          média diária R$ {brl(dados.mediaDiaria)}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="flex h-[176px] w-[46px] shrink-0 flex-col justify-between py-[2px] text-right">
          {fracoes.map((f) => (
            <span key={f} className="font-mono text-[10px] text-neutral-400">
              {maior === 0
                ? '0'
                : (teto * f).toLocaleString('pt-BR', {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  })}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            {fracoes.map((f) => (
              <div key={f} className="border-t border-neutral-50" />
            ))}
          </div>

          <div className="relative flex h-[176px] items-end gap-[3px]">
            {dados.porDia.map((p, indice) => {
              const vazio = Number(p.total) === 0;
              const altura = vazio ? 2 : Math.max((Number(p.total) / teto) * 100, 2);
              const ultimo = indice === dados.porDia.length - 1;

              return (
                <div
                  key={p.dia}
                  /* `h-full` no trilho: o pai usa `items-end`, que desliga o
                     `stretch`, e sem altura a porcentagem vira `auto`. */
                  className="group flex h-full flex-1 items-end"
                  title={`${new Date(`${p.dia}T12:00:00`).toLocaleDateString('pt-BR')} · R$ ${brl(p.total)} · ${String(p.vendas)} ${p.vendas === 1 ? 'venda' : 'vendas'}`}
                >
                  <div className="flex h-full w-full flex-col items-center justify-end gap-1">
                    {ultimo && !vazio ? (
                      <span className="whitespace-nowrap font-mono text-[11px] font-medium text-neutral-900">
                        {brl(p.total)}
                      </span>
                    ) : null}
                    <div
                      className={juntar(
                        'w-full rounded-t',
                        vazio
                          ? 'bg-neutral-100'
                          : ultimo
                            ? 'bg-primary-600'
                            : 'bg-primary-300 group-hover:bg-primary-400',
                      )}
                      style={{ height: `${altura.toFixed(1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex gap-[3px] pl-[54px]">
        {dados.porDia.map((p) => (
          <span key={p.dia} className="flex-1 text-center font-mono text-[9.5px] text-neutral-400">
            {p.dia.slice(8)}
          </span>
        ))}
      </div>
    </section>
  );
}

function Distribuicao({
  titulo,
  linhas,
}: {
  readonly titulo: string;
  readonly linhas: { nome: string; total: string; participacao: string }[];
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
      <h2 className="border-b border-neutral-100 px-4 py-2.5 font-display text-[14px] font-semibold text-neutral-900">
        {titulo}
      </h2>

      {linhas.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-neutral-400">Nada no período.</p>
      ) : (
        linhas.map((l) => (
          <div
            key={l.nome}
            className="flex items-center gap-2.5 border-b border-neutral-50 px-4 py-2 last:border-0"
          >
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700">{l.nome}</span>
            <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-neutral-100">
              <span
                className="block h-full rounded-full bg-primary-600"
                style={{ width: `${Math.min(Number(l.participacao), 100).toFixed(1)}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[11.5px] text-neutral-500">
              {l.participacao}%
            </span>
            <span className="w-[92px] shrink-0 text-right font-mono text-[12.5px] font-medium text-neutral-900">
              R$ {brl(l.total)}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
