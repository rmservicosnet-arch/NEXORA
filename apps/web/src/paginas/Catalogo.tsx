import {
  PERM,
  type ApoioProduto,
  type PaginaProdutos,
  type ProdutoLista,
  type TabelaPreco,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { Foto } from '../ui/Foto';
import { juntar } from '../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

export function Catalogo() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [tabelaId, setTabelaId] = useState<string | null>(null);
  const [soSemFoto, setSoSemFoto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podePublicar = pode(PERM.produto.publicarCatalogo);

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const apoio = useQuery({
    queryKey: ['produtos', 'apoio'],
    queryFn: () => pedir<ApoioProduto>('/produtos/apoio'),
  });

  const tabelas = useQuery({
    queryKey: ['tabelas-preco'],
    queryFn: () => pedir<TabelaPreco[]>('/tabelas-preco'),
    enabled: pode(PERM.preco.visualizar),
  });

  const consulta = useQuery({
    queryKey: ['produtos', 'catalogo', busca, categoriaId, tabelaId, soSemFoto],
    queryFn: () =>
      pedir<PaginaProdutos>(
        `/produtos?status=ATIVO&limite=60` +
          (busca ? `&busca=${encodeURIComponent(busca)}` : '') +
          (categoriaId ? `&categoriaId=${categoriaId}` : '') +
          (tabelaId ? `&tabelaPrecoId=${tabelaId}` : '') +
          (soSemFoto ? '&semFoto=true' : ''),
      ),
  });

  /** Quantos estão travados por falta de foto — o número que pede ação. */
  const bloqueados = useQuery({
    queryKey: ['produtos', 'catalogo', 'bloqueados'],
    queryFn: () => pedir<PaginaProdutos>('/produtos?status=ATIVO&semFoto=true&limite=1'),
  });

  const publicar = useMutation({
    mutationFn: (p: { id: string; publicar: boolean }) =>
      pedir<{ id: string }>(`/produtos/${p.id}`, {
        method: 'PATCH',
        body: { publicadoNoCatalogo: p.publicar },
      }),
    onSuccess: async () => {
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['produtos'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  const itens = consulta.data?.itens ?? [];
  const publicados = itens.filter((p) => p.publicadoNoCatalogo).length;
  const travados = bloqueados.data?.total ?? 0;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <input
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar no catálogo…"
          aria-label="Buscar no catálogo"
          className="h-[34px] w-full max-w-[320px] rounded-md border border-neutral-200 bg-white px-3 text-[13px]"
        />

        <div className="hidden flex-1 sm:block" />

        {/*
          Pré-visualizar por tabela: o catálogo do Professor não é o do
          Revendedor, e item sem preço na tabela dele não aparece para ele.
        */}
        {tabelas.data && tabelas.data.length > 0 ? (
          <label className="flex items-center gap-2">
            <span className="text-[12.5px] text-neutral-500">Tabela</span>
            <select
              value={tabelaId ?? ''}
              onChange={(e) => setTabelaId(e.target.value || null)}
              className="h-[34px] rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
            >
              <option value="">Padrão</option>
              {tabelas.data
                .filter((t) => t.status === 'ATIVO' && !t.padrao)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold text-neutral-900">Catálogo</h1>
            <p className="text-[13.5px] text-neutral-500">
              {publicados} {publicados === 1 ? 'produto publicado' : 'produtos publicados'}
              {travados > 0 ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setSoSemFoto(true)}
                    className="font-medium text-[var(--color-atencao)] underline decoration-[var(--color-atencao)]/40 underline-offset-2"
                  >
                    {travados} {travados === 1 ? 'bloqueado' : 'bloqueados'} por falta de foto
                  </button>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {/*
          A proposta tem aqui a faixa do catálogo público: endereço,
          "Copiar link", "Enviar por WhatsApp". Nada disso existe — não há
          rota pública, nem endereço, nem compartilhamento. Mostrar um link
          falso seria pior do que dizer que ele não existe.
        */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-neutral-200 bg-neutral-25 px-3.5 py-2.5">
          <span className="text-[12.5px] text-neutral-500">
            <strong className="font-medium text-neutral-700">Catálogo público</strong> — endereço
            para compartilhar com o cliente — ainda não existe. Hoje o cliente vê o catálogo
            entrando no portal com o acesso dele.
          </span>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
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
              'flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12.5px]',
              soSemFoto
                ? 'border-[var(--color-atencao)] bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]'
                : 'border-neutral-200 bg-white text-neutral-600',
            )}
          >
            <input
              type="checkbox"
              checked={soSemFoto}
              onChange={(e) => setSoSemFoto(e.target.checked)}
              className="size-3.5"
            />
            Só produtos sem foto
          </label>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Carregando catálogo…" /> : null}

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

        {consulta.isSuccess && itens.length === 0 ? (
          <EstadoVazio
            titulo={soSemFoto ? 'Nenhum produto sem foto' : 'Nada encontrado'}
            descricao={
              soSemFoto
                ? 'Todos os produtos ativos têm foto — nenhum está travado por isso.'
                : 'Ajuste a busca ou a categoria.'
            }
          />
        ) : null}

        {itens.length > 0 ? (
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {itens.map((p) => (
              <Cartao
                key={p.id}
                produto={p}
                podePublicar={podePublicar}
                ocupado={publicar.isPending}
                aoPublicar={(v) => publicar.mutate({ id: p.id, publicar: v })}
              />
            ))}
          </div>
        ) : null}
      </main>
    </>
  );
}

function Pilula({
  ativa,
  aoClicar,
  children,
}: {
  readonly ativa: boolean;
  readonly aoClicar: () => void;
  readonly children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoClicar}
      className={juntar(
        'h-8 rounded-md border px-3 text-[12.5px]',
        ativa
          ? 'border-primary-600 bg-primary-600 font-medium text-white'
          : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
      )}
    >
      {children}
    </button>
  );
}

function Cartao({
  produto,
  podePublicar,
  ocupado,
  aoPublicar,
}: {
  readonly produto: ProdutoLista;
  readonly podePublicar: boolean;
  readonly ocupado: boolean;
  readonly aoPublicar: (v: boolean) => void;
}) {
  const semFoto = produto.totalFotos === 0;
  const semPreco = produto.precoMinimo === null;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
      <div className="relative flex h-[172px] items-center justify-center bg-primary-50">
        {produto.imagemPrincipalId ? (
          <Foto imagemId={produto.imagemPrincipalId} alt={produto.nome} className="size-full" />
        ) : (
          <Link
            to={`/produtos/${produto.id}`}
            className="flex h-[30px] items-center gap-1.5 rounded-md border border-[var(--color-atencao)] bg-white px-3 text-[12px] font-medium text-[var(--color-atencao)] no-underline"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 6v12" />
              <path d="M6 12h12" />
            </svg>
            Adicionar foto
          </Link>
        )}

        {/*
          O selo diz o estado no catálogo. "Bloqueado" é diferente de "não
          publicado": um é escolha, o outro é impedimento — e só o segundo
          tem o que resolver.
        */}
        <span
          className={juntar(
            'absolute left-2 top-2 rounded px-2 py-0.5 text-[10.5px] font-semibold',
            semFoto
              ? 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]'
              : produto.publicadoNoCatalogo
                ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
                : 'bg-neutral-100 text-neutral-600',
          )}
        >
          {semFoto ? 'bloqueado' : produto.publicadoNoCatalogo ? 'publicado' : 'fora do catálogo'}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="line-clamp-2 text-[13.5px] font-medium leading-[18px] text-neutral-900">
          {produto.nome}
        </p>
        <p className="font-mono text-[10.5px] text-neutral-400">
          {produto.skuBase} · {produto.totalVariacoes}{' '}
          {produto.totalVariacoes === 1 ? 'variação' : 'variações'}
        </p>

        <div className="mt-auto flex items-baseline gap-1.5 pt-2">
          {semPreco ? (
            // Sem preço na tabela escolhida o item não aparece para quem
            // compra por ela. É invisível, não é "a combinar".
            <span className="text-[11.5px] font-medium text-[var(--color-atencao)]">
              sem preço nesta tabela
            </span>
          ) : (
            <>
              <span className="text-[11px] text-neutral-500">a partir de</span>
              <span className="font-mono text-[16px] font-medium text-neutral-900">
                R$ {brl(produto.precoMinimo ?? 0)}
              </span>
            </>
          )}
        </div>

        {podePublicar && !semFoto ? (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => aoPublicar(!produto.publicadoNoCatalogo)}
            className={juntar(
              'mt-2 h-8 rounded-md border text-[12px] font-medium disabled:opacity-60',
              produto.publicadoNoCatalogo
                ? 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                : 'border-primary-600 bg-primary-600 text-white',
            )}
          >
            {produto.publicadoNoCatalogo ? 'Tirar do catálogo' : 'Publicar'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
