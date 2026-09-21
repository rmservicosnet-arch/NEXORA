import { PERM, type ApoioProduto, type Opcao, type OpcaoComUso } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

type Onde = 'categorias' | 'marcas';

/**
 * Categorias e marcas — como o produto é classificado.
 *
 * As duas só existiam pelo seed: a API as listava e nenhuma rota as criava.
 * O cadastro de produto ganhou um botão para criar no fluxo, mas criar no
 * fluxo não dá onde VER todas, renomear e organizar — e um nome digitado
 * errado ficava preso para sempre.
 *
 * A regra das três ações está escrita no alto, antes de alguém apertar o
 * botão errado:
 *
 *   sem vínculo  → exclui
 *   com vínculo  → desativa (some das escolhas novas, não mexe no passado)
 *   desativada   → reativa
 *
 * Apagar com vínculo deixaria os produtos sem categoria, e quem olhasse
 * depois não saberia que já tiveram uma.
 *
 * **A árvore de subcategorias não aparece aqui de propósito.** A coluna
 * `pai_id` existe no banco desde o início e nada a escreve nem a lê — dar
 * uma tela a ela seria oferecer uma organização que nenhuma outra parte do
 * sistema enxerga.
 */
export function Classificacao() {
  const { pode } = useSessao();
  const fila = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const podeEditar = pode(PERM.produto.criar);

  const consulta = useQuery({
    queryKey: ['produtos', 'apoio'],
    queryFn: () => pedir<ApoioProduto>('/produtos/apoio'),
  });

  const recarregar = async () => {
    await fila.invalidateQueries({ queryKey: ['produtos', 'apoio'] });
  };

  const aoFalhar = (e: unknown) => {
    setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6 lg:overflow-hidden">
      <div>
        <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
          Categorias e marcas
        </h1>
        <p className="mt-0.5 text-[13.5px] text-neutral-500">
          Como o produto é classificado. As duas são opcionais no cadastro — e as duas aparecem nos
          filtros do catálogo e dos relatórios.
        </p>
      </div>

      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível concluir">
          {erro}
        </Aviso>
      ) : null}

      <Aviso tom="atencao" titulo="Com produto apontando, não se exclui — desativa">
        Apagar deixaria os produtos sem categoria, e quem olhasse depois não saberia que já tiveram
        uma. Desativada some das escolhas <strong className="font-semibold">novas</strong>, continua
        valendo no que já existe, e volta atrás. Só a que ninguém usa mostra <em>Excluir</em>.
      </Aviso>

      {consulta.isPending ? <EstadoCarregando titulo="Carregando…" /> : null}

      {consulta.isError ? (
        <EstadoErro
          titulo="Não foi possível carregar"
          descricao={
            consulta.error instanceof ErroRequisicao
              ? consulta.error.corpo.mensagem
              : 'Tente novamente em instantes.'
          }
          aoTentarNovamente={() => void consulta.refetch()}
        />
      ) : null}

      {consulta.data ? (
        <div className="flex flex-col items-stretch gap-3.5 lg:min-h-0 lg:flex-1 lg:flex-row">
          <Painel
            titulo="Categorias"
            singular="categoria"
            onde="categorias"
            itens={consulta.data.categorias}
            podeEditar={podeEditar}
            aoMudar={recarregar}
            aoFalhar={aoFalhar}
            aoLimparErro={() => setErro(null)}
          />
          <Painel
            titulo="Marcas"
            singular="marca"
            onde="marcas"
            itens={consulta.data.marcas}
            podeEditar={podeEditar}
            aoMudar={recarregar}
            aoFalhar={aoFalhar}
            aoLimparErro={() => setErro(null)}
          />
        </div>
      ) : null}
    </main>
  );
}

function Painel({
  titulo,
  singular,
  onde,
  itens,
  podeEditar,
  aoMudar,
  aoFalhar,
  aoLimparErro,
}: {
  readonly titulo: string;
  readonly singular: string;
  readonly onde: Onde;
  readonly itens: readonly OpcaoComUso[];
  readonly podeEditar: boolean;
  readonly aoMudar: () => Promise<void>;
  readonly aoFalhar: (e: unknown) => void;
  readonly aoLimparErro: () => void;
}) {
  const [mostrarDesativadas, setMostrarDesativadas] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');

  const ativas = itens.filter((o) => o.ativo);
  const desativadas = itens.filter((o) => !o.ativo);
  const visiveis = mostrarDesativadas ? itens : ativas;

  const criar = useMutation({
    mutationFn: () =>
      pedir<Opcao>(`/produtos/${onde}`, { method: 'POST', body: { nome: nomeNovo.trim() } }),
    onSuccess: async () => {
      aoLimparErro();
      setCriando(false);
      setNomeNovo('');
      await aoMudar();
    },
    onError: aoFalhar,
  });

  return (
    <section className="flex max-h-[420px] flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm lg:max-h-none">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-neutral-100 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
          {titulo}
        </span>
        <span className="font-mono text-[12px] text-neutral-400">{itens.length}</span>
        <div className="flex-1" />
        {podeEditar && !criando ? (
          <Botao
            variante="primario"
            onClick={() => {
              aoLimparErro();
              setCriando(true);
            }}
          >
            + Nova
          </Botao>
        ) : null}
      </div>

      {criando ? (
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5">
          <input
            value={nomeNovo}
            autoFocus
            maxLength={120}
            placeholder={`Nome da ${singular}`}
            onChange={(e) => setNomeNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nomeNovo.trim().length >= 2) criar.mutate();
              if (e.key === 'Escape') setCriando(false);
            }}
            className="h-9 min-w-0 flex-1 rounded-md border border-neutral-200 px-2.5 text-[13.5px] text-neutral-900 outline-none focus:border-primary-300"
          />
          <Botao
            variante="primario"
            carregando={criar.isPending}
            disabled={nomeNovo.trim().length < 2}
            onClick={() => criar.mutate()}
          >
            Criar
          </Botao>
          <button
            type="button"
            onClick={() => {
              setCriando(false);
              setNomeNovo('');
            }}
            className="h-9 rounded-md border border-neutral-200 px-3 text-[12.5px] text-neutral-600"
          >
            Cancelar
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {visiveis.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-neutral-400">
            {itens.length === 0
              ? `Nenhuma ${singular} cadastrada ainda.`
              : `Nenhuma ${singular} ativa.`}
          </p>
        ) : (
          visiveis.map((o) => (
            <Linha
              key={o.id}
              opcao={o}
              singular={singular}
              onde={onde}
              podeEditar={podeEditar}
              aoMudar={aoMudar}
              aoFalhar={aoFalhar}
              aoLimparErro={aoLimparErro}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold text-neutral-700">
          {ativas.length} {ativas.length === 1 ? 'ativa' : 'ativas'}
          {desativadas.length > 0
            ? `, ${String(desativadas.length)} ${desativadas.length === 1 ? 'desativada' : 'desativadas'}`
            : ''}
        </span>
        <div className="flex-1" />
        {/* Só oferece quando há o que mostrar: um link que não muda nada é pior
            do que a ausência dele. */}
        {desativadas.length > 0 ? (
          <button
            type="button"
            onClick={() => setMostrarDesativadas(!mostrarDesativadas)}
            className="text-[12.5px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
          >
            {mostrarDesativadas ? 'Esconder desativadas' : 'Mostrar desativadas'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Linha({
  opcao,
  singular,
  onde,
  podeEditar,
  aoMudar,
  aoFalhar,
  aoLimparErro,
}: {
  readonly opcao: OpcaoComUso;
  readonly singular: string;
  readonly onde: Onde;
  readonly podeEditar: boolean;
  readonly aoMudar: () => Promise<void>;
  readonly aoFalhar: (e: unknown) => void;
  readonly aoLimparErro: () => void;
}) {
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(opcao.nome);
  const [confirmando, setConfirmando] = useState(false);

  /*
    Os três hooks chamados DIRETO, sem um `agir()` que os embrulhe.

    Embrulhar funcionava — três chamadas, sempre na mesma ordem —, mas um
    hook dentro de função comum é convenção quebrada que o próximo a mexer
    aqui copiaria para dentro de um `if`, e aí a ordem muda entre renders.
  */
  const renomear = useAcao(
    () =>
      pedir<Opcao>(`/produtos/${onde}/${opcao.id}`, { method: 'PUT', body: { nome: nome.trim() } }),
    aoMudar,
    aoFalhar,
    aoLimparErro,
  );

  const alternar = useAcao(
    () =>
      pedir<Opcao>(`/produtos/${onde}/${opcao.id}/situacao`, {
        method: 'PUT',
        body: { ativo: !opcao.ativo },
      }),
    aoMudar,
    aoFalhar,
    aoLimparErro,
  );

  const excluir = useAcao(
    () => pedir<void>(`/produtos/${onde}/${opcao.id}`, { method: 'DELETE' }),
    aoMudar,
    aoFalhar,
    aoLimparErro,
  );

  return (
    <div
      className={juntar(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-neutral-50 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_90px_auto]',
        !opcao.ativo && 'bg-neutral-25',
      )}
    >
      {renomeando ? (
        <input
          value={nome}
          autoFocus
          maxLength={120}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nome.trim().length >= 2) {
              void renomear.executar().then(() => setRenomeando(false));
            }
            if (e.key === 'Escape') {
              setNome(opcao.nome);
              setRenomeando(false);
            }
          }}
          className="col-span-2 h-8 min-w-0 rounded-md border border-primary-200 px-2.5 text-[13px] text-neutral-900 outline-none sm:col-span-1"
        />
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={juntar(
              'truncate text-[13px]',
              opcao.ativo ? 'text-neutral-900' : 'text-neutral-400',
            )}
          >
            {opcao.nome}
          </span>
          {opcao.ativo ? null : (
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
              desativada
            </span>
          )}
        </span>
      )}

      <span
        className={juntar(
          'hidden text-right font-mono text-[12.5px] sm:block',
          opcao.produtos === 0 ? 'text-neutral-300' : 'text-neutral-900',
        )}
        title={`${String(opcao.produtos)} produto(s)`}
      >
        {opcao.produtos}
      </span>

      <span className="flex flex-wrap justify-end gap-1.5">
        {!podeEditar ? null : renomeando ? (
          <>
            <Acao
              rotulo="Salvar"
              tom="primario"
              ocupado={renomear.ocupado}
              desabilitado={nome.trim().length < 2}
              aoClicar={() => {
                void renomear.executar().then(() => setRenomeando(false));
              }}
            />
            <Acao
              rotulo="Cancelar"
              aoClicar={() => {
                setNome(opcao.nome);
                setRenomeando(false);
              }}
            />
          </>
        ) : confirmando ? (
          <>
            <span className="text-[11.5px] text-[var(--color-perigo)]">Excluir? Não volta.</span>
            <Acao
              rotulo="Excluir"
              tom="perigo"
              ocupado={excluir.ocupado}
              aoClicar={() => void excluir.executar()}
            />
            <Acao rotulo="Cancelar" aoClicar={() => setConfirmando(false)} />
          </>
        ) : (
          <>
            <Acao
              rotulo="Renomear"
              aoClicar={() => {
                aoLimparErro();
                setRenomeando(true);
              }}
            />
            {/*
              Excluir só na que ninguém usa — o número vem do servidor. Na que
              tem produtos o controle é Desativar, que é a operação
              reversível. Oferecer "Excluir" para depois responder 409 seria
              caminho que falha.
            */}
            {opcao.produtos === 0 && opcao.ativo ? (
              <Acao rotulo="Excluir" tom="perigo" aoClicar={() => setConfirmando(true)} />
            ) : (
              <Acao
                rotulo={opcao.ativo ? 'Desativar' : 'Reativar'}
                tom={opcao.ativo ? 'atencao' : 'primario'}
                ocupado={alternar.ocupado}
                aoClicar={() => void alternar.executar()}
              />
            )}
          </>
        )}
      </span>

      {/* No celular a contagem não cabe na linha; vai embaixo, por extenso. */}
      <span className="col-span-2 text-[11.5px] text-neutral-400 sm:hidden">
        {opcao.produtos} {opcao.produtos === 1 ? 'produto usa' : 'produtos usam'} esta {singular}
      </span>
    </div>
  );
}

const TOM_ACAO = {
  normal: 'border-neutral-200 text-neutral-700',
  perigo: 'border-[#f0c9cb] text-[var(--color-perigo)]',
  atencao: 'border-[#ebd6a8] text-[var(--color-atencao)]',
  primario: 'border-primary-200 text-primary-700',
} as const;

function Acao({
  rotulo,
  aoClicar,
  tom = 'normal',
  ocupado = false,
  desabilitado = false,
}: {
  readonly rotulo: string;
  readonly aoClicar: () => void;
  readonly tom?: keyof typeof TOM_ACAO;
  readonly ocupado?: boolean;
  readonly desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={ocupado || desabilitado}
      onClick={aoClicar}
      className={juntar(
        'h-[26px] rounded-md border bg-white px-2.5 text-[11.5px] disabled:opacity-40',
        TOM_ACAO[tom],
      )}
    >
      {rotulo}
    </button>
  );
}

/**
 * Uma ação que recarrega a lista e reporta o erro no topo.
 *
 * Não é `useMutation`: as linhas são muitas e cada uma teria três mutações
 * com `onSuccess`/`onError` idênticos. O que muda entre elas é só a chamada.
 */
function useAcao(
  executar: () => Promise<unknown>,
  aoMudar: () => Promise<void>,
  aoFalhar: (e: unknown) => void,
  aoLimparErro: () => void,
): { readonly ocupado: boolean; readonly executar: () => Promise<void> } {
  const [ocupado, setOcupado] = useState(false);

  return {
    ocupado,
    executar: async () => {
      setOcupado(true);
      aoLimparErro();
      try {
        await executar();
        await aoMudar();
      } catch (e) {
        aoFalhar(e);
      } finally {
        setOcupado(false);
      }
    },
  };
}
