import { PERM, type TabelaPreco } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/**
 * As tabelas de preço.
 *
 * Padrão, Professor, Aluno e Revendedor vinham do seed e não havia como criar
 * a quinta, renomear nenhuma nem aposentar as que sobraram. Toda a política
 * de "quem paga quanto" dependia de uma lista que a aplicação não editava.
 */
export function TabelasPreco() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState('');

  const podeEditar = pode(PERM.preco.editar);

  const consulta = useQuery({
    queryKey: ['tabelas-preco'],
    queryFn: () => pedir<TabelaPreco[]>('/tabelas-preco'),
  });

  function aoFalhar(e: unknown) {
    setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
  }

  async function recarregar() {
    setErro(null);
    await fila.invalidateQueries({ queryKey: ['tabelas-preco'] });
    // O seletor do cadastro de cliente e a grade de preços do produto leem a
    // mesma lista; deixá-los com a versão anterior mostraria tabela que
    // acabou de nascer como inexistente.
    await fila.invalidateQueries({ queryKey: ['clientes'] });
    await fila.invalidateQueries({ queryKey: ['produtos'] });
  }

  const criar = useMutation({
    mutationFn: () => pedir<{ id: string }>('/tabelas-preco', { method: 'POST', body: { nome } }),
    onSuccess: async () => {
      setCriando(false);
      setNome('');
      await recarregar();
    },
    onError: aoFalhar,
  });

  const alterar = useMutation({
    mutationFn: (v: { id: string; dados: Record<string, unknown> }) =>
      pedir<{ id: string }>(`/tabelas-preco/${v.id}`, { method: 'PATCH', body: v.dados }),
    onSuccess: async () => {
      setEditando(null);
      await recarregar();
    },
    onError: aoFalhar,
  });

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <h1 className="font-display text-[15px] font-semibold text-neutral-900">
          Tabelas de preço
        </h1>
        <div className="hidden flex-1 sm:block" />
        {podeEditar && !criando ? (
          <Botao variante="secundario" onClick={() => setCriando(true)}>
            Nova tabela
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
          <p className="text-[13px] leading-[19px] text-neutral-500">
            Cada cadastro de cliente compra por uma tabela. O preço de cada produto em cada tabela é
            preenchido na página do produto.
          </p>

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {criando ? (
            <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
              <Campo
                rotulo="Nome da tabela"
                value={nome}
                autoFocus
                onChange={(e) => setNome(e.target.value)}
                placeholder="Revendedor Atacado"
                ajuda="A chave sai do nome: Revendedor Atacado vira REVENDEDOR_ATACADO."
              />
              <div className="flex flex-wrap gap-2">
                <Botao
                  variante="primario"
                  carregando={criar.isPending}
                  disabled={nome.trim().length < 2}
                  onClick={() => {
                    setErro(null);
                    criar.mutate();
                  }}
                >
                  Criar
                </Botao>
                <Botao variante="secundario" onClick={() => setCriando(false)}>
                  Cancelar
                </Botao>
              </div>
              <p className="text-[12px] text-neutral-500">
                Ela nasce vazia. Enquanto não tiver preço, quem for vinculado a ela vê o catálogo
                sem nada.
              </p>
            </section>
          ) : null}

          {consulta.isPending ? <EstadoCarregando titulo="Carregando tabelas…" /> : null}

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

          {consulta.data ? (
            <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              {consulta.data.map((t) => (
                <div
                  key={t.id}
                  className={juntar(
                    'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-50 px-4 py-3 last:border-0',
                    t.status === 'INATIVO' && 'opacity-60',
                  )}
                >
                  {editando === t.id ? (
                    <div className="flex w-full flex-wrap items-end gap-2">
                      <Campo
                        rotulo="Nome"
                        value={novoNome}
                        autoFocus
                        onChange={(e) => setNovoNome(e.target.value)}
                        className="min-w-[200px] flex-1"
                      />
                      <Botao
                        variante="primario"
                        tamanho="compacto"
                        disabled={novoNome.trim().length < 2}
                        onClick={() => alterar.mutate({ id: t.id, dados: { nome: novoNome } })}
                      >
                        Salvar
                      </Botao>
                      <Botao
                        variante="secundario"
                        tamanho="compacto"
                        onClick={() => setEditando(null)}
                      >
                        Cancelar
                      </Botao>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13.5px] font-medium text-neutral-900">
                            {t.nome}
                          </span>
                          {t.padrao ? (
                            <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary-700">
                              padrão
                            </span>
                          ) : null}
                          {t.status === 'INATIVO' ? (
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-600">
                              desativada
                            </span>
                          ) : null}
                        </p>
                        <p className="font-mono text-[11px] text-neutral-400">{t.chave}</p>
                      </div>

                      {/* Os dois números que decidem se mexer nela é seguro. */}
                      <span
                        className={juntar(
                          'text-[12px]',
                          t.itensComPreco === 0
                            ? 'font-medium text-[var(--color-atencao)]'
                            : 'text-neutral-500',
                        )}
                      >
                        {t.itensComPreco} {t.itensComPreco === 1 ? 'item' : 'itens'}
                      </span>
                      <span className="text-[12px] text-neutral-500">
                        {t.clientes} {t.clientes === 1 ? 'cadastro' : 'cadastros'}
                      </span>

                      {podeEditar ? (
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Botao
                            variante="secundario"
                            tamanho="compacto"
                            onClick={() => {
                              setEditando(t.id);
                              setNovoNome(t.nome);
                            }}
                          >
                            Renomear
                          </Botao>

                          {!t.padrao && t.status === 'ATIVO' ? (
                            <Botao
                              variante="secundario"
                              tamanho="compacto"
                              onClick={() => alterar.mutate({ id: t.id, dados: { padrao: true } })}
                            >
                              Tornar padrão
                            </Botao>
                          ) : null}

                          {!t.padrao ? (
                            <Botao
                              variante={t.status === 'ATIVO' ? 'perigo' : 'secundario'}
                              tamanho="compacto"
                              onClick={() =>
                                alterar.mutate({
                                  id: t.id,
                                  dados: { status: t.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' },
                                })
                              }
                            >
                              {t.status === 'ATIVO' ? 'Desativar' : 'Reativar'}
                            </Botao>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
