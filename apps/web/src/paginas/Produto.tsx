import {
  LIMITE_FOTOS_PRODUTO,
  PERM,
  type AutorizacaoDeEnvio,
  type ImagemProduto,
  type ProdutoDetalhe,
  type VariacaoDetalhe,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, enviarArquivo, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { Foto } from '../ui/Foto';
import { juntar } from '../ui/juntar';
import { PrecosDoProduto } from './PrecosDoProduto';

const TIPOS_ACEITOS = 'image/jpeg,image/png,image/webp';

export function Produto() {
  const { produtoId = '' } = useParams();
  const { pode } = useSessao();
  const fila = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);

  const [errosEnvio, setErrosEnvio] = useState<string[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [aba, setAba] = useState<
    'gerais' | 'fotos' | 'variacoes' | 'precos' | 'estoque' | 'fornecedores'
  >('fotos');

  const podeGerenciar = pode(PERM.produto.gerenciarFotos);
  const podePublicar = pode(PERM.produto.publicarCatalogo);

  const produto = useQuery({
    queryKey: ['produtos', 'um', produtoId],
    queryFn: () => pedir<ProdutoDetalhe>(`/produtos/${produtoId}`),
  });

  const imagens = useQuery({
    queryKey: ['produtos', produtoId, 'imagens'],
    queryFn: () => pedir<ImagemProduto[]>(`/produtos/${produtoId}/imagens`),
  });

  const enviar = useMutation({
    mutationFn: async (arquivo: File) => {
      // Passo 1: a API autoriza e devolve para onde enviar.
      const autorizacao = await pedir<AutorizacaoDeEnvio>(
        `/produtos/${produtoId}/imagens/autorizar`,
        { method: 'POST', body: { tipo: arquivo.type, bytes: arquivo.size } },
      );

      // Passo 2: o arquivo vai direto para o armazenamento.
      await enviarArquivo(autorizacao.envio, arquivo);

      // Passo 3: a API confere o que chegou de verdade.
      return pedir<ImagemProduto>(
        `/produtos/${produtoId}/imagens/${autorizacao.imagemId}/confirmar`,
        { method: 'POST' },
      );
    },
    onSuccess: async () => {
      // O erro NÃO é limpo aqui de propósito. Quem arrasta quatro fotos e tem
      // uma recusada precisa ver qual falhou — e as outras três terminam
      // depois, apagando o aviso se ele fosse limpo no sucesso.
      await Promise.all([
        fila.invalidateQueries({ queryKey: ['produtos', produtoId, 'imagens'] }),
        fila.invalidateQueries({ queryKey: ['produtos'] }),
      ]);
    },
    onError: (erro, arquivo) => {
      const motivo =
        erro instanceof ErroRequisicao ? erro.corpo.mensagem : 'Falha ao enviar a imagem.';
      setErrosEnvio((atuais) => [...atuais, `${arquivo.name}: ${motivo}`]);
    },
  });

  const descrever = useMutation({
    mutationFn: (v: { imagemId: string; texto: string }) =>
      pedir<ImagemProduto>(`/produtos/${produtoId}/imagens/${v.imagemId}`, {
        method: 'PATCH',
        body: { textoAlternativo: v.texto },
      }),
    onSuccess: async () => {
      await fila.invalidateQueries({ queryKey: ['produtos', produtoId, 'imagens'] });
    },
  });

  const definirCapa = useMutation({
    mutationFn: (imagemId: string) =>
      pedir<ImagemProduto>(`/produtos/${produtoId}/imagens/${imagemId}`, {
        method: 'PATCH',
        body: { principal: true },
      }),
    onSuccess: async () => {
      await Promise.all([
        fila.invalidateQueries({ queryKey: ['produtos', produtoId, 'imagens'] }),
        fila.invalidateQueries({ queryKey: ['produtos'] }),
      ]);
    },
  });

  const excluir = useMutation({
    mutationFn: (imagemId: string) =>
      pedir<void>(`/produtos/${produtoId}/imagens/${imagemId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setErrosEnvio([]);
      await Promise.all([
        fila.invalidateQueries({ queryKey: ['produtos', produtoId, 'imagens'] }),
        fila.invalidateQueries({ queryKey: ['produtos'] }),
      ]);
    },
    onError: (erro) => {
      setErrosEnvio([
        erro instanceof ErroRequisicao ? erro.corpo.mensagem : 'Falha ao remover a imagem.',
      ]);
    },
  });

  const publicar = useMutation({
    mutationFn: (valor: boolean) =>
      pedir<{ id: string }>(`/produtos/${produtoId}`, {
        method: 'PATCH',
        body: { publicadoNoCatalogo: valor },
      }),
    onSuccess: async () => {
      setErrosEnvio([]);
      await fila.invalidateQueries({ queryKey: ['produtos'] });
    },
    onError: (erro) => {
      setErrosEnvio([
        erro instanceof ErroRequisicao ? erro.corpo.mensagem : 'Falha ao alterar o catálogo.',
      ]);
    },
  });

  function receberArquivos(arquivos: FileList | null) {
    setErrosEnvio([]);
    if (!arquivos) return;

    for (const arquivo of Array.from(arquivos)) {
      enviar.mutate(arquivo);
    }
  }

  const fotos = imagens.data ?? [];
  const doProduto = fotos.filter((f) => f.variacaoId === null);
  const cheio = doProduto.length >= LIMITE_FOTOS_PRODUTO;
  /** Variações que caem na capa do produto por não terem foto própria. */
  const semFotoPropria =
    produto.data?.variacoes.filter((v) => !fotos.some((f) => f.variacaoId === v.id)).length ?? 0;

  if (produto.isPending) {
    return <EstadoCarregando titulo="Carregando produto…" />;
  }

  if (produto.isError || !produto.data) {
    return (
      <EstadoErro
        titulo="Produto não encontrado"
        descricao="O produto não existe ou pertence a outra empresa."
        aoTentarNovamente={() => void produto.refetch()}
      />
    );
  }

  const p: ProdutoDetalhe = produto.data;
  const mostrarCusto = p.valorEstoque !== undefined;

  /**
   * As seis abas do desenho.
   *
   * "Fornecedores" aparece porque o desenho a prevê e o menu já promete
   * Compras; ela diz que o módulo não existe em vez de sumir — some faz
   * parecer esquecida.
   */
  const ABAS = [
    { chave: 'gerais' as const, nome: 'Dados gerais', aviso: 0 },
    { chave: 'fotos' as const, nome: 'Fotos', aviso: 0 },
    { chave: 'variacoes' as const, nome: 'Variações', aviso: semFotoPropria },
    { chave: 'precos' as const, nome: 'Preços', aviso: 0 },
    { chave: 'estoque' as const, nome: 'Estoque', aviso: p.temSaldoNegativo ? 1 : 0 },
    { chave: 'fornecedores' as const, nome: 'Fornecedores', aviso: 0 },
  ];

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-neutral-100 bg-white px-6">
        <Link
          to="/produtos"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Produtos
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-[13.5px] font-medium text-neutral-900">{p.nome}</span>
        <div className="flex-1" />

        {podePublicar ? (
          <Botao
            variante={p.publicadoNoCatalogo ? 'secundario' : 'primario'}
            carregando={publicar.isPending}
            onClick={() => publicar.mutate(!p.publicadoNoCatalogo)}
          >
            {p.publicadoNoCatalogo ? 'Remover do catálogo' : 'Publicar no catálogo'}
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
                {p.nome}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-neutral-500">
                <span className="font-mono">{p.skuBase}</span>
                {p.marca ? <span>{p.marca.nome}</span> : null}
                {p.categoria ? <span>{p.categoria.nome}</span> : null}
                <span>
                  {p.variacoes.length} {p.variacoes.length === 1 ? 'variação' : 'variações'}
                </span>
                <span
                  className={p.temSaldoNegativo ? 'font-medium text-[var(--color-perigo)]' : ''}
                >
                  saldo {p.saldoTotal}
                </span>
                {p.valorEstoque !== undefined ? (
                  <span className="font-mono text-[12.5px]">estoque R$ {p.valorEstoque}</span>
                ) : null}
              </p>
            </div>

            <div
              className={juntar(
                'shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                p.publicadoNoCatalogo
                  ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
                  : 'bg-neutral-50 text-neutral-500',
              )}
            >
              {p.publicadoNoCatalogo ? 'No catálogo' : 'Fora do catálogo'}
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Seções do produto"
            className="flex gap-1 overflow-x-auto border-b border-neutral-100"
          >
            {ABAS.map((a) => (
              <button
                key={a.chave}
                type="button"
                role="tab"
                aria-selected={aba === a.chave}
                onClick={() => setAba(a.chave)}
                className={juntar(
                  'flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13.5px]',
                  aba === a.chave
                    ? 'border-primary-600 font-semibold text-primary-700'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900',
                )}
              >
                {a.nome}
                {a.aviso > 0 ? (
                  <span className="rounded-full bg-[var(--color-atencao-fundo)] px-1.5 text-[10.5px] font-semibold text-[var(--color-atencao)]">
                    {a.aviso}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {errosEnvio.length > 0 ? (
            <Aviso
              tom="perigo"
              titulo={
                errosEnvio.length === 1
                  ? 'Não foi possível concluir'
                  : `${errosEnvio.length} arquivos foram recusados`
              }
            >
              <ul className="flex list-disc flex-col gap-0.5 pl-4">
                {errosEnvio.map((mensagem) => (
                  <li key={mensagem}>{mensagem}</li>
                ))}
              </ul>
            </Aviso>
          ) : null}

          {aba === 'variacoes' ? (
            <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">Variações</h2>

              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-[150px_minmax(0,1fr)_130px_100px_90px_110px] gap-2.5 border-b border-neutral-100 pb-1.5">
                    {[
                      'SKU',
                      'Descrição',
                      'Cód. barras',
                      'Preço',
                      'Saldo',
                      mostrarCusto ? 'Custo méd.' : '',
                    ].map((t, i) => (
                      <span
                        key={t || `vazio-${String(i)}`}
                        className={juntar(
                          'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                          i >= 3 && 'text-right',
                        )}
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  {p.variacoes.map((v) => (
                    <LinhaVariacao key={v.id} variacao={v} mostrarCusto={mostrarCusto} />
                  ))}
                </div>
              </div>

              {/*
              Foto por variação: a variação sem foto própria usa a capa do
              produto. Para cor, isso engana — o cliente vê o branco e recebe
              o azul.
            */}
              <div className="mt-2 border-t border-neutral-100 pt-3">
                <h3 className="font-display text-[13.5px] font-semibold text-neutral-900">
                  Foto por variação
                </h3>
                <p className="mb-2 text-[12px] text-neutral-500">
                  Variação sem foto própria usa a capa do produto. Para cores, vale a pena ter a
                  foto certa.
                </p>
                <div className="flex flex-col gap-1.5">
                  {p.variacoes.map((v) => {
                    const propria = fotos.some((f) => f.variacaoId === v.id);
                    return (
                      <div
                        key={v.id}
                        className={juntar(
                          'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2',
                          propria ? 'border-primary-100 bg-primary-50' : 'border-neutral-200',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900">
                          {v.descricao}
                        </span>
                        <span
                          className={juntar(
                            'text-[11.5px] font-medium',
                            propria ? 'text-[var(--color-sucesso)]' : 'text-[var(--color-atencao)]',
                          )}
                        >
                          {propria ? 'Foto própria' : 'Usando a capa do produto'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11.5px] text-neutral-400">
                  Enviar foto por variação ainda não existe: a API aceita o vínculo, a tela de envio
                  não o oferece.
                </p>
              </div>
            </section>
          ) : null}

          {aba === 'fotos' ? (
            <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                  Fotos{' '}
                  <span className="font-sans text-[13px] font-normal text-neutral-500">
                    ({doProduto.length}/{LIMITE_FOTOS_PRODUTO})
                  </span>
                </h2>
                <p className="text-[12.5px] text-neutral-500">
                  JPEG, PNG ou WebP · mínimo 800×800 px · até 10 MB
                </p>
              </div>

              {imagens.isPending ? <EstadoCarregando titulo="Carregando fotos…" /> : null}

              {fotos.length > 0 ? (
                <div className="grid grid-cols-4 gap-3">
                  {fotos.map((foto) => (
                    <Cartao
                      key={foto.id}
                      foto={foto}
                      nomeDoProduto={p.nome}
                      podeGerenciar={podeGerenciar}
                      ocupado={definirCapa.isPending || excluir.isPending}
                      aoDefinirCapa={() => definirCapa.mutate(foto.id)}
                      aoExcluir={() => excluir.mutate(foto.id)}
                      aoDescrever={(texto) => descrever.mutate({ imagemId: foto.id, texto })}
                    />
                  ))}
                </div>
              ) : null}

              {podeGerenciar ? (
                <>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setArrastando(true);
                    }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setArrastando(false);
                      if (!cheio) receberArquivos(e.dataTransfer.files);
                    }}
                    className={juntar(
                      'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center',
                      cheio
                        ? 'border-neutral-200 bg-neutral-25'
                        : arrastando
                          ? 'border-primary-600 bg-primary-50'
                          : 'border-neutral-300 bg-neutral-25',
                    )}
                  >
                    {cheio ? (
                      <p className="text-[13px] text-neutral-500">
                        O produto já tem {LIMITE_FOTOS_PRODUTO} fotos. Remova uma para enviar outra.
                      </p>
                    ) : (
                      <>
                        <p className="text-[13.5px] text-neutral-600">
                          Arraste as fotos aqui ou{' '}
                          <button
                            type="button"
                            onClick={() => entrada.current?.click()}
                            className="font-medium text-primary-600 underline"
                          >
                            escolha do computador
                          </button>
                        </p>
                        <p className="text-[12px] text-neutral-400">
                          A primeira foto enviada vira a capa do produto
                        </p>
                      </>
                    )}

                    <input
                      ref={entrada}
                      type="file"
                      accept={TIPOS_ACEITOS}
                      multiple
                      className="hidden"
                      aria-label="Escolher fotos"
                      onChange={(e) => {
                        receberArquivos(e.target.files);
                        // Permite reenviar o mesmo arquivo depois de um erro.
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {enviar.isPending ? (
                    <p className="text-[12.5px] text-neutral-500" role="status">
                      Enviando…
                    </p>
                  ) : null}
                </>
              ) : (
                <Aviso tom="info">
                  Você pode ver as fotos, mas não alterá-las. Falta a permissão
                  <span className="font-mono"> produto.gerenciar_fotos</span>.
                </Aviso>
              )}

              {!p.publicadoNoCatalogo && doProduto.length > 0 && podePublicar ? (
                <Aviso tom="atencao">
                  Este produto tem foto mas não está no catálogo. Publique para que ele apareça para
                  os clientes.
                </Aviso>
              ) : null}

              {/* Onde estas fotos aparecem — o desenho põe isso à vista. */}
              <div className="rounded-md bg-primary-50 p-3">
                <h3 className="mb-1.5 font-display text-[13px] font-semibold text-primary-800">
                  Onde estas fotos aparecem
                </h3>
                <ul className="flex flex-col gap-1">
                  {[
                    { texto: 'Catálogo interno e portal do cliente', existe: true },
                    { texto: 'Cartão do produto no PDV', existe: true },
                    { texto: 'Item do pedido e do carrinho', existe: true },
                    { texto: 'Catálogo público para compartilhar', existe: false },
                  ].map((d) => (
                    <li key={d.texto} className="flex items-center gap-2 text-[12.5px]">
                      <span
                        className={juntar(
                          'text-[13px]',
                          d.existe ? 'text-primary-700' : 'text-neutral-400',
                        )}
                        aria-hidden="true"
                      >
                        {d.existe ? '✓' : '—'}
                      </span>
                      <span className={d.existe ? 'text-primary-800' : 'text-neutral-500'}>
                        {d.texto}
                        {d.existe ? '' : ' (ainda não existe)'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {aba === 'precos' ? <PrecosDoProduto produtoId={p.id} /> : null}

          {aba === 'gerais' ? <DadosGerais produto={p} /> : null}

          {aba === 'estoque' ? <EstoquePorLocal produto={p} mostrarCusto={mostrarCusto} /> : null}

          {aba === 'fornecedores' ? (
            <section className="flex flex-col gap-2 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                Fornecedores
              </h2>
              <Aviso tom="info" titulo="O módulo de compras ainda não foi construído">
                Fornecedor, pedido de compra e recebimento entram junto — é por ali que a mercadoria
                passa a ter custo. Hoje a entrada é lançada manualmente em Movimentações.
              </Aviso>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}

function LinhaVariacao({
  variacao,
  mostrarCusto,
}: {
  readonly variacao: VariacaoDetalhe;
  readonly mostrarCusto: boolean;
}) {
  const saldo = Number(variacao.saldo);

  return (
    <div className="border-b border-neutral-50 py-2">
      <div className="grid grid-cols-[150px_minmax(0,1fr)_130px_100px_90px_110px] items-center gap-2.5">
        <span className="font-mono text-[12.5px] text-neutral-600">{variacao.sku}</span>

        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] text-neutral-900">{variacao.descricao}</span>
          {variacao.status === 'INATIVO' ? (
            <span className="shrink-0 rounded-full bg-neutral-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-500">
              inativa
            </span>
          ) : null}
        </span>

        <span className="truncate font-mono text-[11.5px] text-neutral-400">
          {variacao.codigoBarras ?? '—'}
        </span>

        <span className="tabular text-right font-mono text-[13px] text-neutral-900">
          {variacao.precoPadrao ? `R$ ${variacao.precoPadrao}` : '—'}
        </span>

        <span
          className={juntar(
            'tabular text-right font-mono text-[13px] font-medium',
            saldo < 0
              ? 'text-[var(--color-perigo)]'
              : variacao.abaixoDoMinimo
                ? 'text-[var(--color-atencao)]'
                : 'text-neutral-900',
          )}
          title={
            variacao.abaixoDoMinimo ? `Abaixo do mínimo (${variacao.estoqueMinimo})` : undefined
          }
        >
          {variacao.saldo}
        </span>

        {mostrarCusto ? (
          <span className="tabular text-right font-mono text-[12.5px] text-neutral-500">
            {variacao.custoMedio ? `R$ ${Number(variacao.custoMedio).toFixed(2)}` : '—'}
          </span>
        ) : (
          <span />
        )}
      </div>

      {/* Onde o saldo está. Sem isto, "saldo 150" não diz em qual loja ele
          está — e transferência e contagem precisam exatamente disso. */}
      {variacao.saldosPorLocal.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[152px]">
          {variacao.saldosPorLocal.map((s) => (
            <span key={s.localId} className="text-[11.5px] text-neutral-400">
              {s.loja} · {s.local}{' '}
              <span
                className={juntar(
                  'font-mono',
                  Number(s.quantidade) < 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-600',
                )}
              >
                {s.quantidade}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 pl-[152px] text-[11.5px] text-neutral-400">Sem saldo em nenhum local</p>
      )}
    </div>
  );
}

function Cartao({
  foto,
  nomeDoProduto,
  podeGerenciar,
  ocupado,
  aoDefinirCapa,
  aoExcluir,
  aoDescrever,
}: {
  readonly foto: ImagemProduto;
  readonly nomeDoProduto: string;
  readonly podeGerenciar: boolean;
  readonly ocupado: boolean;
  readonly aoDefinirCapa: () => void;
  readonly aoExcluir: () => void;
  readonly aoDescrever: (texto: string) => void;
}) {
  const falhou = foto.status === 'FALHA';
  const [alt, setAlt] = useState(foto.textoAlternativo);

  return (
    <figure className="flex flex-col gap-1.5">
      <div
        className={juntar(
          'relative aspect-square overflow-hidden rounded-md border',
          foto.principal ? 'border-primary-600' : 'border-neutral-200',
        )}
      >
        {falhou ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 bg-[var(--color-perigo-fundo)] px-2 text-center">
            <span className="text-[11.5px] font-semibold text-[var(--color-perigo)]">
              Falhou no envio
            </span>
            <span className="text-[10.5px] text-[#8c1a21]">Remova e tente de novo</span>
          </div>
        ) : (
          <Foto
            imagemId={foto.id}
            alt={foto.textoAlternativo || nomeDoProduto}
            className="size-full"
          />
        )}

        {foto.principal ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Capa
          </span>
        ) : null}

        {foto.variacaoId ? (
          <span className="absolute right-1.5 top-1.5 rounded bg-neutral-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Variação
          </span>
        ) : null}
      </div>

      {/* Estado e ações em linhas separadas: lado a lado, "Não concluída" e
          dois botões não cabem na largura de um cartão e o texto que some é
          justamente o que explica o problema. */}
      <figcaption className="flex flex-col gap-0.5">
        <span
          className={juntar(
            'truncate text-[10.5px]',
            foto.status === 'PRONTA'
              ? 'font-mono text-neutral-400'
              : 'font-medium text-[var(--color-atencao)]',
          )}
        >
          {/* Sem dimensão não é "—": é uma foto que não terminou o envio, e
              dizer isso evita que o operador fique esperando por nada. */}
          {foto.status === 'PRONTA'
            ? `${String(foto.largura)}×${String(foto.altura)}`
            : foto.status === 'PROCESSANDO'
              ? 'Não concluída'
              : 'Falhou'}
        </span>

        {podeGerenciar ? (
          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 whitespace-nowrap">
            {!foto.principal && foto.status === 'PRONTA' && !foto.variacaoId ? (
              <button
                type="button"
                onClick={aoDefinirCapa}
                disabled={ocupado}
                className="text-[11px] font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 disabled:opacity-50"
              >
                Definir capa
              </button>
            ) : null}
            <button
              type="button"
              onClick={aoExcluir}
              disabled={ocupado}
              className="text-[11px] font-medium text-[var(--color-perigo)] underline decoration-[#f0c9cb] underline-offset-2 disabled:opacity-50"
            >
              Remover
            </button>
          </span>
        ) : null}

        {/*
          Texto alternativo: a API sempre aceitou e a tela não oferecia. É o
          que um leitor de tela lê, e o que aparece quando a imagem não
          carrega — o cliente que não enxerga a foto depende só disto.
        */}
        {podeGerenciar && foto.status === 'PRONTA' ? (
          <label className="mt-0.5 flex flex-col gap-0.5">
            <span className="sr-only">Texto alternativo da foto</span>
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              onBlur={() => {
                if (alt !== foto.textoAlternativo) aoDescrever(alt);
              }}
              maxLength={255}
              placeholder="Descreva a foto"
              className="h-7 rounded border border-neutral-200 px-1.5 text-[11px]"
            />
          </label>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Dados gerais: o que identifica o produto.
 *
 * Somente leitura por enquanto. A API tem `PATCH /produtos/:id` para nome,
 * descrição, categoria, marca e status — a edição em formulário é fatia
 * própria, e mostrar campos que não salvam seria pior do que mostrá-los
 * como o que são.
 */
function DadosGerais({ produto }: { readonly produto: ProdutoDetalhe }) {
  const linhas = [
    { rotulo: 'Nome', valor: produto.nome },
    { rotulo: 'SKU base', valor: produto.skuBase, mono: true },
    { rotulo: 'Categoria', valor: produto.categoria?.nome ?? '—' },
    { rotulo: 'Marca', valor: produto.marca?.nome ?? '—' },
    { rotulo: 'Unidade', valor: produto.unidade },
    { rotulo: 'Status', valor: produto.status },
    {
      rotulo: 'Catálogo',
      valor: produto.publicadoNoCatalogo ? 'Publicado' : 'Fora do catálogo',
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
      <h2 className="font-display text-[15px] font-semibold text-neutral-900">Dados gerais</h2>

      <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {linhas.map((l) => (
          <div key={l.rotulo}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              {l.rotulo}
            </dt>
            <dd
              className={juntar(
                'text-[13.5px] text-neutral-900',
                l.mono === true && 'font-mono text-[13px]',
              )}
            >
              {l.valor}
            </dd>
          </div>
        ))}
      </dl>

      {produto.descricao ? (
        <div className="border-t border-neutral-100 pt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Descrição
          </p>
          <p className="whitespace-pre-line text-[13px] leading-[19px] text-neutral-700">
            {produto.descricao}
          </p>
        </div>
      ) : null}

      <p className="text-[11.5px] text-neutral-400">
        Editar estes campos em formulário ainda não existe nesta tela; a API já aceita a alteração.
      </p>
    </section>
  );
}

/**
 * Onde o saldo está.
 *
 * O total esconde a distribuição: dez peças com quatro numa loja e seis em
 * outra não é o mesmo que dez num lugar só, e quem vai transferir precisa
 * ver por local.
 */
function EstoquePorLocal({
  produto,
  mostrarCusto,
}: {
  readonly produto: ProdutoDetalhe;
  readonly mostrarCusto: boolean;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">
          Estoque por local
        </h2>
        <span
          className={juntar(
            'font-mono text-[13px]',
            produto.temSaldoNegativo
              ? 'font-semibold text-[var(--color-perigo)]'
              : 'text-neutral-600',
          )}
        >
          saldo total {produto.saldoTotal}
        </span>
      </div>

      {produto.variacoes.map((v) => (
        <div key={v.id} className="border-t border-neutral-50 pt-2.5 first:border-0 first:pt-0">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13px] text-neutral-900">{v.descricao}</span>
            <span className="font-mono text-[11px] text-neutral-400">{v.sku}</span>
            {v.abaixoDoMinimo ? (
              <span className="rounded bg-[var(--color-atencao-fundo)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-atencao)]">
                abaixo do mínimo ({v.estoqueMinimo})
              </span>
            ) : null}
          </p>

          {v.saldosPorLocal.length === 0 ? (
            <p className="text-[12px] text-neutral-400">Sem saldo em local nenhum.</p>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              {v.saldosPorLocal.map((s) => (
                <div key={s.localId} className="flex flex-wrap items-center gap-x-3 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-neutral-600">
                    {s.loja} · {s.local}
                  </span>
                  {mostrarCusto && s.custoMedio ? (
                    <span className="font-mono text-[11.5px] text-neutral-400">
                      custo R$ {Number(s.custoMedio).toFixed(2)}
                    </span>
                  ) : null}
                  <span
                    className={juntar(
                      'w-16 text-right font-mono font-medium',
                      Number(s.quantidade) < 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
                    )}
                  >
                    {s.quantidade}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
