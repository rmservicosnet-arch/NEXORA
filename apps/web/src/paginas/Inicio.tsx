import { PERM, type CaixaAtual, type LojaResumo, type VisaoGeral } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

/** Variação percentual entre dois valores, ou `null` quando não há base. */
function variacao(agora: string, antes: string): number | null {
  const base = Number(antes);
  if (base === 0) return null;
  return ((Number(agora) - base) / base) * 100;
}

const DIAS = [
  { valor: 7, rotulo: 'Últimos 7 dias' },
  { valor: 14, rotulo: 'Últimos 14 dias' },
  { valor: 30, rotulo: 'Últimos 30 dias' },
];

export function Inicio() {
  const { usuario, pode } = useSessao();
  const [dias, setDias] = useState(14);
  const [lojaId, setLojaId] = useState('');

  const podeVerNumeros = pode(PERM.relatorio.visualizar);

  const lojas = useQuery({
    queryKey: ['lojas'],
    queryFn: () => pedir<LojaResumo[]>('/lojas'),
    staleTime: 5 * 60_000,
  });

  const caixa = useQuery({
    queryKey: ['caixa', 'meu'],
    queryFn: () => pedir<CaixaAtual>('/caixa/meu'),
    enabled: pode(PERM.caixa.abrir),
  });

  const consulta = useQuery({
    queryKey: ['visao-geral', dias, lojaId],
    queryFn: () =>
      pedir<VisaoGeral>(`/visao-geral?dias=${String(dias)}${lojaId ? `&lojaId=${lojaId}` : ''}`),
    enabled: podeVerNumeros,
  });

  const dataPorExtenso = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  if (!podeVerNumeros) {
    return (
      <>
        <header className="flex min-h-[60px] shrink-0 items-center border-b border-neutral-100 bg-white px-4 sm:px-6">
          <span className="text-[13.5px] font-medium text-neutral-900">Visão geral</span>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
          <h1 className="font-display text-[22px] font-bold text-neutral-900">
            Olá, {usuario?.nome.split(' ')[0]}
          </h1>
          <Aviso tom="info">
            Os números da operação exigem a permissão
            <span className="font-mono"> relatorio.visualizar</span>. O menu à esquerda mostra o que
            você pode acionar.
          </Aviso>
        </main>
      </>
    );
  }

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <select
          value={lojaId}
          onChange={(e) => setLojaId(e.target.value)}
          aria-label="Loja"
          className="h-[34px] rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
        >
          <option value="">Todas as lojas</option>
          {lojas.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>

        <div className="hidden flex-1 sm:block" />

        {/* O estado do caixa é o que decide se dá para vender agora. */}
        {caixa.data ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-neutral-600">
            <span
              className={juntar(
                'size-2 rounded-full',
                caixa.data.caixa ? 'bg-[var(--color-sucesso)]' : 'bg-neutral-300',
              )}
              aria-hidden="true"
            />
            {caixa.data.caixa
              ? `Caixa aberto · ${new Date(caixa.data.caixa.abertoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Caixa fechado'}
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold text-neutral-900">Visão geral</h1>
            <p className="text-[13px] text-neutral-500">
              {dataPorExtenso.charAt(0).toUpperCase() + dataPorExtenso.slice(1)}
              {lojaId ? ` · ${lojas.data?.find((l) => l.id === lojaId)?.nome ?? ''}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
              aria-label="Período"
              className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13px]"
            >
              {DIAS.map((d) => (
                <option key={d.valor} value={d.valor}>
                  {d.rotulo}
                </option>
              ))}
            </select>
            {consulta.data ? <Exportar dados={consulta.data} /> : null}
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Carregando os números…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
          />
        ) : null}

        {consulta.data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador
                rotulo="Vendas hoje"
                valor={`R$ ${brl(consulta.data.vendasHoje)}`}
                delta={variacao(consulta.data.vendasHoje, consulta.data.vendasOntem)}
                referencia="vs. ontem"
              />
              <Indicador
                rotulo="Ticket médio"
                valor={`R$ ${brl(consulta.data.ticketMedio)}`}
                delta={variacao(consulta.data.ticketMedio, consulta.data.ticketMedioSemanaAnterior)}
                referencia="vs. semana anterior"
              />
              <Indicador
                rotulo="Abaixo do mínimo"
                valor={String(consulta.data.abaixoDoMinimo)}
                unidade="variações"
                nota={consulta.data.abaixoDoMinimo > 0 ? 'repor' : 'nada a repor'}
                tom={consulta.data.abaixoDoMinimo > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="Saldo negativo"
                valor={String(consulta.data.variacoesNegativas)}
                unidade="variações"
                nota={
                  consulta.data.variacoesNegativas > 0
                    ? `em ${String(consulta.data.lojasComNegativo)} ${consulta.data.lojasComNegativo === 1 ? 'loja' : 'lojas'}`
                    : 'nada negativo'
                }
                tom={consulta.data.variacoesNegativas > 0 ? 'perigo' : 'normal'}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-w-0 flex-col gap-4">
                <Grafico dados={consulta.data} />
                <UltimasVendas dados={consulta.data} />
              </div>
              <PainelNegativos dados={consulta.data} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function Exportar({ dados }: { readonly dados: VisaoGeral }) {
  function baixar() {
    const csv = [
      'dia;total;vendas',
      ...dados.porDia.map((p) => `${p.dia};${p.total};${String(p.vendas)}`),
    ].join('\n');
    const marcaUtf8 = String.fromCharCode(0xfeff);
    const url = URL.createObjectURL(
      new Blob([marcaUtf8 + csv], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vendas-por-dia.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Botao variante="secundario" onClick={baixar}>
      Exportar
    </Botao>
  );
}

function Indicador({
  rotulo,
  valor,
  unidade,
  delta = null,
  referencia,
  nota,
  tom = 'normal',
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly unidade?: string;
  readonly delta?: number | null;
  readonly referencia?: string;
  readonly nota?: string;
  readonly tom?: 'normal' | 'atencao' | 'perigo';
}) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-white px-4 py-3.5 shadow-sm">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1 font-mono text-[22px] font-semibold',
          tom === 'perigo'
            ? 'text-[var(--color-perigo)]'
            : tom === 'atencao'
              ? 'text-[var(--color-atencao)]'
              : 'text-neutral-900',
        )}
      >
        {valor}
        {unidade ? (
          <span className="ml-1.5 font-sans text-[12px] font-normal text-neutral-400">
            {unidade}
          </span>
        ) : null}
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {/*
          Sem base de comparação não se inventa "+100%": divisão por zero não
          é alta, é ausência de referência.
        */}
        {delta !== null ? (
          <span
            className={juntar(
              'font-medium',
              delta > 0
                ? 'text-[var(--color-sucesso)]'
                : delta < 0
                  ? 'text-[var(--color-perigo)]'
                  : 'text-neutral-500',
            )}
          >
            {delta > 0 ? 'Alta de ' : delta < 0 ? 'Queda de ' : 'Estável'}
            {delta === 0 ? '' : `${Math.abs(delta).toFixed(1)}%`}
          </span>
        ) : nota ? (
          <span
            className={juntar(
              'font-medium',
              tom === 'perigo'
                ? 'text-[var(--color-perigo)]'
                : tom === 'atencao'
                  ? 'text-[var(--color-atencao)]'
                  : 'text-neutral-500',
            )}
          >
            {nota}
          </span>
        ) : (
          <span className="text-neutral-400">sem base de comparação</span>
        )}
        {delta !== null && referencia ? (
          <span className="text-neutral-400">{referencia}</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Vendas por dia.
 *
 * Uma medida, um eixo, barras. O dia sem venda aparece como barra rasa e não
 * sumindo da série: pular o dia parado faria a semana parecer contínua, e a
 * segunda-feira vazia encostaria na terça movimentada.
 */
function Grafico({ dados }: { readonly dados: VisaoGeral }) {
  const maior = dados.porDia.reduce((m, p) => Math.max(m, Number(p.total)), 0);
  const teto = maior > 0 ? maior : 1;
  const fracoes = [1, 0.66, 0.33, 0];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">Vendas por dia</h2>
        <span className="font-mono text-[12px] text-neutral-500">
          total R$ {brl(dados.totalDoPeriodo)}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="flex h-[168px] w-[46px] shrink-0 flex-col justify-between py-[2px] text-right">
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
          {/* Grade recuada: as linhas de apoio não competem com as barras. */}
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            {fracoes.map((f) => (
              <div key={f} className="border-t border-neutral-50" />
            ))}
          </div>

          <div className="relative flex h-[168px] items-end gap-[3px]">
            {dados.porDia.map((p) => {
              const vazio = Number(p.total) === 0;
              const altura = vazio ? 2 : Math.max((Number(p.total) / teto) * 100, 2);
              return (
                <div
                  key={p.dia}
                  /*
                    `h-full` não é enfeite: o pai tem `items-end`, que
                    desliga o `stretch`. Sem altura, a porcentagem da barra
                    vira `auto` e o gráfico aparece vazio.
                  */
                  className="group flex h-full flex-1 items-end"
                  title={`${new Date(`${p.dia}T12:00:00`).toLocaleDateString('pt-BR')} · R$ ${brl(p.total)} · ${String(p.vendas)} ${p.vendas === 1 ? 'venda' : 'vendas'}`}
                >
                  <div
                    className={juntar(
                      'w-full rounded-t',
                      vazio ? 'bg-neutral-100' : 'bg-primary-600 group-hover:bg-primary-700',
                    )}
                    style={{ height: `${altura.toFixed(1)}%` }}
                  />
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

function UltimasVendas({ dados }: { readonly dados: VisaoGeral }) {
  return (
    <section className="flex flex-col rounded-lg border border-neutral-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">Últimas vendas</h2>
        <Link to="/pdv" className="text-[12.5px] text-primary-700 no-underline hover:underline">
          Abrir o PDV
        </Link>
      </div>

      <div className="hidden grid-cols-[72px_minmax(0,1fr)_130px_110px_100px] items-center gap-3 border-b border-neutral-50 bg-neutral-25 px-4 py-2 sm:grid">
        {['Venda', 'Cliente', 'Vendedor', 'Pagamento', 'Total'].map((t, i) => (
          <span
            key={t}
            className={juntar(
              'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500',
              i === 4 && 'text-right',
            )}
          >
            {t}
          </span>
        ))}
      </div>

      {dados.ultimasVendas.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-neutral-500">
          Nenhuma venda concluída ainda.
        </p>
      ) : (
        dados.ultimasVendas.map((v) => (
          <div
            key={v.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 last:border-0 sm:grid sm:grid-cols-[72px_minmax(0,1fr)_130px_110px_100px]"
          >
            <span className="font-mono text-[12.5px] text-neutral-600">#{v.numero}</span>
            <span className="min-w-0 truncate text-[13px] text-neutral-900">
              {v.cliente ?? 'Consumidor'}
            </span>
            <span className="truncate text-[12.5px] text-neutral-500">{v.vendedor}</span>
            <span className="text-[12px] text-neutral-500">
              {v.pagamento ? v.pagamento.toLowerCase() : '—'}
            </span>
            <span className="ml-auto font-mono text-[13px] font-medium text-neutral-900 sm:ml-0 sm:text-right">
              R$ {brl(v.total)}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

function PainelNegativos({ dados }: { readonly dados: VisaoGeral }) {
  return (
    <section className="flex h-fit flex-col rounded-lg border border-neutral-100 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">Saldo negativo</h2>
        <p className="mt-1 text-[12px] leading-[17px] text-neutral-500">
          Venda com saldo negativo é permitida pela configuração da empresa. A divergência fica
          registrada até a regularização.
        </p>
      </div>

      {dados.negativos.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-neutral-500">
          Nenhum item abaixo de zero.
        </p>
      ) : (
        dados.negativos.map((n) => (
          <div
            key={`${n.variacaoId}-${n.local}`}
            className="flex items-start gap-3 border-b border-neutral-50 px-4 py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-neutral-900">{n.produto}</p>
              <p className="truncate font-mono text-[10.5px] text-neutral-400">{n.sku}</p>
              <p className="truncate text-[11.5px] text-neutral-500">
                {n.loja} · {n.local}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[14px] font-semibold text-[var(--color-perigo)]">
                {n.saldo}
              </p>
              {/* "Desde quando" separa o que é de hoje do que está parado. */}
              <p className="text-[10.5px] text-neutral-400">
                {n.desde ? `desde ${new Date(n.desde).toLocaleDateString('pt-BR')}` : '—'}
              </p>
            </div>
          </div>
        ))
      )}

      <div className="border-t border-neutral-100 p-3">
        <Link
          to="/estoque"
          className="flex h-9 items-center justify-center rounded-md border border-neutral-200 text-[13px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
        >
          Abrir movimentações
        </Link>
      </div>
    </section>
  );
}
