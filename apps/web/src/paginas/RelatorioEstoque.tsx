import {
  type ApoioProduto,
  type LinhaPosicao,
  type LojaPainel,
  type PosicaoEstoque,
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
  return Math.abs(Number(v)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Recorte = 'todos' | 'negativos' | 'abaixoDoMinimo';

const RECORTES: { chave: Recorte; nome: string }[] = [
  { chave: 'todos', nome: 'Todos' },
  { chave: 'abaixoDoMinimo', nome: 'Abaixo do mínimo' },
  { chave: 'negativos', nome: 'Saldo negativo' },
];

/** O mesmo relatório, com o nome que o índice deu a cada recorte. */
const TITULOS: Record<Recorte, string> = {
  todos: 'Posição de estoque',
  abaixoDoMinimo: 'Abaixo do mínimo',
  negativos: 'Saldo negativo',
};

/**
 * Posição de estoque.
 *
 * Uma foto de um instante — por isso o cabeçalho diz quando. O valor aparece
 * em três números porque somar só os positivos dá um patrimônio maior do que
 * existe: saldo negativo é mercadoria que já saiu e não foi baixada.
 */
export function RelatorioEstoque() {
  const [lojaId, setLojaId] = useState('');
  const [localId, setLocalId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');

  /**
   * O recorte vem da URL.
   *
   * "Saldo negativo" e "Abaixo do mínimo" são itens próprios do índice de
   * relatórios, e é este relatório que os responde. Link direto para o
   * recorte é melhor do que três telas consultando a mesma coisa.
   */
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const daUrl = parametrosUrl.get('recorte') as Recorte | null;
  const recorte: Recorte = daUrl && RECORTES.some((r) => r.chave === daUrl) ? daUrl : 'todos';

  function setRecorte(nova: Recorte) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (nova === 'todos') limpos.delete('recorte');
    else limpos.set('recorte', nova);
    setParametrosUrl(limpos, { replace: true });
  }

  const lojas = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
  });

  const apoio = useQuery({
    queryKey: ['produtos', 'apoio'],
    queryFn: () => pedir<ApoioProduto>('/produtos/apoio'),
  });

  const consulta = useQuery({
    queryKey: ['relatorios', 'posicao', lojaId, localId, categoriaId, recorte],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', recorte });
      if (lojaId) p.set('lojaId', lojaId);
      if (localId) p.set('localId', localId);
      if (categoriaId) p.set('categoriaId', categoriaId);
      return pedir<PosicaoEstoque>(`/relatorios/posicao-estoque?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const locais = (lojas.data ?? [])
    .filter((l) => !lojaId || l.id === lojaId)
    .flatMap((l) => l.locais.map((o) => ({ ...o, loja: l.nome })));

  function exportar() {
    const dados = consulta.data;
    if (!dados) return;

    const comCusto = dados.itens.some((i) => i.custoMedio !== undefined);
    const colunas = [
      'sku',
      'produto',
      'variacao',
      'categoria',
      'loja',
      'local',
      'saldo',
      'minimo',
      ...(comCusto ? ['custo_medio', 'valor', 'abc'] : []),
    ];

    const linhas = dados.itens.map((i) =>
      [
        i.sku,
        i.produto.replaceAll(';', ','),
        i.descricaoVariacao.replaceAll(';', ','),
        i.categoria ?? '',
        i.loja,
        i.local,
        i.saldo,
        i.estoqueMinimo,
        ...(comCusto ? [i.custoMedio ?? '', i.valor ?? '', i.abc ?? ''] : []),
      ].join(';'),
    );

    const marcaUtf8 = String.fromCharCode(0xfeff);
    const url = URL.createObjectURL(
      new Blob([marcaUtf8 + [colunas.join(';'), ...linhas].join(QUEBRA)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'posicao-de-estoque.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const dados = consulta.data;
  const comCusto = dados?.valorLiquido !== undefined;

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
        <span className="text-[13.5px] font-medium text-neutral-900">{TITULOS[recorte]}</span>

        <div className="flex-1" />

        {comCusto ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-50 px-2.5 py-1 text-[11.5px] font-semibold text-neutral-600">
            <Cadeado />
            Contém custo — acesso restrito
          </span>
        ) : null}

        <Botao variante="secundario" onClick={exportar} disabled={!dados}>
          Exportar
        </Botao>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              {TITULOS[recorte]}
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  {dados.variacoes} {dados.variacoes === 1 ? 'variação' : 'variações'} ·{' '}
                  {dados.produtos} {dados.produtos === 1 ? 'produto' : 'produtos'} · posição em{' '}
                  <strong className="font-semibold text-neutral-900">
                    {new Date(dados.em).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </strong>
                </>
              ) : (
                'Carregando…'
              )}
            </p>
          </div>

          {/* Os filtros ficam na linha do título, como no desenho: rótulo à
              esquerda, escolha em destaque. */}
          <div className="flex flex-wrap gap-2">
            <Filtro rotulo="Loja">
              <select
                value={lojaId}
                onChange={(e) => {
                  setLojaId(e.target.value);
                  setLocalId('');
                }}
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

            <Filtro rotulo="Local">
              <select
                value={localId}
                onChange={(e) => setLocalId(e.target.value)}
                aria-label="Local"
                className="bg-transparent text-[13px] font-medium text-neutral-900 outline-none"
              >
                <option value="">Todos</option>
                {locais.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.loja} · {o.nome}
                  </option>
                ))}
              </select>
            </Filtro>

            <Filtro rotulo="Categoria">
              <select
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
                aria-label="Categoria"
                className="bg-transparent text-[13px] font-medium text-neutral-900 outline-none"
              >
                <option value="">Todas</option>
                {(apoio.data?.categorias ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Filtro>

            <Filtro rotulo="Recorte">
              <select
                value={recorte}
                onChange={(e) => setRecorte(e.target.value as Recorte)}
                aria-label="Recorte"
                className="bg-transparent text-[13px] font-medium text-neutral-900 outline-none"
              >
                {RECORTES.map((r) => (
                  <option key={r.chave} value={r.chave}>
                    {r.nome}
                  </option>
                ))}
              </select>
            </Filtro>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Contando o estoque…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível montar a posição"
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
              {comCusto ? <ValorDoEstoque dados={dados} /> : null}

              <div className="grid flex-1 auto-rows-fr gap-3 sm:grid-cols-2">
                <Indicador
                  rotulo="Variações em estoque"
                  valor={String(dados.variacoes)}
                  nota={`${dados.unidades} unidades`}
                />
                {comCusto ? (
                  <Indicador
                    rotulo="Custo médio da carteira"
                    valor={`R$ ${brl(dados.custoMedioDaCarteira ?? 0)}`}
                    nota="por variação"
                  />
                ) : null}
                <Indicador
                  rotulo="Abaixo do mínimo"
                  valor={String(dados.abaixoDoMinimo)}
                  nota="usa o saldo do local"
                  tom={dados.abaixoDoMinimo > 0 ? 'atencao' : 'normal'}
                  aoClicar={() => setRecorte('abaixoDoMinimo')}
                />
                <Indicador
                  rotulo="Com saldo negativo"
                  valor={String(dados.comSaldoNegativo)}
                  nota={
                    comCusto && dados.efeitoNegativos
                      ? `− R$ ${brl(dados.efeitoNegativos)} no total`
                      : 'mercadoria que saiu sem baixa'
                  }
                  tom={dados.comSaldoNegativo > 0 ? 'perigo' : 'normal'}
                  aoClicar={() => setRecorte('negativos')}
                />
              </div>
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
              <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1000px]">
                  <Cabecalho comCusto={comCusto} />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Nada nesta posição"
                        descricao="Ajuste a loja, o local ou o recorte."
                      />
                    ) : (
                      dados.itens.map((i) => (
                        <Linha key={`${i.variacaoId}-${i.local}`} item={i} comCusto={comCusto} />
                      ))
                    )}
                  </div>

                  {/*
                    O rodapé é a MESMA grade das linhas: o total de unidades cai
                    sob "Saldo" e o de valor sob "Valor". Alinhado à direita, em
                    flex, o número ficaria embaixo de coluna nenhuma.
                  */}
                  <div
                    className={juntar(
                      'hidden shrink-0 items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:grid',
                      comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
                    )}
                  >
                    <span className="col-span-3 text-[12.5px] font-semibold text-neutral-700">
                      Exibindo {dados.itens.length} de {dados.variacoes}{' '}
                      {dados.variacoes === 1 ? 'variação' : 'variações'} · ordenado por valor
                    </span>
                    <span className="text-right font-mono text-[12.5px] text-neutral-600">
                      {dados.totalExibido.unidades}
                    </span>
                    <span />
                    {comCusto ? (
                      <>
                        <span />
                        <span className="text-right font-mono text-[14px] font-semibold text-neutral-900">
                          R$ {brl(dados.totalExibido.valor ?? 0)}
                        </span>
                        <span />
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}

/** Filtro no alto: rótulo à esquerda, escolha em destaque. */
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

/**
 * O valor do estoque em três números.
 *
 * Somar só os positivos daria mais patrimônio do que existe. O negativo entra
 * com sinal, e a diferença fica dita por extenso.
 */
function ValorDoEstoque({ dados }: { readonly dados: PosicaoEstoque }) {
  return (
    <section className="w-full shrink-0 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[480px]">
      <h2 className="mb-3 font-display text-[14px] font-semibold text-neutral-900">
        Valor do estoque
      </h2>

      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-neutral-700">
          <span className="size-2.5 rounded-[2px] bg-[var(--color-sucesso)]" />
          Saldos positivos
        </span>
        <span className="font-mono text-[16px] font-medium text-neutral-900">
          R$ {brl(dados.valorPositivos ?? 0)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t border-neutral-50 py-2.5">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-neutral-700">
          <span className="size-2.5 rounded-[2px] bg-[var(--color-perigo)]" />
          Efeito dos saldos negativos
        </span>
        <span className="font-mono text-[16px] font-medium text-[var(--color-perigo)]">
          − R$ {brl(dados.efeitoNegativos ?? 0)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 border-t-2 border-neutral-900 pt-2.5">
        <span className="font-display text-[15px] font-bold text-neutral-900">Valor líquido</span>
        <span className="font-display text-[30px] font-bold leading-9 text-neutral-900">
          R$ {brl(dados.valorLiquido ?? 0)}
        </span>
      </div>

      <p className="mt-2.5 text-[12px] leading-[17px] text-neutral-500">
        Saldo negativo entra com sinal e <strong className="text-neutral-700">reduz</strong> o
        patrimônio. Somar só os positivos daria R$ {brl(dados.efeitoNegativos ?? 0)} a mais do que
        existe.
      </p>
    </section>
  );
}

function Indicador({
  rotulo,
  valor,
  nota,
  tom = 'normal',
  aoClicar,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  readonly tom?: 'normal' | 'atencao' | 'perigo';
  readonly aoClicar?: () => void;
}) {
  const conteudo = (
    <>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1.5 font-display text-[24px] font-bold leading-7',
          tom === 'perigo'
            ? 'text-[var(--color-perigo)]'
            : tom === 'atencao'
              ? 'text-[var(--color-atencao)]'
              : 'text-neutral-900',
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-[12px] text-neutral-500">{nota}</p>
    </>
  );

  const classe = juntar(
    'rounded-lg border bg-white px-4 py-3 text-left shadow-sm',
    tom === 'perigo'
      ? 'border-[#f0c9cb]'
      : tom === 'atencao'
        ? 'border-[#ebd6a8]'
        : 'border-neutral-100',
  );

  if (!aoClicar) {
    return <div className={classe}>{conteudo}</div>;
  }

  return (
    <button type="button" onClick={aoClicar} className={juntar(classe, 'hover:bg-neutral-25')}>
      {conteudo}
    </button>
  );
}

function Cabecalho({ comCusto }: { readonly comCusto: boolean }) {
  const colunas = comCusto
    ? ['SKU', 'Variação', 'Local', 'Saldo', 'Mín.', 'Custo médio', 'Valor', 'ABC']
    : ['SKU', 'Variação', 'Local', 'Saldo', 'Mín.'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i >= 3 && c !== 'ABC' ? 'text-right' : '',
            c === 'ABC' ? 'text-center' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

const GRADE_COM_CUSTO = 'sm:grid-cols-[140px_minmax(0,1fr)_170px_90px_70px_110px_120px_56px]';
const GRADE_SEM_CUSTO = 'sm:grid-cols-[132px_minmax(0,1fr)_132px_74px_74px]';

function Linha({ item, comCusto }: { readonly item: LinhaPosicao; readonly comCusto: boolean }) {
  const saldo = Number(item.saldo);

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2',
        'sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
        saldo < 0 && 'bg-[#fdf5f5]',
        saldo >= 0 && item.abaixoDoMinimo && 'bg-[#fdfaf6]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-600">{item.sku}</span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 sm:flex-none">
        {item.produto}
        <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
      </span>

      <span className="truncate text-[12px] text-neutral-500">
        {item.loja} · {item.local}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-medium sm:text-right',
          saldo < 0
            ? 'text-[var(--color-perigo)]'
            : item.abaixoDoMinimo
              ? 'text-[var(--color-atencao)]'
              : 'text-neutral-900',
        )}
      >
        {item.saldo}
      </span>

      <span className="font-mono text-[12px] text-neutral-400 sm:text-right">
        {item.estoqueMinimo}
      </span>

      {comCusto ? (
        <>
          <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
            R$ {brl(item.custoMedio ?? 0)}
          </span>
          <span
            className={juntar(
              'font-mono text-[13px] font-medium sm:text-right',
              Number(item.valor ?? 0) < 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
            )}
          >
            {Number(item.valor ?? 0) < 0 ? '− ' : ''}R$ {brl(item.valor ?? 0)}
          </span>
          <span className="sm:text-center">
            {item.abc ? (
              <span
                className={juntar(
                  'inline-flex size-5 items-center justify-center rounded text-[10.5px] font-bold',
                  item.abc === 'A'
                    ? 'bg-primary-600 text-white'
                    : item.abc === 'B'
                      ? 'bg-primary-100 text-primary-800'
                      : 'bg-neutral-100 text-neutral-500',
                )}
                title={
                  item.abc === 'A'
                    ? 'Concentra os primeiros 80% do valor'
                    : item.abc === 'B'
                      ? 'Os 15% seguintes do valor'
                      : 'A cauda: os últimos 5% do valor'
                }
              >
                {item.abc}
              </span>
            ) : null}
          </span>
        </>
      ) : null}
    </div>
  );
}

function Cadeado() {
  return (
    <svg
      width="13"
      height="13"
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
