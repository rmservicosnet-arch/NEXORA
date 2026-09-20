import {
  PERM,
  type ApoioProduto,
  type ItemDaTabela,
  type PaginaItensTabela,
} from '@estoque/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

const QUEBRA = String.fromCharCode(10);

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Os preços de uma tabela, item a item.
 *
 * Antes só existia a grade dentro do produto: para preencher a tabela
 * Professor inteira era preciso abrir produto por produto. Aqui a tabela é o
 * assunto, e o filtro "só os sem preço" é a fila de trabalho — item sem preço
 * não aparece no catálogo de quem compra por ela.
 */
export function PrecosDaTabela() {
  const { tabelaId = '' } = useParams();
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [soSemPreco, setSoSemPreco] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  /** O que foi digitado e ainda não foi gravado, por variação. */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  const podeEditar = pode(PERM.preco.editar);

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const apoio = useQuery({
    queryKey: ['produtos', 'apoio'],
    queryFn: () => pedir<ApoioProduto>('/produtos/apoio'),
  });

  /**
   * A lista cresce por página, sem trocar de página.
   *
   * O servidor já devolvia `proximoCursor` e a tela o ignorava: com 3.888
   * variações, quem precisava da 81ª rolava até o fim e não achava caminho
   * nenhum.
   *
   * Páginas numeradas seriam piores AQUI: esta tela guarda preço digitado e
   * não salvo. Trocar de página desmontaria as linhas com rascunho e o
   * trabalho sumiria sem aviso. Acrescentando, tudo que foi digitado continua
   * na tela até o botão Salvar.
   */
  const consulta = useInfiniteQuery({
    queryKey: ['tabelas-preco', tabelaId, 'itens', busca, categoriaId, soSemPreco],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limite: '80' });
      if (busca) p.set('busca', busca);
      if (categoriaId) p.set('categoriaId', categoriaId);
      if (soSemPreco) p.set('semPreco', 'true');
      if (pageParam) p.set('cursor', pageParam);
      return pedir<PaginaItensTabela>(`/tabelas-preco/${tabelaId}/itens?${p.toString()}`);
    },
    getNextPageParam: (ultima) => ultima.proximoCursor,
    placeholderData: keepPreviousData,
  });

  const gravar = useMutation({
    mutationFn: (precos: { variacaoId: string; preco: string | null }[]) =>
      pedir<{ gravados: number; removidos: number }>(`/tabelas-preco/${tabelaId}/itens`, {
        method: 'PUT',
        body: { precos },
      }),
    onSuccess: async () => {
      setRascunho({});
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['tabelas-preco'] });
      // O catálogo e o PDV leem preço desta tabela; deixá-los com a versão
      // anterior mostraria "sem preço" no item que acabou de ganhar um.
      await fila.invalidateQueries({ queryKey: ['produtos'] });
      await fila.invalidateQueries({ queryKey: ['pdv'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível gravar.');
    },
  });

  const paginas = consulta.data?.pages ?? [];
  const itens = paginas.flatMap((p) => p.itens);
  /* O resumo vem da primeira página: descreve a tabela, não o que foi lido. */
  const resumo = paginas[0];

  /** Só o que mudou de verdade — digitar e apagar de volta não é alteração. */
  const pendentes = itens
    .filter((i) => {
      const digitado = rascunho[i.variacaoId];
      if (digitado === undefined) return false;
      return normalizar(digitado) !== (i.preco ?? '');
    })
    .map((i) => ({
      variacaoId: i.variacaoId,
      preco: normalizar(rascunho[i.variacaoId] ?? '') || null,
    }));

  function exportar() {
    const colunas = ['sku', 'produto', 'variacao', 'categoria', 'preco_padrao', 'preco_tabela'];
    const linhas = itens.map((i) =>
      [
        i.sku,
        i.produto.replaceAll(';', ','),
        i.descricaoVariacao.replaceAll(';', ','),
        i.categoria ?? '',
        i.precoPadrao ?? '',
        i.preco ?? '',
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
    a.download = `precos-${resumo?.tabela.chave.toLowerCase() ?? 'tabela'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando os preços…" />;
  }

  if (consulta.isError || !resumo) {
    return (
      <EstadoErro
        titulo="Não foi possível carregar"
        descricao={
          consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente novamente em instantes.'
        }
        aoTentarNovamente={() => void consulta.refetch()}
      />
    );
  }

  const { tabela, semPreco, margemMedia } = resumo;
  const mostrarCusto = itens.some((i) => i.custoMedio !== undefined);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <Link
          to="/tabelas-preco"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Tabelas de preço
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-[13.5px] font-medium text-neutral-900">{tabela.nome}</span>

        <div className="flex-1" />

        {pendentes.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-atencao-fundo)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-atencao)]">
            <Relogio />
            {pendentes.length === 1 ? '1 preço não salvo' : `${pendentes.length} preços não salvos`}
          </span>
        ) : null}

        {podeEditar ? (
          <>
            <Botao
              variante="secundario"
              disabled={pendentes.length === 0}
              onClick={() => setRascunho({})}
            >
              Descartar
            </Botao>
            <Botao
              variante="primario"
              carregando={gravar.isPending}
              disabled={pendentes.length === 0}
              onClick={() => gravar.mutate(pendentes)}
            >
              Salvar preços
            </Botao>
          </>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2.5 font-display text-[22px] font-bold leading-7 text-neutral-900">
              {tabela.nome}
              <span className="rounded bg-neutral-50 px-2 py-0.5 font-mono text-[12.5px] font-normal text-neutral-500">
                {tabela.chave}
              </span>
              {tabela.padrao ? (
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[11.5px] font-semibold text-primary-700">
                  Padrão
                </span>
              ) : null}
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {tabela.itensComPreco} com preço ·{' '}
              <button
                type="button"
                onClick={() => setSoSemPreco(true)}
                className={juntar(
                  'font-medium underline decoration-[var(--color-atencao)]/40 underline-offset-2',
                  semPreco > 0 ? 'text-[var(--color-atencao)]' : 'text-neutral-500',
                )}
              >
                {semPreco} sem preço
              </button>{' '}
              · {tabela.clientes} {tabela.clientes === 1 ? 'cliente usa' : 'clientes usam'} esta
              tabela
            </p>
          </div>

          <Botao variante="secundario" onClick={exportar}>
            Exportar
          </Botao>
        </div>

        {/*
          `shrink-0` em tudo que não é a lista.

          Sem isso a página inteira passou a rolar: o menu lateral subia junto
          e sumia, e quem estava na linha 60 perdia a navegação. Quem rola é a
          região de dentro; o shell trava a altura na tela.
        */}
        {erro ? (
          <div className="shrink-0">
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          </div>
        ) : null}

        {gravar.isSuccess && pendentes.length === 0 ? (
          <div className="shrink-0">
            <Aviso tom="sucesso">
              {gravar.data.gravados}{' '}
              {gravar.data.gravados === 1 ? 'preço gravado' : 'preços gravados'}
              {gravar.data.removidos > 0 ? ` · ${gravar.data.removidos} removidos` : ''}.
            </Aviso>
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="SKU, produto ou código de barras…"
            aria-label="Buscar item"
            className="h-[35px] w-full max-w-[320px] rounded-md border border-neutral-200 bg-white px-3 text-[13.5px]"
          />

          <Pilula ativa={categoriaId === null} aoClicar={() => setCategoriaId(null)}>
            Todas
          </Pilula>
          {apoio.data?.categorias.map((c) => (
            <Pilula
              key={c.id}
              ativa={categoriaId === c.id}
              aoClicar={() => setCategoriaId(categoriaId === c.id ? null : c.id)}
            >
              {c.nome}
            </Pilula>
          ))}

          <div className="hidden flex-1 sm:block" />

          <label
            className={juntar(
              'flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12.5px] font-medium',
              soSemPreco
                ? 'border-[var(--color-atencao)] bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]'
                : 'border-neutral-200 bg-white text-neutral-600',
            )}
          >
            <input
              type="checkbox"
              checked={soSemPreco}
              onChange={(e) => setSoSemPreco(e.target.checked)}
              className="size-3.5"
            />
            Só os sem preço
          </label>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {itens.length === 0 ? (
            <EstadoVazio
              titulo={soSemPreco ? 'Nenhum item sem preço' : 'Nada encontrado'}
              descricao={
                soSemPreco
                  ? 'Toda variação ativa já tem preço nesta tabela.'
                  : 'Ajuste a busca ou a categoria.'
              }
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[860px]">
                <Cabecalho mostrarCusto={mostrarCusto} nomeDaTabela={tabela.nome} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {itens.map((i) => (
                    <Linha
                      key={i.variacaoId}
                      item={i}
                      mostrarCusto={mostrarCusto}
                      podeEditar={podeEditar}
                      valor={rascunho[i.variacaoId] ?? i.preco ?? ''}
                      aoDigitar={(v) => setRascunho((atual) => ({ ...atual, [i.variacaoId]: v }))}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-100 bg-neutral-25 px-4 py-1.5 text-[12.5px] text-neutral-500">
            {/*
              O denominador conta o RECORTE, não a tabela inteira. Com
              `total`, filtrar uma categoria de 12 itens dizia "12 de 3888" e
              mandava procurar 3.876 linhas que o filtro tinha excluído.
            */}
            <span>
              Exibindo {itens.length} de {resumo.totalFiltrado}
              {resumo.totalFiltrado === 1 ? ' item' : ' itens'}
              {soSemPreco ? ' sem preço' : ''}
            </span>

            {consulta.hasNextPage ? (
              <Botao
                variante="secundario"
                carregando={consulta.isFetchingNextPage}
                onClick={() => void consulta.fetchNextPage()}
              >
                Carregar mais
              </Botao>
            ) : null}

            <div className="flex-1" />
            {margemMedia !== null ? (
              <span>
                Margem média{' '}
                <strong className="font-mono text-[var(--color-sucesso)]">{margemMedia}%</strong>
              </span>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}

/** Aceita vírgula: no balcão ninguém digita ponto decimal. */
function normalizar(valor: string): string {
  return valor.trim().replace(',', '.');
}

function Cabecalho({
  mostrarCusto,
  nomeDaTabela,
}: {
  readonly mostrarCusto: boolean;
  readonly nomeDaTabela: string;
}) {
  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 sm:grid',
        mostrarCusto
          ? 'sm:grid-cols-[140px_minmax(0,1fr)_100px_100px_130px_86px]'
          : 'sm:grid-cols-[140px_minmax(0,1fr)_100px_130px]',
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        SKU
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        Produto · variação
      </span>
      {mostrarCusto ? (
        <span className="flex items-center justify-end gap-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
          <Cadeado />
          Custo
        </span>
      ) : null}
      <span className="text-right text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        Padrão
      </span>
      <span className="text-right text-[11px] font-semibold uppercase tracking-[0.04em] text-primary-700">
        Preço {nomeDaTabela}
      </span>
      {mostrarCusto ? (
        <span className="text-right text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
          Margem
        </span>
      ) : null}
    </div>
  );
}

function Linha({
  item,
  mostrarCusto,
  podeEditar,
  valor,
  aoDigitar,
}: {
  readonly item: ItemDaTabela;
  readonly mostrarCusto: boolean;
  readonly podeEditar: boolean;
  readonly valor: string;
  readonly aoDigitar: (valor: string) => void;
}) {
  const semPreco = item.preco === null && normalizar(valor) === '';
  const margem = item.margem ?? null;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-neutral-50 px-4 py-2.5',
        mostrarCusto
          ? 'sm:grid sm:grid-cols-[140px_minmax(0,1fr)_100px_100px_130px_86px]'
          : 'sm:grid sm:grid-cols-[140px_minmax(0,1fr)_100px_130px]',
        semPreco && 'bg-[#fdfaf6]',
      )}
    >
      <span className="order-1 font-mono text-[11.5px] text-neutral-600 sm:order-none">
        {item.sku}
      </span>

      <div className="order-3 w-full min-w-0 sm:order-none sm:w-auto">
        <p className="truncate text-[13px] text-neutral-900">
          {item.produto}
          <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
        </p>
        {semPreco ? (
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-atencao)]">
            <Alerta />
            fora do catálogo desta tabela
          </p>
        ) : null}
      </div>

      {mostrarCusto ? (
        <span className="order-4 text-right font-mono text-[12.5px] text-neutral-500 sm:order-none">
          {item.custoMedio && Number(item.custoMedio) > 0 ? `R$ ${brl(item.custoMedio)}` : '—'}
        </span>
      ) : null}

      <span className="order-4 text-right font-mono text-[12.5px] text-neutral-500 sm:order-none">
        {item.precoPadrao ? `R$ ${brl(item.precoPadrao)}` : '—'}
      </span>

      {podeEditar ? (
        <label className="order-2 sm:order-none">
          <span className="sr-only">Preço de {item.sku}</span>
          <input
            value={valor}
            onChange={(e) => aoDigitar(e.target.value)}
            placeholder="0,00"
            inputMode="decimal"
            className={juntar(
              'h-8 w-[110px] rounded-md border px-2 text-right font-mono text-[13px] sm:w-full',
              semPreco ? 'border-[#d3a87a] bg-white' : 'border-neutral-200 bg-neutral-25',
            )}
          />
        </label>
      ) : (
        <span className="order-2 text-right font-mono text-[13px] text-neutral-900 sm:order-none">
          {item.preco ? `R$ ${brl(item.preco)}` : '—'}
        </span>
      )}

      {mostrarCusto ? (
        <span
          className={juntar(
            'order-5 text-right font-mono text-[12.5px] font-medium sm:order-none',
            margem === null
              ? 'text-neutral-300'
              : Number(margem) < 25
                ? 'text-[var(--color-perigo)]'
                : 'text-[var(--color-sucesso)]',
          )}
        >
          {margem === null ? '—' : `${margem}%`}
        </span>
      ) : null}
    </div>
  );
}

function Pilula({
  ativa,
  aoClicar,
  children,
}: {
  readonly ativa: boolean;
  readonly aoClicar: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoClicar}
      className={juntar(
        'h-8 rounded-full border px-3 text-[12.5px] font-medium',
        ativa
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25',
      )}
    >
      {children}
    </button>
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

function Alerta() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function Relogio() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3 2" />
    </svg>
  );
}
