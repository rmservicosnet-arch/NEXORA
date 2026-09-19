import { PERM, type PaginaClientes } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

export function Clientes() {
  const { pode } = useSessao();
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [soSemTabela, setSoSemTabela] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = useQuery({
    queryKey: ['clientes', busca, soSemTabela],
    queryFn: () =>
      pedir<PaginaClientes>(
        `/clientes?limite=50${busca ? `&busca=${encodeURIComponent(busca)}` : ''}` +
          (soSemTabela ? '&semTabela=true' : ''),
      ),
  });

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <h1 className="font-display text-[15px] font-semibold text-neutral-900">Clientes</h1>
        <div className="hidden flex-1 sm:block" />
        {consulta.data ? (
          <span className="text-[12.5px] text-neutral-500">
            {consulta.data.total} {consulta.data.total === 1 ? 'cadastro' : 'cadastros'}
          </span>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[22px] font-bold text-neutral-900">
              Cadastros e tabela de preço
            </h2>
            <p className="text-[13px] leading-[19px] text-neutral-500">
              A tabela vinculada aqui decide o catálogo e o preço que este cliente vê no portal.
            </p>
          </div>

          {/*
            O aviso conta os ATIVOS sem tabela, não o resultado da busca.
            Cadastro sem tabela não dá erro em lugar nenhum: ele simplesmente
            abre o portal e não encontra nada — e ninguém descobre até o
            cliente telefonar.
          */}
          {consulta.data && consulta.data.semTabela > 0 && !soSemTabela ? (
            <Aviso tom="atencao" titulo="Cadastros sem tabela de preço">
              {consulta.data.semTabela}{' '}
              {consulta.data.semTabela === 1
                ? 'cadastro ativo não tem tabela e vê o catálogo vazio'
                : 'cadastros ativos não têm tabela e veem o catálogo vazio'}
              .{' '}
              <button
                type="button"
                onClick={() => setSoSemTabela(true)}
                className="font-semibold underline underline-offset-2"
              >
                Ver quais
              </button>
            </Aviso>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar por nome, documento ou e-mail"
              aria-label="Buscar cadastros"
              className="h-10 min-w-[220px] flex-1 rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
            />
            <button
              type="button"
              onClick={() => setSoSemTabela((v) => !v)}
              className={juntar(
                'h-10 rounded-md border px-3 text-[13px] font-medium',
                soSemTabela
                  ? 'border-[--color-atencao] bg-[--color-atencao-fundo] text-[--color-atencao]'
                  : 'border-neutral-200 bg-white text-neutral-600',
              )}
            >
              Sem tabela
            </button>
          </div>

          {consulta.isPending ? <EstadoCarregando titulo="Carregando cadastros…" /> : null}

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

          {consulta.data?.itens.length === 0 ? (
            <EstadoVazio
              titulo={soSemTabela ? 'Nenhum cadastro sem tabela' : 'Nenhum cadastro encontrado'}
              descricao={
                soSemTabela
                  ? 'Todos os cadastros ativos têm tabela de preço.'
                  : 'Ajuste a busca ou cadastre um cliente.'
              }
            />
          ) : null}

          {consulta.data && consulta.data.itens.length > 0 ? (
            <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              {consulta.data.itens.map((c) => (
                <Link
                  key={c.id}
                  to={pode(PERM.cliente.editar) ? `/clientes/${c.id}` : '#'}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-3 no-underline last:border-0 hover:bg-neutral-25"
                >
                  <div className="order-1 min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-neutral-900">{c.nome}</p>
                    <p className="truncate text-[11.5px] text-neutral-500">
                      {c.documento ?? c.email ?? 'sem documento'}
                    </p>
                  </div>

                  <span className="order-3 w-full sm:order-none sm:w-auto">
                    {c.tabelaPreco ? (
                      <span className="rounded bg-primary-50 px-2 py-0.5 text-[11.5px] font-semibold text-primary-700">
                        {c.tabelaPreco}
                      </span>
                    ) : (
                      <span className="rounded bg-[--color-atencao-fundo] px-2 py-0.5 text-[11.5px] font-semibold text-[--color-atencao]">
                        sem tabela
                      </span>
                    )}
                  </span>

                  <span className="order-4 text-[11.5px] text-neutral-500">
                    {c.acessos > 0
                      ? `${String(c.acessos)} ${c.acessos === 1 ? 'acesso' : 'acessos'}`
                      : 'sem acesso ao portal'}
                  </span>

                  {c.status === 'INATIVO' ? (
                    <span className="order-5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-600">
                      inativo
                    </span>
                  ) : null}
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
