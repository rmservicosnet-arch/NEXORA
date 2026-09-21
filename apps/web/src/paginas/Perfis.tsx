import { PERM, type ApoioEquipe, type Perfil } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/** Nome de grupo com a primeira maiúscula. `configuracao` → `Configuração`. */
const NOME_GRUPO: Record<string, string> = {
  configuracao: 'Configuração',
  comissao: 'Comissão',
  relatorio: 'Relatório',
  usuario: 'Usuário',
  preco: 'Preço',
  integracao: 'Integração',
  permissao: 'Permissão',
};

function rotuloGrupo(g: string): string {
  return NOME_GRUPO[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
}

/**
 * Perfis e permissões.
 *
 * Um perfil é uma **lista explícita** de permissões. "Marcar o grupo" marca as
 * permissões de hoje, uma a uma — não é curinga. Um perfil montado com "todo o
 * grupo carteira" passaria a conceder cada permissão que aparecesse ali
 * depois, sem ninguém decidir; foi assim que o perfil Financeiro ganhou
 * `carteira.ajustar` duas vezes.
 *
 * Perfil de sistema é só leitura: `db:sync-perfis` reescreve as permissões
 * dele a partir de `docs/`, e uma edição feita aqui voltaria atrás na próxima
 * sincronização. Quem precisa de algo diferente duplica e ajusta a cópia.
 */
export function Perfis() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<string[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const podeEditar = pode(PERM.usuario.editar);

  /*
    Duas consultas de propósito. `apoio` é o que a tela de CADASTRO pode
    oferecer, e por isso ela não devolve o perfil do portal — que não se
    atribui a funcionário. Aqui é o inventário: esconder um perfil faria a
    contagem mentir e quem auditasse "quem acessa o portal" não o acharia.
  */
  const consulta = useQuery({
    queryKey: ['equipe', 'perfis'],
    queryFn: () => pedir<Perfil[]>('/equipe/perfis'),
  });

  const catalogo = useQuery({
    queryKey: ['equipe', 'apoio'],
    queryFn: () => pedir<ApoioEquipe>('/equipe/apoio'),
  });

  const dados =
    consulta.data && catalogo.data
      ? { perfis: consulta.data, permissoes: catalogo.data.permissoes }
      : undefined;
  const perfis = dados?.perfis ?? [];
  const atual = perfis.find((p) => p.id === escolhido) ?? perfis[0] ?? null;

  /* O rascunho carrega o id do DONO: trocar de perfil na lista não remonta o
     componente, e as marcações do anterior ficariam no seguinte. */
  const [dono, setDono] = useState<string | null>(atual?.id ?? null);
  if (atual && dono !== atual.id) {
    setDono(atual.id);
    setRascunho(null);
    setErro(null);
  }

  const marcadas = rascunho ?? atual?.permissoes ?? [];
  const sujo = rascunho !== null && atual !== null && !mesmos(rascunho, atual.permissoes);

  const salvar = useMutation({
    mutationFn: () =>
      pedir<Perfil>(`/equipe/perfis/${String(atual?.id)}`, {
        method: 'PUT',
        body: { permissoes: marcadas },
      }),
    onSuccess: async () => {
      setRascunho(null);
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['equipe'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  const duplicar = useMutation({
    mutationFn: (nome: string) =>
      pedir<Perfil>(`/equipe/perfis/${String(atual?.id)}/duplicar`, {
        method: 'POST',
        body: { nome },
      }),
    onSuccess: async (novo) => {
      setErro(null);
      setEscolhido(novo.id);
      await fila.invalidateQueries({ queryKey: ['equipe'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível duplicar.');
    },
  });

  if (consulta.isPending || catalogo.isPending) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoCarregando titulo="Carregando perfis…" />
      </main>
    );
  }

  if (consulta.isError || catalogo.isError || !dados) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoErro
          titulo="Não foi possível carregar"
          descricao={
            consulta.error instanceof ErroRequisicao
              ? consulta.error.corpo.mensagem
              : 'Tente novamente em instantes.'
          }
          aoTentarNovamente={() => void consulta.refetch()}
        />
      </main>
    );
  }

  const grupos = [...new Set(dados.permissoes.map((p) => p.grupo))];
  const travado = !podeEditar || (atual?.sistema ?? false);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <Link to="/equipe" className="text-[13.5px] text-neutral-500 no-underline hover:underline">
          Equipe
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-[13.5px] font-medium text-neutral-900">Perfis e permissões</span>
      </header>

      {/*
        Abaixo de `lg` as duas colunas empilham e quem rola é o `main`: cada
        uma fica do tamanho do conteúdo. Mantendo `flex-1` nas duas dentro de
        uma altura travada, o `overflow-hidden` do cartão anula o
        `min-height:auto` e o painel da direita virava 2px — sem erro nenhum.
      */}
      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6 lg:overflow-hidden">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Perfis e permissões
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            {dados.permissoes.length} permissões em {grupos.length} grupos — e um perfil é uma{' '}
            <strong className="font-semibold text-neutral-900">lista explícita</strong> delas
          </p>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        ) : null}

        <Aviso tom="atencao" titulo="Marcar o grupo marca as permissões de HOJE, uma a uma">
          Não é um curinga. Um perfil montado com “todo o grupo carteira” passaria a conceder cada
          permissão que aparecesse ali depois, sem ninguém decidir — foi assim que o perfil
          Financeiro ganhou <span className="font-mono text-[12px]">carteira.ajustar</span> duas
          vezes. O que fica gravado é a lista.
        </Aviso>

        <div className="flex flex-col items-stretch gap-3.5 lg:min-h-0 lg:flex-1 lg:flex-row">
          <section className="flex max-h-[340px] w-full shrink-0 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm lg:max-h-none lg:w-[320px]">
            <p className="shrink-0 border-b border-neutral-100 px-3.5 py-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              Perfis
            </p>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-2.5">
              {perfis.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setEscolhido(p.id)}
                  className={juntar(
                    'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left',
                    atual?.id === p.id
                      ? 'border-primary-100 bg-primary-50'
                      : 'border-neutral-100 bg-white hover:bg-neutral-25',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-neutral-900">
                        {p.nome}
                      </span>
                      {p.sistema ? (
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
                          sistema
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-neutral-400">
                      {p.chave}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[13px] text-neutral-900">
                      {p.permissoes.length}
                    </span>
                    <span className="block text-[11px] text-neutral-400">
                      {p.usuarios === 0
                        ? 'ninguém'
                        : `${String(p.usuarios)} ${p.usuarios === 1 ? 'pessoa' : 'pessoas'}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <p className="shrink-0 border-t border-neutral-100 px-3.5 py-2.5 text-[11.5px] leading-4 text-neutral-400">
              Perfil de <strong className="font-semibold text-neutral-600">sistema</strong> não se
              exclui nem muda de chave — <code>db:sync-perfis</code> reescreve as permissões dele.
              Duplicar e ajustar é o caminho.
            </p>
          </section>

          {atual ? (
            <section className="flex min-w-0 flex-col rounded-md border border-neutral-100 bg-white shadow-sm lg:flex-1 lg:overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-neutral-100 px-4 py-3">
                <span className="font-display text-[15px] font-bold text-neutral-900">
                  {atual.nome}
                </span>
                {atual.sistema ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
                    sistema
                  </span>
                ) : null}
                <span className="text-[12.5px] text-neutral-500">
                  {marcadas.length} de {dados.permissoes.length} permissões ·{' '}
                  {atual.usuarios === 0
                    ? 'ninguém usa'
                    : `${String(atual.usuarios)} ${atual.usuarios === 1 ? 'pessoa' : 'pessoas'}`}
                </span>

                <div className="flex-1" />

                {podeEditar && atual.sistema ? (
                  <Botao
                    variante="secundario"
                    carregando={duplicar.isPending}
                    onClick={() => duplicar.mutate(`${atual.nome} (cópia)`)}
                  >
                    Duplicar
                  </Botao>
                ) : null}

                {podeEditar && !atual.sistema ? (
                  <Botao
                    variante="primario"
                    carregando={salvar.isPending}
                    disabled={!sujo || marcadas.length === 0}
                    onClick={() => salvar.mutate()}
                  >
                    Salvar
                  </Botao>
                ) : null}
              </div>

              {atual.sistema ? (
                <p className="shrink-0 border-b border-neutral-100 bg-neutral-25 px-4 py-2 text-[12px] text-neutral-500">
                  Só leitura. Para um perfil parecido e editável, use{' '}
                  <strong className="font-semibold text-neutral-700">Duplicar</strong>.
                </p>
              ) : null}

              <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
                {grupos.map((g) => {
                  const doGrupo = dados.permissoes.filter((p) => p.grupo === g);
                  const nele = doGrupo.filter((p) => marcadas.includes(p.chave)).length;
                  const todas = nele === doGrupo.length;

                  return (
                    <div key={g}>
                      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-neutral-100 bg-neutral-25 px-4 py-2">
                        <input
                          type="checkbox"
                          checked={todas}
                          disabled={travado}
                          onChange={() => {
                            const chaves = doGrupo.map((p) => p.chave);
                            setRascunho(
                              todas
                                ? marcadas.filter((c) => !chaves.includes(c))
                                : [...new Set([...marcadas, ...chaves])],
                            );
                          }}
                          className="h-4 w-4 accent-primary-600"
                        />
                        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                          {rotuloGrupo(g)}
                        </span>
                        <span
                          className={juntar(
                            'font-mono text-[11.5px]',
                            nele === 0
                              ? 'text-neutral-300'
                              : todas
                                ? 'text-primary-800'
                                : 'text-neutral-600',
                          )}
                        >
                          {nele} / {doGrupo.length}
                        </span>
                      </div>

                      {doGrupo.map((p) => {
                        const marcada = marcadas.includes(p.chave);
                        return (
                          <label
                            key={p.chave}
                            className={juntar(
                              'flex items-start gap-2.5 border-b border-neutral-50 px-4 py-2',
                              travado ? 'cursor-default' : 'cursor-pointer hover:bg-neutral-25',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={marcada}
                              disabled={travado}
                              onChange={() =>
                                setRascunho(
                                  marcada
                                    ? marcadas.filter((c) => c !== p.chave)
                                    : [...marcadas, p.chave],
                                )
                              }
                              className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={juntar(
                                  'block truncate font-mono text-[11.5px]',
                                  marcada ? 'text-neutral-900' : 'text-neutral-500',
                                )}
                              >
                                {p.chave}
                              </span>
                              <span className="block truncate text-[11.5px] text-neutral-400">
                                {p.descricao}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {sujo ? (
                <p className="shrink-0 border-t-2 border-neutral-200 bg-[#fefbf3] px-4 py-2.5 text-[12.5px] text-[var(--color-atencao)]">
                  Alterações não salvas. Quem grava é o botão{' '}
                  <strong className="font-semibold">Salvar</strong>.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}

function mesmos(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const conjunto = new Set(b);
  return a.every((x) => conjunto.has(x));
}
