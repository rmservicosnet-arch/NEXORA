import { PERM, type Fornecedor } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

interface Rascunho {
  nome: string;
  documento: string;
  email: string;
  telefone: string;
}

const VAZIO: Rascunho = { nome: '', documento: '', email: '', telefone: '' };

/**
 * De quem a loja compra.
 *
 * A API criava e listava fornecedor desde que Compras nasceu, e nenhuma tela
 * chamava: dava para escolher entre os que o seed criou e mais nada. Era o
 * mesmo buraco de "rota com permissão própria que nenhuma tela chama".
 *
 * Desativar não apaga — o fornecedor aparece em notas já recebidas, e apagar
 * deixaria compras órfãs. Ele só sai da lista de escolha da nova entrada.
 */
export function Fornecedores() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(VAZIO);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeEditar = pode(PERM.compra.receber);

  const consulta = useQuery({
    queryKey: ['compras', 'fornecedores', mostrarInativos],
    queryFn: () =>
      pedir<Fornecedor[]>(`/compras/fornecedores${mostrarInativos ? '?incluirInativos=true' : ''}`),
  });

  function fechar() {
    setCriando(false);
    setEditando(null);
    setRascunho(VAZIO);
    setErro(null);
  }

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: rascunho.nome.trim(),
        ...(rascunho.documento.trim() ? { documento: rascunho.documento.trim() } : {}),
        ...(rascunho.email.trim() ? { email: rascunho.email.trim() } : {}),
        ...(rascunho.telefone.trim() ? { telefone: rascunho.telefone.trim() } : {}),
      };

      return editando
        ? pedir<Fornecedor>(`/compras/fornecedores/${editando}`, { method: 'PUT', body: corpo })
        : pedir<Fornecedor>('/compras/fornecedores', { method: 'POST', body: corpo });
    },
    onSuccess: async () => {
      fechar();
      await fila.invalidateQueries({ queryKey: ['compras'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  const alternarAtivo = useMutation({
    mutationFn: (f: Fornecedor) =>
      pedir<Fornecedor>(`/compras/fornecedores/${f.id}`, {
        method: 'PUT',
        body: { ativo: !f.ativo },
      }),
    onSuccess: async () => {
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['compras'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  const lista = consulta.data ?? [];
  const inativos = lista.filter((f) => !f.ativo).length;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Fornecedores</span>
        <div className="flex-1" />
        {podeEditar ? (
          <Botao
            variante="primario"
            onClick={() => {
              fechar();
              setCriando(true);
            }}
          >
            Novo fornecedor
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Fornecedores
          </h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            De quem a loja compra — é a lista que a{' '}
            <strong className="font-semibold text-neutral-700">nova entrada</strong> oferece
          </p>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        ) : null}

        {criando || editando ? (
          <section className="flex flex-col gap-3 rounded-md border border-primary-100 bg-primary-50 p-4">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              {editando ? 'Editar fornecedor' : 'Novo fornecedor'}
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  Nome
                </span>
                <input
                  value={rascunho.nome}
                  onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                  autoFocus
                  placeholder="Kimonos BR Indústria"
                  className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  CNPJ / CPF
                </span>
                <input
                  value={rascunho.documento}
                  onChange={(e) => setRascunho({ ...rascunho, documento: e.target.value })}
                  placeholder="12345678000190"
                  className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 font-mono text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  Telefone
                </span>
                <input
                  value={rascunho.telefone}
                  onChange={(e) => setRascunho({ ...rascunho, telefone: e.target.value })}
                  className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                />
              </label>

              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  E-mail
                </span>
                <input
                  value={rascunho.email}
                  onChange={(e) => setRascunho({ ...rascunho, email: e.target.value })}
                  placeholder="comercial@fornecedor.com.br"
                  className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                />
              </label>
            </div>

            {/* O documento é único por empresa: o banco recusa o repetido, e é
                ele que impede o mesmo fornecedor cadastrado duas vezes com
                nomes ligeiramente diferentes. */}
            <p className="text-[11.5px] leading-4 text-neutral-600">
              O documento é único: o banco recusa o repetido, e é ele que impede o mesmo fornecedor
              entrar duas vezes com nomes ligeiramente diferentes.
            </p>

            <div className="flex gap-2">
              <Botao
                variante="primario"
                carregando={salvar.isPending}
                disabled={rascunho.nome.trim().length < 2}
                onClick={() => salvar.mutate()}
              >
                {editando ? 'Salvar' : 'Cadastrar'}
              </Botao>
              <Botao variante="secundario" onClick={fechar}>
                Cancelar
              </Botao>
            </div>
          </section>
        ) : null}

        {consulta.isPending ? <EstadoCarregando titulo="Carregando fornecedores…" /> : null}

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

        {consulta.data && lista.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum fornecedor ainda"
            descricao="Cadastre de quem a loja compra — sem isso, a nova entrada não tem o que oferecer."
          />
        ) : null}

        {lista.length > 0 ? (
          <section className="overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
            <div className="hidden grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_150px_120px] items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid">
              <Coluna>Nome</Coluna>
              <Coluna>Documento</Coluna>
              <Coluna>E-mail</Coluna>
              <Coluna>Telefone</Coluna>
              <span />
            </div>

            {lista.map((f) => (
              <div
                key={f.id}
                className={juntar(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 last:border-0 lg:grid lg:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_150px_120px]',
                  !f.ativo && 'bg-neutral-25',
                )}
              >
                <span className="min-w-0 flex-1 truncate lg:flex-none">
                  <span
                    className={juntar(
                      'text-[13.5px]',
                      f.ativo ? 'text-neutral-900' : 'text-neutral-500',
                    )}
                  >
                    {f.nome}
                  </span>
                  {!f.ativo ? (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
                      desativado
                    </span>
                  ) : null}
                </span>

                <span className="font-mono text-[12.5px] text-neutral-600">
                  {f.documento ?? '—'}
                </span>
                <span className="min-w-0 truncate text-[12.5px] text-neutral-600">
                  {f.email ?? '—'}
                </span>
                <span className="text-[12.5px] text-neutral-600">{f.telefone ?? '—'}</span>

                {podeEditar ? (
                  <span className="ml-auto flex gap-1.5 lg:ml-0 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setCriando(false);
                        setEditando(f.id);
                        setErro(null);
                        setRascunho({
                          nome: f.nome,
                          documento: f.documento ?? '',
                          email: f.email ?? '',
                          telefone: f.telefone ?? '',
                        });
                      }}
                      className="h-7 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-700 hover:border-neutral-300"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={alternarAtivo.isPending}
                      onClick={() => alternarAtivo.mutate(f)}
                      className="h-7 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-500 hover:border-neutral-300"
                    >
                      {f.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {/*
          Tela que lista tudo, inclusive o desativado, empurra o que importa
          para fora da vista. Filtra por ativo e oferece mostrar o resto.
        */}
        <button
          type="button"
          onClick={() => setMostrarInativos(!mostrarInativos)}
          className="w-fit text-[12.5px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
        >
          {mostrarInativos
            ? `Esconder desativados${inativos > 0 ? ` (${String(inativos)})` : ''}`
            : 'Mostrar desativados'}
        </button>
      </main>
    </>
  );
}

function Coluna({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
      {children}
    </span>
  );
}
