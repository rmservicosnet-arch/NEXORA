import { PERM, type PaginaProdutos, type ProdutoLista } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { SePode, useSessao } from '../auth/sessao';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { Foto } from '../ui/Foto';
import { juntar } from '../ui/juntar';

/** Largura em que todas as colunas ainda cabem sem se sobrepor. */
const LARGURA_MINIMA = 'min-w-[900px]';

const STATUS = [
  { valor: undefined, rotulo: 'Todos' },
  { valor: 'ATIVO' as const, rotulo: 'Ativos' },
  { valor: 'RASCUNHO' as const, rotulo: 'Rascunhos' },
  { valor: 'INATIVO' as const, rotulo: 'Inativos' },
];

export function Produtos() {
  const { pode } = useSessao();
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [soDivergencia, setSoDivergencia] = useState(false);

  const parametros = new URLSearchParams();
  if (busca.trim()) parametros.set('busca', busca.trim());
  if (status) parametros.set('status', status);
  if (soDivergencia) parametros.set('apenasDivergencia', 'true');

  const consulta = useQuery({
    queryKey: ['produtos', busca, status, soDivergencia],
    queryFn: () => pedir<PaginaProdutos>(`/produtos?${parametros.toString()}`),
    placeholderData: keepPreviousData,
  });

  const itens = consulta.data?.itens ?? [];

  // A coluna de custo existe porque o SERVIDOR mandou o campo. O front não
  // decide isso — ele reage. Quem não tem `produto.ver_custo` recebe um JSON
  // sem a chave, e não há o que esconder.
  const mostrarCusto = itens.some((i) => i.valorEstoque !== undefined);

  const colunas = mostrarCusto
    ? 'grid-cols-[40px_128px_minmax(0,1fr)_120px_60px_108px_104px_84px_92px]'
    : 'grid-cols-[40px_128px_minmax(0,1fr)_120px_60px_104px_84px_92px]';

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Produtos</span>
        <div className="flex-1" />
        {mostrarCusto ? (
          <span className="flex items-center gap-1.5 rounded-full bg-neutral-50 px-2.5 py-1 text-[11.5px] font-semibold text-neutral-600">
            <Cadeado />
            Contém custo
          </span>
        ) : null}
        <SePode permissoes={[PERM.produto.criar]}>
          <Botao variante="primario" comoFilho>
            <Link to="/produtos/novo">Novo produto</Link>
          </Botao>
        </SePode>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">Produtos</h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            {consulta.data
              ? `${consulta.data.total} produtos no filtro atual`
              : 'Carregando…'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, SKU ou código de barras"
            aria-label="Buscar produto"
            className="h-[35px] w-[280px] rounded-md border border-neutral-200 bg-white px-3 text-[13px] placeholder:text-neutral-400"
          />

          <div role="group" aria-label="Status" className="flex gap-1.5">
            {STATUS.map((s) => (
              <button
                key={s.rotulo}
                type="button"
                aria-pressed={status === s.valor}
                onClick={() => setStatus(s.valor)}
                className={juntar(
                  'h-[35px] rounded-full border px-3 text-[12.5px] font-medium',
                  status === s.valor
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-neutral-200 bg-white text-neutral-700',
                )}
              >
                {s.rotulo}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <label className="flex h-[35px] cursor-pointer items-center gap-2 rounded-md border border-[#f0c9cb] bg-[--color-perigo-fundo] px-3 text-[12.5px] font-medium text-[--color-perigo]">
            <input
              type="checkbox"
              checked={soDivergencia}
              onChange={(e) => setSoDivergencia(e.target.checked)}
              className="size-3.5 accent-[--color-perigo]"
            />
            Só divergências de saldo
          </label>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {consulta.isPending ? <EstadoCarregando titulo="Carregando produtos…" /> : null}

          {consulta.isError ? (
            <EstadoErro
              titulo="Não foi possível carregar os produtos"
              descricao={
                consulta.error instanceof ErroRequisicao
                  ? consulta.error.corpo.mensagem
                  : 'Verifique se a API está no ar.'
              }
              aoTentarNovamente={() => void consulta.refetch()}
            />
          ) : null}

          {consulta.isSuccess && itens.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum produto encontrado"
              descricao={
                busca || status || soDivergencia
                  ? 'Nenhum produto corresponde aos filtros aplicados.'
                  : 'Cadastre o primeiro produto para começar.'
              }
              acao={
                pode(PERM.produto.criar) ? (
                  <Botao variante="primario" comoFilho>
                    <Link to="/produtos/novo">Novo produto</Link>
                  </Botao>
                ) : null
              }
            />
          ) : null}

          {itens.length > 0 ? (
            // Abaixo da largura mínima a tabela ROLA, não se comprime: colunas
            // numéricas espremidas passam a se sobrepor, e saldo lido por cima
            // de preço é pior do que uma barra de rolagem.
            <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
              <div
                className={juntar(
                  'grid h-9 shrink-0 items-center gap-2.5 border-b border-neutral-100 bg-neutral-25 px-4',
                  LARGURA_MINIMA,
                  colunas,
                )}
              >
                <Cabecalho>Foto</Cabecalho>
                <Cabecalho>SKU base</Cabecalho>
                <Cabecalho>Produto</Cabecalho>
                <Cabecalho>Categoria</Cabecalho>
                <Cabecalho centro>Var.</Cabecalho>
                {mostrarCusto ? <Cabecalho direita>Custo méd.</Cabecalho> : null}
                <Cabecalho direita>Preço</Cabecalho>
                <Cabecalho direita>Saldo</Cabecalho>
                <Cabecalho>Status</Cabecalho>
              </div>

              <div className={juntar('min-h-0 flex-1 overflow-y-auto', LARGURA_MINIMA)}>
                {itens.map((p) => (
                  <Linha key={p.id} produto={p} colunas={colunas} mostrarCusto={mostrarCusto} />
                ))}
              </div>

              <div
                className={juntar(
                  'flex h-12 shrink-0 items-center justify-between border-t border-neutral-100 bg-neutral-25 px-4 text-[13px] text-neutral-500',
                  LARGURA_MINIMA,
                )}
              >
                <span>
                  Exibindo <strong className="font-semibold text-neutral-900">{itens.length}</strong>{' '}
                  de <strong className="font-semibold text-neutral-900">{consulta.data?.total}</strong>
                </span>
                {consulta.data?.proximoCursor ? (
                  <span className="text-[12.5px]">Há mais páginas — paginação por cursor</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}

function Cabecalho({
  children,
  direita,
  centro,
}: {
  readonly children: string;
  readonly direita?: boolean;
  readonly centro?: boolean;
}) {
  return (
    <span
      className={juntar(
        'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
        direita && 'text-right',
        centro && 'text-center',
      )}
    >
      {children}
    </span>
  );
}

function Linha({
  produto,
  colunas,
  mostrarCusto,
}: {
  readonly produto: ProdutoLista;
  readonly colunas: string;
  readonly mostrarCusto: boolean;
}) {
  const saldo = Number(produto.saldoTotal);
  const semFoto = produto.totalFotos === 0;

  return (
    <Link
      to={`/produtos/${produto.id}`}
      className={juntar(
        'grid h-[45px] items-center gap-2.5 border-b border-neutral-50 px-4 no-underline hover:bg-neutral-25',
        produto.temSaldoNegativo && 'bg-[#fdf5f5] hover:bg-[#fbeeee]',
        colunas,
      )}
    >
      <div
        className={juntar(
          'flex size-9 items-center justify-center overflow-hidden rounded',
          semFoto ? 'border border-dashed border-[#d3a87a] bg-white' : 'bg-primary-50',
        )}
        title={semFoto ? 'Sem foto' : `${produto.totalFotos} foto(s)`}
      >
        {produto.imagemPrincipalId ? (
          <Foto imagemId={produto.imagemPrincipalId} alt={produto.nome} className="size-full" />
        ) : semFoto ? (
          <IconeSemFoto />
        ) : (
          <IconeCaixa />
        )}
      </div>

      <span className="font-mono text-[12.5px] text-neutral-600">{produto.skuBase}</span>

      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-neutral-900">{produto.nome}</p>
        {produto.marca ? (
          <p className="truncate text-[11.5px] text-neutral-400">{produto.marca}</p>
        ) : null}
      </div>

      <span className="truncate text-[13px] text-neutral-600">{produto.categoria ?? '—'}</span>
      <span className="tabular text-center font-mono text-[12.5px] text-neutral-600">
        {produto.totalVariacoes}
      </span>

      {mostrarCusto ? (
        <span className="tabular text-right font-mono text-[12.5px] text-neutral-500">
          {produto.custoMedio ? `R$ ${Number(produto.custoMedio).toFixed(2)}` : '—'}
        </span>
      ) : null}

      <span className="tabular text-right font-mono text-[13px] font-medium text-neutral-900">
        {produto.precoMinimo ? `R$ ${produto.precoMinimo}` : '—'}
      </span>

      <span
        className={juntar(
          'tabular text-right font-mono text-[13px] font-medium',
          saldo < 0 ? 'text-[--color-perigo]' : 'text-neutral-900',
        )}
      >
        {saldo < 0 ? `−${Math.abs(saldo)}` : saldo}
      </span>

      <Selo status={produto.status} />
    </Link>
  );
}

function Selo({ status }: { readonly status: ProdutoLista['status'] }) {
  const mapa = {
    ATIVO: { texto: 'Ativo', cor: 'text-[--color-sucesso] bg-[--color-sucesso-fundo]' },
    RASCUNHO: { texto: 'Rascunho', cor: 'text-[--color-atencao] bg-[--color-atencao-fundo]' },
    INATIVO: { texto: 'Inativo', cor: 'text-neutral-500 bg-neutral-50' },
  } as const;

  const { texto, cor } = mapa[status];

  return (
    <span
      className={juntar(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
        cor,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {texto}
    </span>
  );
}

function IconeCaixa() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-primary-500)"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

function IconeSemFoto() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent-600)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8h3l1.5-2h9L18 8h3v11H3z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
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
