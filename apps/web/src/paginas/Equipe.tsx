import { PERM, type PaginaUsuarios, type Usuario } from '@estoque/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/** Cor por perfil. Chave desconhecida cai no neutro — perfil novo não quebra. */
const TOM_PERFIL: Record<string, string> = {
  ADMIN_EMPRESA: 'bg-primary-50 text-primary-800 border-primary-100',
  GESTOR: 'bg-primary-50 text-primary-800 border-primary-100',
  VENDEDOR: 'bg-[#e6f1eb] text-[#155537] border-[#bfdccb]',
  ESTOQUISTA: 'bg-[#fbf0da] text-[#8f6206] border-[#ebd6a8]',
};

function quando(iso: string | null): string {
  if (!iso) return 'nunca entrou';

  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hora}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * A equipe: quem entra no sistema.
 *
 * Até aqui a equipe só existia pelo seed — o modelo estava completo desde a
 * Fase 1 e não havia rota nem tela. Ninguém conseguia admitir um funcionário.
 *
 * A faixa de aviso é o ponto da tela: gente que entra e **não consegue fazer
 * nada**. Sem perfil, nenhum menu aparece; sem loja, as telas vêm vazias — e
 * nenhuma loja não é "todas", é nenhuma. Nenhum dos dois dá erro em lugar
 * nenhum, então quem acabou de ser cadastrado acha que o sistema quebrou.
 */
export function Equipe() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeEditar = pode(PERM.usuario.editar);

  const consulta = useQuery({
    queryKey: ['equipe', 'lista', mostrarInativos],
    queryFn: () => pedir<PaginaUsuarios>(`/equipe${mostrarInativos ? '' : '?status=ATIVO'}`),
    placeholderData: keepPreviousData,
  });

  const alternar = useMutation({
    mutationFn: (u: Usuario) =>
      pedir<Usuario>(`/equipe/${u.id}`, {
        method: 'PUT',
        body: { status: u.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' },
      }),
    onSuccess: async () => {
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['equipe'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  const dados = consulta.data;
  const itens = dados?.itens ?? [];
  const inertes = itens.filter((u) => u.inerte);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Equipe</span>
        <div className="flex-1" />
        <Botao variante="secundario" comoFilho>
          <Link to="/equipe/perfis">Perfis e permissões</Link>
        </Botao>
        {pode(PERM.usuario.criar) ? (
          <Botao variante="primario" comoFilho>
            <Link to="/equipe/novo">Novo usuário</Link>
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">Equipe</h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            Quem entra no sistema, com qual{' '}
            <strong className="font-semibold text-neutral-900">perfil</strong> e em quais lojas
          </p>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        ) : null}

        {/*
          Um aviso só, com o número e os nomes. Uma faixa por pessoa viraria a
          parede de avisos que não chama atenção para nada.
        */}
        {inertes.length > 0 ? (
          <Aviso
            tom="atencao"
            titulo={`${String(inertes.length)} ${inertes.length === 1 ? 'pessoa consegue' : 'pessoas conseguem'} entrar e não ${inertes.length === 1 ? 'consegue' : 'conseguem'} fazer nada`}
          >
            {inertes.map((u, i) => (
              <span key={u.id}>
                {i > 0 ? '; ' : ''}
                <strong className="font-semibold">{u.nome}</strong>{' '}
                {u.perfis.length === 0 && u.lojas.length === 0
                  ? 'não tem perfil nem loja'
                  : u.perfis.length === 0
                    ? 'não tem perfil, então nenhum menu aparece'
                    : 'não tem loja, e sem loja as telas vêm vazias'}
              </span>
            ))}
            . Todos logam normalmente — não é erro, é ausência.
          </Aviso>
        ) : null}

        {consulta.isPending ? <EstadoCarregando titulo="Carregando a equipe…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar a equipe"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {dados && itens.length === 0 ? (
          <EstadoVazio
            titulo="Ninguém por aqui"
            descricao="Cadastre quem vai usar o sistema — sem usuário, só o administrador entra."
          />
        ) : null}

        {dados && itens.length > 0 ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-full lg:min-w-[900px]">
                <Cabecalho />
                {itens.map((u) => (
                  <Linha
                    key={u.id}
                    usuario={u}
                    podeEditar={podeEditar}
                    ocupado={alternar.isPending}
                    aoAlternar={() => alternar.mutate(u)}
                  />
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3">
              <span className="text-[12.5px] font-semibold text-neutral-700">
                {dados.contagens.ativos} {dados.contagens.ativos === 1 ? 'ativo' : 'ativos'}
                {dados.contagens.inativos > 0
                  ? ` · ${String(dados.contagens.inativos)} ${dados.contagens.inativos === 1 ? 'desativado' : 'desativados'}`
                  : ''}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setMostrarInativos(!mostrarInativos)}
                className="text-[12.5px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
              >
                {mostrarInativos ? 'Esconder desativados' : 'Mostrar desativados'}
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'lg:grid-cols-[minmax(0,1fr)_190px_170px_120px_110px_170px]';

function Cabecalho() {
  const colunas = ['Pessoa', 'Perfis', 'Lojas', 'Último acesso', 'Situação', ''];

  return (
    <div
      className={juntar(
        'sticky top-0 z-10 hidden gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={`${c}-${String(i)}`}
          className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/**
 * Duas lojas por extenso e o resto como número.
 *
 * Um administrador com 40 lojas transformava a coluna numa fita de nomes que
 * o `truncate` cortava no meio da terceira: dizia menos do que "+38" e ocupava
 * a linha inteira. O `title` guarda a lista completa — e só ele, porque aviso
 * de verdade não mora em `title`; aqui é consulta, não alerta.
 */
function lojasResumidas(lojas: readonly { readonly nome: string }[]): string {
  const nomes = lojas.map((l) => l.nome);
  if (nomes.length <= 2) return nomes.join(', ');
  return `${nomes.slice(0, 2).join(', ')} +${String(nomes.length - 2)}`;
}

function Falta({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-atencao)]">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" />
        <path d="M12 16.5h.01" />
      </svg>
      {children}
    </span>
  );
}

function Linha({
  usuario,
  podeEditar,
  ocupado,
  aoAlternar,
}: {
  readonly usuario: Usuario;
  readonly podeEditar: boolean;
  readonly ocupado: boolean;
  readonly aoAlternar: () => void;
}) {
  const ativo = usuario.status === 'ATIVO';

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 lg:grid',
        GRADE,
        !ativo && 'bg-neutral-25',
        usuario.inerte && 'bg-[#fefbf3]',
      )}
    >
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        <span
          className={juntar(
            'block truncate text-[13px]',
            ativo ? 'text-neutral-900' : 'text-neutral-500',
          )}
        >
          {usuario.nome}
        </span>
        <span className="block truncate text-[11.5px] text-neutral-500">{usuario.email}</span>
      </span>

      <span className="flex flex-wrap gap-1">
        {usuario.perfis.length === 0 ? (
          <Falta>sem perfil</Falta>
        ) : (
          usuario.perfis.map((p) => (
            <span
              key={p.id}
              className={juntar(
                'inline-flex h-5 items-center rounded-full border px-2.5 text-[11px] font-semibold',
                TOM_PERFIL[p.chave] ?? 'border-neutral-200 bg-neutral-50 text-neutral-600',
              )}
            >
              {p.nome}
            </span>
          ))
        )}
      </span>

      <span
        className="truncate text-[12.5px] text-neutral-500"
        title={usuario.lojas.map((l) => l.nome).join(', ')}
      >
        {usuario.lojas.length === 0 ? <Falta>nenhuma loja</Falta> : lojasResumidas(usuario.lojas)}
      </span>

      <span
        className={juntar(
          'text-[12.5px]',
          usuario.ultimoLoginEm ? 'text-neutral-500' : 'text-neutral-400',
        )}
      >
        {quando(usuario.ultimoLoginEm)}
      </span>

      <span>
        <span
          className={juntar(
            'inline-flex h-5 items-center rounded-full px-2.5 text-[11px] font-semibold',
            ativo ? 'bg-[#e6f1eb] text-[#155537]' : 'bg-neutral-100 text-neutral-500',
          )}
        >
          {ativo ? 'Ativo' : 'Desativado'}
        </span>
      </span>

      {podeEditar ? (
        <span className="ml-auto flex gap-1.5 lg:ml-0 lg:justify-end">
          <Link
            to={`/equipe/${usuario.id}`}
            className="flex h-7 items-center rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-700 no-underline hover:border-neutral-300"
          >
            Editar
          </Link>
          <button
            type="button"
            disabled={ocupado}
            onClick={aoAlternar}
            className="h-7 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-500 hover:border-neutral-300"
          >
            {ativo ? 'Desativar' : 'Reativar'}
          </button>
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}
