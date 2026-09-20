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

  /**
   * Texto alternativo em edição, por foto.
   *
   * Fica aqui, e não dentro do cartão, porque o cabeçalho precisa saber se
   * há algo por salvar. Gravar no `blur`, como era antes, deixaria
   * "Cancelar" e "Salvar produto" sem função nenhuma.
   */
  const [alts, setAlts] = useState<Record<string, string>>({});

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

  /** O que foi digitado e ainda não foi gravado. */
  const pendentes = fotos.filter(
    (f) => alts[f.id] !== undefined && alts[f.id] !== f.textoAlternativo,
  );

  async function salvar() {
    await Promise.all(
      pendentes.map((f) => descrever.mutateAsync({ imagemId: f.id, texto: alts[f.id] ?? '' })),
    );
    setAlts({});
  }

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
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <Link
          to="/produtos"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Produtos
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-[13.5px] font-medium text-neutral-900">{p.nome}</span>
        <div className="flex-1" />

        {pendentes.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-atencao-fundo)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-atencao)]">
            <Relogio />
            {pendentes.length === 1
              ? 'Alteração não salva'
              : `${String(pendentes.length)} alterações não salvas`}
          </span>
        ) : null}

        {podeGerenciar ? (
          <>
            <Botao
              variante="secundario"
              disabled={pendentes.length === 0}
              onClick={() => setAlts({})}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={descrever.isPending}
              disabled={pendentes.length === 0}
              onClick={() => void salvar()}
            >
              Salvar produto
            </Botao>
          </>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              {p.nome}
            </h1>
            <span className="rounded bg-neutral-50 px-2 py-0.5 font-mono text-[12.5px] text-neutral-500">
              {p.skuBase}
            </span>
            <span
              className={juntar(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                p.status === 'ATIVO'
                  ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
                  : 'bg-neutral-50 text-neutral-500',
              )}
            >
              <span
                className={juntar(
                  'size-1.5 rounded-full',
                  p.status === 'ATIVO' ? 'bg-[var(--color-sucesso)]' : 'bg-neutral-400',
                )}
              />
              {p.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
            </span>

            <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-neutral-500">
              <span>
                · {p.variacoes.length} {p.variacoes.length === 1 ? 'variação' : 'variações'} ·
              </span>
              {/*
                O desenho mostra "publicado no catálogo" como texto. Aqui é o
                próprio controle: a ação existia só no cabeçalho, e o
                cabeçalho agora é do formulário.
              */}
              {podePublicar ? (
                <button
                  type="button"
                  onClick={() => publicar.mutate(!p.publicadoNoCatalogo)}
                  disabled={publicar.isPending}
                  className="font-medium text-primary-600 underline decoration-primary-200 underline-offset-2 hover:text-primary-700 disabled:opacity-60"
                >
                  {p.publicadoNoCatalogo ? 'publicado no catálogo' : 'fora do catálogo'}
                </button>
              ) : (
                <span>{p.publicadoNoCatalogo ? 'publicado no catálogo' : 'fora do catálogo'}</span>
              )}
              <span>
                · saldo{' '}
                <span
                  className={p.temSaldoNegativo ? 'font-medium text-[var(--color-perigo)]' : ''}
                >
                  {p.saldoTotal}
                </span>
              </span>
              {p.valorEstoque !== undefined ? (
                <span className="font-mono text-[12.5px]">· estoque R$ {p.valorEstoque}</span>
              ) : null}
            </span>
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
            </section>
          ) : null}

          {aba === 'fotos' ? (
            <div className="flex flex-col gap-4 xl:flex-row">
              <section className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
                {/*
                  A área de envio abre a aba, como no desenho: quem entra aqui
                  quase sempre vem acrescentar foto, não olhar as que já tem.
                */}
                {podeGerenciar ? (
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
                      'flex shrink-0 flex-wrap items-center justify-center gap-4 rounded-lg border-2 border-dashed px-4 py-4',
                      cheio
                        ? 'border-neutral-200 bg-neutral-25'
                        : arrastando
                          ? 'border-primary-600 bg-primary-50'
                          : 'border-neutral-300 bg-neutral-25',
                    )}
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                      <SetaParaCima />
                    </span>

                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-neutral-900">
                        {cheio
                          ? `O produto já tem ${String(LIMITE_FOTOS_PRODUTO)} fotos`
                          : 'Arraste as fotos aqui'}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-neutral-500">
                        {cheio
                          ? 'Remova uma para enviar outra.'
                          : 'JPEG, PNG ou WebP · até 10 MB · mínimo 800 × 800 px · proporção 1:1 recomendada'}
                      </p>
                    </div>

                    <Botao
                      variante="primario"
                      disabled={cheio}
                      onClick={() => entrada.current?.click()}
                    >
                      Selecionar arquivos
                    </Botao>

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
                ) : (
                  <Aviso tom="info">
                    Você pode ver as fotos, mas não alterá-las. Falta a permissão
                    <span className="font-mono"> produto.gerenciar_fotos</span>.
                  </Aviso>
                )}

                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                    Fotos do produto{' '}
                    <span className="font-mono text-[13px] font-normal text-neutral-500">
                      ({doProduto.length} de {LIMITE_FOTOS_PRODUTO})
                    </span>
                  </h2>
                  {/*
                    O desenho diz "arraste para reordenar". Reordenar não
                    existe: a ordem é a de envio, e só a capa se escolhe.
                  */}
                  <p className="text-[12.5px] text-neutral-500">A primeira é a capa do catálogo</p>
                </div>

                {imagens.isPending ? <EstadoCarregando titulo="Carregando fotos…" /> : null}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {fotos.map((foto) => (
                    <Cartao
                      key={foto.id}
                      foto={foto}
                      nomeDoProduto={p.nome}
                      podeGerenciar={podeGerenciar}
                      ocupado={definirCapa.isPending || excluir.isPending}
                      alt={alts[foto.id] ?? foto.textoAlternativo}
                      aoDigitar={(texto) => {
                        setAlts((atuais) => ({ ...atuais, [foto.id]: texto }));
                      }}
                      aoDefinirCapa={() => definirCapa.mutate(foto.id)}
                      aoExcluir={() => excluir.mutate(foto.id)}
                    />
                  ))}

                  {podeGerenciar && !cheio ? (
                    <button
                      type="button"
                      onClick={() => entrada.current?.click()}
                      className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-200 bg-neutral-25 hover:border-primary-600"
                    >
                      <span className="flex size-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600">
                        <Mais />
                      </span>
                      <span className="text-[12.5px] font-medium text-neutral-600">
                        Adicionar foto
                      </span>
                      <span className="font-mono text-[10.5px] text-neutral-400">
                        restam {LIMITE_FOTOS_PRODUTO - doProduto.length}
                      </span>
                    </button>
                  ) : null}
                </div>

                {enviar.isPending ? (
                  <p className="text-[12.5px] text-neutral-500" role="status">
                    Enviando…
                  </p>
                ) : null}

                {!p.publicadoNoCatalogo && doProduto.length > 0 && podePublicar ? (
                  <Aviso tom="atencao">
                    Este produto tem foto mas não está no catálogo. Publique para que ele apareça
                    para os clientes.
                  </Aviso>
                ) : null}
              </section>

              <div className="flex w-full shrink-0 flex-col gap-3.5 xl:w-[380px]">
                {/*
                  Foto por variação: a variação sem foto própria usa a capa do
                  produto. Para cor, isso engana — o cliente vê o branco e
                  recebe o azul.
                */}
                <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
                  <div className="border-b border-neutral-100 p-4">
                    <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                      Foto por variação
                    </h2>
                    <p className="mt-1 text-[12.5px] leading-[18px] text-neutral-500">
                      Variação sem foto própria usa a capa do produto. Para cores, vale a pena ter a
                      foto certa.
                    </p>
                  </div>

                  <div className="flex flex-col">
                    {p.variacoes.map((v) => {
                      const propria = fotos.some((f) => f.variacaoId === v.id);
                      return (
                        <div
                          key={v.id}
                          className="flex items-center gap-3 border-b border-neutral-50 px-4 py-2.5 last:border-0"
                        >
                          <span
                            className={juntar(
                              'flex size-[34px] shrink-0 items-center justify-center rounded-md border',
                              propria
                                ? 'border-primary-100 bg-primary-50 text-primary-600'
                                : 'border-[var(--color-atencao)] bg-white text-[var(--color-atencao)]',
                            )}
                          >
                            <Cubo />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-neutral-900">
                              {v.descricao}
                            </p>
                            <p
                              className={juntar(
                                'text-[11.5px]',
                                propria
                                  ? 'text-[var(--color-sucesso)]'
                                  : 'text-[var(--color-atencao)]',
                              )}
                            >
                              {propria ? 'Foto própria' : 'Usando a capa do produto'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="border-t border-neutral-50 px-4 py-2.5 text-[11.5px] text-neutral-400">
                    Enviar foto por variação ainda não existe nesta tela: a API aceita o vínculo, o
                    envio ainda não o oferece.
                  </p>
                </section>

                <section className="rounded-md border border-primary-100 bg-primary-50 p-4">
                  <h2 className="font-display text-[14px] font-semibold text-primary-800">
                    Onde estas fotos aparecem
                  </h2>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {[
                      { texto: 'Catálogo interno e portal do cliente', existe: true },
                      { texto: 'Cartão do produto no PDV', existe: true },
                      { texto: 'Item do pedido e do carrinho', existe: true },
                      { texto: 'Catálogo público para compartilhar', existe: false },
                    ].map((d) => (
                      <li key={d.texto} className="flex items-center gap-2 text-[12.5px]">
                        <span
                          className={d.existe ? 'text-primary-600' : 'text-neutral-400'}
                          aria-hidden="true"
                        >
                          {d.existe ? <Certo /> : <Tracinho />}
                        </span>
                        <span className={d.existe ? 'text-primary-800' : 'text-neutral-500'}>
                          {d.texto}
                          {d.existe ? '' : ' (ainda não existe)'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
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

/**
 * O cartão de uma foto.
 *
 * A miniatura carrega as ações que só fazem sentido sobre ela — virar capa e
 * remover — e o texto alternativo fica embaixo, rotulado. Ele não salva
 * sozinho: quem manda salvar é o cabeçalho da página.
 */
function Cartao({
  foto,
  nomeDoProduto,
  podeGerenciar,
  ocupado,
  alt,
  aoDigitar,
  aoDefinirCapa,
  aoExcluir,
}: {
  readonly foto: ImagemProduto;
  readonly nomeDoProduto: string;
  readonly podeGerenciar: boolean;
  readonly ocupado: boolean;
  readonly alt: string;
  readonly aoDigitar: (texto: string) => void;
  readonly aoDefinirCapa: () => void;
  readonly aoExcluir: () => void;
}) {
  const falhou = foto.status === 'FALHA';
  const processando = foto.status === 'PROCESSANDO';
  const nome = foto.textoAlternativo || nomeDoProduto;

  return (
    <figure
      className={juntar(
        'flex flex-col overflow-hidden rounded-md border bg-white',
        foto.principal ? 'border-primary-600' : 'border-neutral-200',
      )}
    >
      <div className="relative h-[146px] shrink-0 bg-neutral-50">
        {falhou ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 bg-[var(--color-perigo-fundo)] px-2 text-center">
            <span className="text-[11.5px] font-semibold text-[var(--color-perigo)]">
              Falhou no envio
            </span>
            <span className="text-[10.5px] text-[#8c1a21]">Remova e tente de novo</span>
          </div>
        ) : (
          <Foto imagemId={foto.id} alt={nome} className="size-full" />
        )}

        {foto.principal ? (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-primary-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">
            <Estrela cheia />
            Capa
          </span>
        ) : processando ? (
          /* Sem dimensão não é "—": é uma foto que não terminou o envio, e
             dizer isso evita que o operador fique esperando por nada. */
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-[var(--color-atencao-fundo)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-atencao)]">
            Processando
          </span>
        ) : null}

        {foto.variacaoId ? (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-neutral-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Variação
          </span>
        ) : null}

        {podeGerenciar ? (
          <span className="absolute right-1.5 top-1.5 flex gap-1">
            {!foto.principal && foto.status === 'PRONTA' && !foto.variacaoId ? (
              <button
                type="button"
                onClick={aoDefinirCapa}
                disabled={ocupado}
                title={`Definir ${nome} como capa`}
                aria-label={`Definir ${nome} como capa`}
                className="flex size-[26px] items-center justify-center rounded border border-neutral-200 bg-white/90 text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
              >
                <Estrela />
              </button>
            ) : null}

            <button
              type="button"
              onClick={aoExcluir}
              disabled={ocupado}
              title={`Remover ${nome}`}
              aria-label={`Remover ${nome}`}
              className="flex size-[26px] items-center justify-center rounded border border-neutral-200 bg-white/90 text-[var(--color-perigo)] disabled:opacity-50"
            >
              <Lixeira />
            </button>
          </span>
        ) : null}
      </div>

      {/*
        Texto alternativo: é o que um leitor de tela lê, e o que aparece
        quando a imagem não carrega — o cliente que não enxerga a foto
        depende só disto.
      */}
      <figcaption className="flex flex-col gap-1 border-t border-neutral-50 px-2 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-400">
          Texto alternativo
        </span>

        {podeGerenciar && foto.status === 'PRONTA' ? (
          <label>
            <span className="sr-only">Texto alternativo de {nome}</span>
            <input
              value={alt}
              onChange={(e) => aoDigitar(e.target.value)}
              maxLength={255}
              placeholder="Descreva a foto"
              className="h-[26px] w-full rounded border border-neutral-100 bg-neutral-25 px-1.5 text-[11.5px]"
            />
          </label>
        ) : (
          <span className="truncate text-[11.5px] text-neutral-500">
            {foto.textoAlternativo || '—'}
          </span>
        )}

        {foto.status === 'PRONTA' ? (
          <span className="font-mono text-[10px] text-neutral-400">
            {String(foto.largura)}×{String(foto.altura)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function Estrela({ cheia = false }: { readonly cheia?: boolean }) {
  return (
    <svg
      width={cheia ? 11 : 14}
      height={cheia ? 11 : 14}
      viewBox="0 0 24 24"
      fill={cheia ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.3 9.4l6.1-.8z" />
    </svg>
  );
}

function Lixeira() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

function SetaParaCima() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

function Mais() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function Cubo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
    </svg>
  );
}

function Certo() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Tracinho() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
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
