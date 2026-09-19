import {
  novoProdutoSchema,
  type ApoioProduto,
  type NovoProduto as NovoProdutoDto,
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

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
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
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              Dados do produto
            </h2>

            <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
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

            <div className="grid grid-cols-2 gap-4">
              <Selecao
                rotulo="Categoria"
                valor={categoriaId}
                aoMudar={setCategoriaId}
                opcoes={apoio.data?.categorias ?? []}
              />
              <Selecao
                rotulo="Marca"
                valor={marcaId}
                aoMudar={setMarcaId}
                opcoes={apoio.data?.marcas ?? []}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                Variações{' '}
                <span className="font-sans text-[13px] font-normal text-neutral-500">
                  ({variacoes.length})
                </span>
              </h2>
              <p className="text-[12.5px] text-neutral-500">
                Cada variação tem SKU, código de barras e estoque próprios
              </p>
            </div>

            {errosCampo['variacoes'] ? (
              <p className="text-[12.5px] font-medium text-[--color-perigo]">
                {errosCampo['variacoes']}
              </p>
            ) : null}

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

function Selecao({
  rotulo,
  valor,
  aoMudar,
  opcoes,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly opcoes: readonly { id: string; nome: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
        {rotulo}
      </span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900"
      >
        <option value="">Não definida</option>
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </label>
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
          erro ? 'border-[--color-perigo]' : 'border-neutral-200',
        )}
      />
      {erro ? <span className="text-[11.5px] text-[--color-perigo]">{erro}</span> : null}
    </div>
  );
}
