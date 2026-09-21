import {
  novoProdutoSchema,
  type ApoioProduto,
  type NovoProduto as NovoProdutoDto,
  type Opcao,
  type OpcaoComUso,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { juntar } from '../ui/juntar';

interface LinhaVariacao {
  readonly chave: number;
  sku: string;
  descricao: string;
  codigoBarras: string;
  precoPadrao: string;
  estoqueMinimo: string;
}

function variacaoVazia(chave: number): LinhaVariacao {
  return { chave, sku: '', descricao: '', codigoBarras: '', precoPadrao: '', estoqueMinimo: '0' };
}

export function NovoProduto() {
  const navegar = useNavigate();
  const fila = useQueryClient();

  const [skuBase, setSkuBase] = useState('');
  const [nome, setNome] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [marcaId, setMarcaId] = useState('');
  const [variacoes, setVariacoes] = useState<LinhaVariacao[]>([variacaoVazia(1)]);
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  /**
   * Cria e recarrega o apoio.
   *
   * Sem invalidar a consulta, a opção nova não apareceria na lista — ela
   * ficaria escolhida e invisível, e trocar de categoria e voltar a perderia.
   */
  const criarOpcao = async (onde: 'categorias' | 'marcas', nome: string) => {
    const criada = await pedir<Opcao>(`/produtos/${onde}`, { method: 'POST', body: { nome } });
    await fila.invalidateQueries({ queryKey: ['produtos', 'apoio'] });
    return criada;
  };

  const alternarOpcao = async (onde: 'categorias' | 'marcas', id: string, ativo: boolean) => {
    await pedir<Opcao>(`/produtos/${onde}/${id}/situacao`, { method: 'PUT', body: { ativo } });
    await fila.invalidateQueries({ queryKey: ['produtos', 'apoio'] });
  };

  const excluirOpcao = async (onde: 'categorias' | 'marcas', id: string) => {
    await pedir<void>(`/produtos/${onde}/${id}`, { method: 'DELETE' });
    await fila.invalidateQueries({ queryKey: ['produtos', 'apoio'] });
  };

  const apoio = useQuery({
    queryKey: ['produtos', 'apoio'],
    queryFn: () => pedir<ApoioProduto>('/produtos/apoio'),
  });

  const criar = useMutation({
    mutationFn: (dados: NovoProdutoDto) =>
      pedir<{ id: string }>('/produtos', { method: 'POST', body: dados }),
    onSuccess: async () => {
      await fila.invalidateQueries({ queryKey: ['produtos'] });
      void navegar('/produtos');
    },
    onError: (erro) => {
      if (erro instanceof ErroRequisicao) {
        // O servidor devolve os campos com problema em formato estável.
        const doServidor: Record<string, string> = {};
        for (const c of erro.corpo.campos ?? []) {
          doServidor[c.campo] = c.problema;
        }
        setErrosCampo(doServidor);
        setErroGeral(erro.corpo.campos?.length ? null : erro.corpo.mensagem);
      } else {
        setErroGeral('Não foi possível conectar ao servidor.');
      }
    },
  });

  /**
   * Apaga o erro de um campo assim que ele é editado.
   *
   * Sem isto a mensagem antiga fica pendurada embaixo de um campo já
   * corrigido — e a pessoa passa a desconfiar de todas as outras, inclusive
   * das que ainda estão certas.
   */
  function limparErro(caminho: string) {
    setErrosCampo((atual) => {
      if (!(caminho in atual)) return atual;
      const { [caminho]: _removido, ...resto } = atual;
      return resto;
    });
  }

  function alterarVariacao(
    indice: number,
    chave: number,
    campo: keyof LinhaVariacao,
    valor: string,
  ) {
    limparErro(`variacoes.${indice}.${campo}`);
    setVariacoes((atual) => atual.map((v) => (v.chave === chave ? { ...v, [campo]: valor } : v)));
  }

  function enviar() {
    setErrosCampo({});
    setErroGeral(null);

    const bruto = {
      skuBase,
      nome,
      ...(categoriaId ? { categoriaId } : {}),
      ...(marcaId ? { marcaId } : {}),
      unidade: 'UN',
      variacoes: variacoes.map((v) => ({
        sku: v.sku,
        descricao: v.descricao,
        ...(v.codigoBarras ? { codigoBarras: v.codigoBarras } : {}),
        estoqueMinimo: v.estoqueMinimo || '0',
        precoPadrao: v.precoPadrao,
      })),
    };

    // Valida com o MESMO schema que a API usa. Não é redundância: é feedback
    // imediato sem ida ao servidor. A validação que vale continua sendo a de
    // lá — esta só evita uma viagem.
    const resultado = novoProdutoSchema.safeParse(bruto);

    if (!resultado.success) {
      const erros: Record<string, string> = {};
      for (const problema of resultado.error.issues) {
        erros[problema.path.join('.')] = problema.message;
      }
      setErrosCampo(erros);
      return;
    }

    criar.mutate(resultado.data);
  }

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
        <span className="text-[13.5px] font-medium text-neutral-900">Novo produto</span>
        <div className="flex-1" />
        <Botao variante="secundario" comoFilho>
          <Link to="/produtos">Cancelar</Link>
        </Botao>
        <Botao variante="primario" carregando={criar.isPending} onClick={enviar}>
          Salvar produto
        </Botao>
      </header>

      {/*
        Sem teto de largura.

        860px centralizados num monitor de 1900 deixavam 400px de vazio de
        cada lado, e a grade de variacoes — que e o que precisa de espaco —
        ficava espremida no meio. O artboard da PROPORCAO, nao largura
        maxima: ja aconteceu antes, em outras telas.
      */}
      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex w-full flex-col gap-5">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Novo produto
            </h1>
            <p className="mt-1 text-[13.5px] text-neutral-500">
              O preço entra na tabela padrão. As tabelas Professor, Aluno e Revendedor usam esse
              valor até você definir o delas.
            </p>
          </div>

          {erroGeral ? (
            <Aviso tom="perigo" titulo="Não foi possível salvar">
              {erroGeral}
            </Aviso>
          ) : null}

          <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              Dados do produto
            </h2>

            {/* Empilha no celular: com 375px, "Nome" ficava com 90px. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Campo
                rotulo="SKU base"
                value={skuBase}
                onChange={(e) => {
                  limparErro('skuBase');
                  setSkuBase(e.target.value.toUpperCase());
                }}
                placeholder="KIM-TRC"
                {...(errosCampo['skuBase'] ? { erro: errosCampo['skuBase'] } : {})}
              />
              <Campo
                rotulo="Nome"
                value={nome}
                onChange={(e) => {
                  limparErro('nome');
                  setNome(e.target.value);
                }}
                placeholder="Kimono Trançado Judô"
                {...(errosCampo['nome'] ? { erro: errosCampo['nome'] } : {})}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Selecao
                rotulo="Categoria"
                comoChamar="categoria"
                valor={categoriaId}
                aoMudar={setCategoriaId}
                opcoes={apoio.data?.categorias ?? []}
                aoCriar={(nome) => criarOpcao('categorias', nome)}
                aoExcluir={(id) => excluirOpcao('categorias', id)}
                aoAlternar={(id, ativo) => alternarOpcao('categorias', id, ativo)}
              />
              <Selecao
                rotulo="Marca"
                comoChamar="marca"
                valor={marcaId}
                aoMudar={setMarcaId}
                opcoes={apoio.data?.marcas ?? []}
                aoCriar={(nome) => criarOpcao('marcas', nome)}
                aoExcluir={(id) => excluirOpcao('marcas', id)}
                aoAlternar={(id, ativo) => alternarOpcao('marcas', id, ativo)}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                Variações{' '}
                <span className="font-mono text-[11px] text-neutral-400">({variacoes.length})</span>
              </h2>
              <p className="text-[12.5px] text-neutral-500">
                Cada variação tem SKU, código de barras e estoque próprios
              </p>
            </div>

            {errosCampo['variacoes'] ? (
              <p className="text-[12.5px] font-medium text-[var(--color-perigo)]">
                {errosCampo['variacoes']}
              </p>
            ) : null}

            {/*
              Tabela larga: ROLA, nao encolhe.

              Com `minmax(0,1fr)` e 375px de tela, a coluna "Descricao" ficava
              com 22 pixels — o campo existia e era inutil. Dentro de um
              `overflow-x-auto` as colunas guardam o tamanho e quem rola e o
              trilho.
            */}
            <div className="-mx-1 overflow-x-auto px-1">
              <div className="min-w-[740px]">
                <div className="grid grid-cols-[150px_minmax(0,1fr)_160px_120px_90px_36px] gap-2.5 px-1">
                  {['SKU', 'Descrição', 'Código de barras', 'Preço', 'Mínimo', ''].map((t) => (
                    <span
                      key={t}
                      className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {variacoes.map((v, indice) => (
                  <div
                    key={v.chave}
                    className="grid grid-cols-[150px_minmax(0,1fr)_160px_120px_90px_36px] items-start gap-2.5"
                  >
                    <EntradaSimples
                      valor={v.sku}
                      aoMudar={(x) => alterarVariacao(indice, v.chave, 'sku', x.toUpperCase())}
                      placeholder="KIM-TRC-A2-BR"
                      mono
                      erro={errosCampo[`variacoes.${indice}.sku`]}
                      rotulo={`SKU da variação ${indice + 1}`}
                    />
                    <EntradaSimples
                      valor={v.descricao}
                      aoMudar={(x) => alterarVariacao(indice, v.chave, 'descricao', x)}
                      placeholder="A2 · Branco"
                      erro={errosCampo[`variacoes.${indice}.descricao`]}
                      rotulo={`Descrição da variação ${indice + 1}`}
                    />
                    <EntradaSimples
                      valor={v.codigoBarras}
                      aoMudar={(x) => alterarVariacao(indice, v.chave, 'codigoBarras', x)}
                      placeholder="7891000000011"
                      mono
                      rotulo={`Código de barras da variação ${indice + 1}`}
                    />
                    <EntradaSimples
                      valor={v.precoPadrao}
                      aoMudar={(x) => alterarVariacao(indice, v.chave, 'precoPadrao', x)}
                      placeholder="489.90"
                      mono
                      erro={errosCampo[`variacoes.${indice}.precoPadrao`]}
                      rotulo={`Preço da variação ${indice + 1}`}
                    />
                    <EntradaSimples
                      valor={v.estoqueMinimo}
                      aoMudar={(x) => alterarVariacao(indice, v.chave, 'estoqueMinimo', x)}
                      mono
                      rotulo={`Estoque mínimo da variação ${indice + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => setVariacoes((a) => a.filter((x) => x.chave !== v.chave))}
                      disabled={variacoes.length === 1}
                      aria-label={`Remover variação ${indice + 1}`}
                      className="flex h-[38px] items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      <svg
                        width="15"
                        height="15"
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
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <Botao
              variante="secundario"
              className="w-fit"
              onClick={() =>
                setVariacoes((a) => [...a, variacaoVazia(Math.max(...a.map((x) => x.chave)) + 1)])
              }
            >
              + Adicionar variação
            </Botao>
          </section>

          <Aviso tom="info">
            O produto nasce <strong>ativo mas não publicado</strong>. Para entrar no catálogo ele
            precisa de ao menos uma foto — a API recusa a publicação sem isso.
          </Aviso>
        </div>
      </main>
    </>
  );
}

/**
 * Escolher — e criar, quando não existe.
 *
 * Categoria e marca só nasciam no seed: a API as listava e nenhuma rota as
 * criava. Numa empresa nova os dois campos ficavam presos em "Não definida"
 * para sempre, e quem cadastrasse produto não tinha para onde ir.
 *
 * O botão fica AO LADO do select, não numa tela separada: a falta é
 * descoberta aqui, com o formulário meio preenchido, e mandar a pessoa sair
 * para cadastrar a categoria perderia o que ela já digitou.
 */
function Selecao({
  rotulo,
  valor,
  aoMudar,
  opcoes,
  aoCriar,
  aoExcluir,
  aoAlternar,
  comoChamar,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly opcoes: readonly OpcaoComUso[];
  readonly aoCriar: (nome: string) => Promise<{ id: string; nome: string }>;
  readonly aoExcluir: (id: string) => Promise<void>;
  readonly aoAlternar: (id: string, ativo: boolean) => Promise<void>;
  readonly comoChamar: string;
}) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /** Qual está esperando confirmação. Exclusão não volta. */
  const [excluindo, setExcluindo] = useState<string | null>(null);

  const escolhida = opcoes.find((o) => o.id === valor) ?? null;

  /*
    Oferece as ATIVAS, e mantém a escolhida mesmo desativada.

    Tirar a desativada da lista faria o campo de um produto que já a usa
    mostrar "Não definida" — o valor continuaria gravado e a tela mentiria
    sobre ele. Listar todas devolveria a desativada ao cardápio, que é
    justamente o que desativar existe para impedir.
  */
  const oferecidas = opcoes.filter((o) => o.ativo || o.id === valor);

  const alternar = async (ativo: boolean) => {
    if (!escolhida) return;
    setOcupado(true);
    setErro(null);
    try {
      await aoAlternar(escolhida.id, ativo);
      if (!ativo) aoMudar('');
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async () => {
    if (!escolhida) return;
    setOcupado(true);
    setErro(null);
    try {
      await aoExcluir(escolhida.id);
      aoMudar('');
      setExcluindo(null);
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível excluir.');
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const nova = await aoCriar(nome.trim());
      // Já escolhe a que acabou de criar: quem cria neste ponto quer usá-la
      // agora. Criar e ter de escolher de novo seria meio caminho.
      aoMudar(nova.id);
      setCriando(false);
      setNome('');
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível criar.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
          {rotulo}
        </span>
        {criando ? null : (
          <button
            type="button"
            onClick={() => {
              setCriando(true);
              setErro(null);
            }}
            className="text-[12px] text-primary-700 underline underline-offset-2 hover:text-primary-800"
          >
            + Nova {comoChamar}
          </button>
        )}
      </div>

      {criando ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              value={nome}
              autoFocus
              maxLength={120}
              placeholder={`Nome d${comoChamar === 'marca' ? 'a marca' : 'a categoria'}`}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (nome.trim().length >= 2) void confirmar();
                }
                if (e.key === 'Escape') setCriando(false);
              }}
              className="h-[42px] min-w-0 flex-1 rounded-md border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none focus:border-primary-300"
            />
            <Botao
              variante="primario"
              carregando={ocupado}
              disabled={nome.trim().length < 2}
              onClick={() => void confirmar()}
            >
              Criar
            </Botao>
            <button
              type="button"
              onClick={() => {
                setCriando(false);
                setErro(null);
              }}
              className="h-[42px] rounded-md border border-neutral-200 px-3 text-[13px] text-neutral-600"
            >
              Cancelar
            </button>
          </div>
          {erro ? <span className="text-[12px] text-[var(--color-perigo)]">{erro}</span> : null}
        </div>
      ) : (
        <select
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          aria-label={rotulo}
          className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900"
        >
          <option value="">Não definida</option>
          {oferecidas.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
              {o.ativo ? '' : ' (desativada)'}
            </option>
          ))}
        </select>
      )}

      {/* Empresa nova nasce sem nenhuma das duas. Dizer isso é melhor do que
          deixar a pessoa procurar uma lista que está vazia porque nunca teve
          nada. */}
      {!criando && opcoes.length === 0 ? (
        <span className="text-[11.5px] leading-4 text-neutral-400">
          Nenhuma {comoChamar} cadastrada ainda.
        </span>
      ) : null}

      {/*
        Excluir aparece só na que NINGUÉM usa — o número vem do servidor.
        Na que tem produtos vai o motivo escrito, em elemento visível: um
        botão cinza sem explicação parece defeito, e `title` não existe no
        celular.
      */}
      {!criando && escolhida ? (
        excluindo === escolhida.id ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#f0c9cb] bg-[#fdf5f5] px-2.5 py-2">
            <span className="min-w-0 flex-1 text-[12px] text-[var(--color-perigo)]">
              Excluir <strong className="font-semibold">{escolhida.nome}</strong>? Não volta.
            </span>
            <Botao variante="perigo" carregando={ocupado} onClick={() => void excluir()}>
              Excluir
            </Botao>
            <button
              type="button"
              onClick={() => setExcluindo(null)}
              className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[12.5px] text-neutral-600"
            >
              Cancelar
            </button>
          </div>
        ) : !escolhida.ativo ? (
          <span className="flex flex-wrap items-center gap-2 text-[11.5px] leading-4 text-neutral-400">
            Desativada — não aparece nas escolhas novas e continua valendo em {escolhida.produtos}{' '}
            {escolhida.produtos === 1 ? 'produto' : 'produtos'}.
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void alternar(true)}
              className="text-[11.5px] text-primary-700 underline underline-offset-2"
            >
              Reativar
            </button>
          </span>
        ) : escolhida.produtos === 0 ? (
          <button
            type="button"
            onClick={() => {
              setExcluindo(escolhida.id);
              setErro(null);
            }}
            className="w-fit text-[11.5px] text-[var(--color-perigo)] underline underline-offset-2"
          >
            Excluir {escolhida.nome}
          </button>
        ) : (
          /*
            Com vínculo não se exclui: apagar deixaria os produtos sem
            categoria, e quem olhasse depois não saberia que já tiveram uma.
            Desativar é a saída — some das escolhas novas, não mexe no
            passado, e volta atrás.
          */
          <span className="flex flex-wrap items-center gap-2 text-[11.5px] leading-4 text-neutral-400">
            {escolhida.produtos} {escolhida.produtos === 1 ? 'produto usa' : 'produtos usam'} esta{' '}
            {comoChamar}, então ela não se exclui.
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void alternar(false)}
              className="text-[11.5px] text-[var(--color-atencao)] underline underline-offset-2"
            >
              Desativar
            </button>
          </span>
        )
      ) : null}

      {!criando && erro ? (
        <span className="text-[12px] text-[var(--color-perigo)]">{erro}</span>
      ) : null}
    </div>
  );
}

function EntradaSimples({
  valor,
  aoMudar,
  placeholder,
  mono,
  erro,
  rotulo,
}: {
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly placeholder?: string;
  readonly mono?: boolean;
  readonly erro?: string | undefined;
  readonly rotulo: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <input
        aria-label={rotulo}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        aria-invalid={erro ? true : undefined}
        className={juntar(
          'h-[38px] w-full rounded-md border bg-white px-2.5 text-[13px] placeholder:text-neutral-300',
          mono && 'font-mono text-[12.5px]',
          erro ? 'border-[var(--color-perigo)]' : 'border-neutral-200',
        )}
      />
      {erro ? <span className="text-[11.5px] text-[var(--color-perigo)]">{erro}</span> : null}
    </div>
  );
}
