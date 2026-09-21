import {
  type ApoioEquipe,
  type Perfil,
  type Usuario,
  type UsuarioCriado,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/**
 * Cadastro e edição de quem entra no sistema.
 *
 * **Perfil diz o que a pessoa PODE; loja diz ONDE.** São as mesmas perguntas
 * separadas que `@Permissoes()` e `@EscopoLoja()` fazem no servidor, e por
 * isso a tela também as separa.
 *
 * A senha o servidor gera, mostra **uma vez** e guarda só o hash. Poder
 * mostrar de novo significaria ter guardado — e quem cadastra não digita senha
 * de terceiro.
 */
export function UsuarioEditar() {
  const { id } = useParams();
  const novo = !id;
  const navegar = useNavigate();
  const fila = useQueryClient();

  const apoio = useQuery({
    queryKey: ['equipe', 'apoio'],
    queryFn: () => pedir<ApoioEquipe>('/equipe/apoio'),
  });

  const existente = useQuery({
    queryKey: ['equipe', 'detalhe', id],
    enabled: !novo,
    queryFn: () => pedir<Usuario>(`/equipe/${String(id)}`),
  });

  if (apoio.isPending || (!novo && existente.isPending)) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoCarregando titulo="Carregando…" />
      </main>
    );
  }

  const falhou = apoio.error ?? existente.error;

  if (falhou || !apoio.data || (!novo && !existente.data)) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoErro
          titulo="Não foi possível abrir o cadastro"
          descricao={
            falhou instanceof ErroRequisicao
              ? falhou.corpo.mensagem
              : 'Tente novamente em instantes.'
          }
          aoTentarNovamente={() => {
            void apoio.refetch();
            if (!novo) void existente.refetch();
          }}
        />
      </main>
    );
  }

  return (
    <Corpo
      apoio={apoio.data}
      usuario={existente.data ?? null}
      aoSalvar={async () => {
        await fila.invalidateQueries({ queryKey: ['equipe'] });
      }}
      aoSair={() => navegar('/equipe')}
    />
  );
}

function Corpo({
  apoio,
  usuario,
  aoSalvar,
  aoSair,
}: {
  readonly apoio: ApoioEquipe;
  readonly usuario: Usuario | null;
  readonly aoSalvar: () => Promise<void>;
  readonly aoSair: () => void;
}) {
  const novo = usuario === null;

  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [perfilIds, setPerfilIds] = useState<string[]>(usuario?.perfis.map((p) => p.id) ?? []);
  const [lojaIds, setLojaIds] = useState<string[]>(usuario?.lojas.map((l) => l.id) ?? []);
  const [erro, setErro] = useState<string | null>(null);

  /** A senha aparece UMA vez, depois de criar ou redefinir. */
  const [senha, setSenha] = useState<string | null>(null);

  const alternar = (lista: string[], valor: string): string[] =>
    lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];

  const salvar = useMutation({
    mutationFn: async () => {
      if (novo) {
        const criado = await pedir<UsuarioCriado>('/equipe', {
          method: 'POST',
          body: { nome: nome.trim(), email: email.trim(), perfilIds, lojaIds },
        });
        return criado.senhaProvisoria;
      }

      await pedir<Usuario>(`/equipe/${usuario.id}`, {
        method: 'PUT',
        body: { nome: nome.trim(), perfilIds, lojaIds },
      });
      return null;
    },
    onSuccess: async (senhaProvisoria) => {
      setErro(null);
      await aoSalvar();
      if (senhaProvisoria) setSenha(senhaProvisoria);
      else aoSair();
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  const redefinir = useMutation({
    mutationFn: () =>
      pedir<{ senhaProvisoria: string }>(`/equipe/${String(usuario?.id)}/senha`, {
        method: 'POST',
      }),
    onSuccess: (r) => {
      setErro(null);
      setSenha(r.senhaProvisoria);
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível redefinir.');
    },
  });

  const faltaPerfil = perfilIds.length === 0;
  const faltaLoja = lojaIds.length === 0;
  const podeSalvar =
    nome.trim().length >= 2 &&
    (novo ? email.trim().length > 3 && !faltaPerfil && !faltaLoja : true);

  const perfisEscolhidos = apoio.perfis.filter((p) => perfilIds.includes(p.id));

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <Link to="/equipe" className="text-[13.5px] text-neutral-500 no-underline hover:underline">
          Equipe
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-[13.5px] font-medium text-neutral-900">
          {novo ? 'Novo usuário' : usuario.nome}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            {novo ? 'Novo usuário' : 'Editar usuário'}
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            Perfil diz o que a pessoa{' '}
            <strong className="font-semibold text-neutral-900">pode</strong>; loja diz{' '}
            <strong className="font-semibold text-neutral-900">onde</strong>. São perguntas
            diferentes
          </p>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        ) : null}

        {/*
          O aviso só aparece quando o problema existe. Numa edição dá para
          ficar sem perfil ou sem loja — a criação não deixa.
        */}
        {!novo && (faltaPerfil || faltaLoja) ? (
          <Aviso tom="perigo" titulo="Assim esta pessoa entra e não vê nada">
            {faltaLoja
              ? 'Nenhuma loja marcada não significa "todas" — significa nenhuma, e as telas vêm vazias sem erro em lugar nenhum. '
              : ''}
            {faltaPerfil ? 'Sem perfil, nenhum menu aparece. ' : ''}
            Ela continua conseguindo entrar.
          </Aviso>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-3.5 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <section className="shrink-0 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                Quem é
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Nome
                  </span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    autoFocus
                    className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    E-mail
                  </span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!novo}
                    className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px] disabled:bg-neutral-25 disabled:text-neutral-500"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11.5px] leading-4 text-neutral-400">
                {novo
                  ? 'O e-mail é o login, e é único entre todas as empresas do domínio de funcionário — é o que permite a tela de entrada pedir só e-mail e senha.'
                  : 'O e-mail não muda: ele é a chave do login e está registrado no diretório de credenciais.'}
              </p>
            </section>

            <section className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                  Perfis
                </p>
                <Link to="/equipe/perfis" className="text-[12px] no-underline hover:underline">
                  Ver o que cada um pode
                </Link>
              </div>

              <div className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2">
                {apoio.perfis.map((p) => (
                  <CartaoPerfil
                    key={p.id}
                    perfil={p}
                    marcado={perfilIds.includes(p.id)}
                    aoMarcar={() => setPerfilIds(alternar(perfilIds, p.id))}
                  />
                ))}
              </div>
            </section>

            <section className="shrink-0 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
              <div className="mb-2.5 flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                  Lojas
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setLojaIds(
                      lojaIds.length === apoio.lojas.length ? [] : apoio.lojas.map((l) => l.id),
                    )
                  }
                  className="text-[12px] text-primary-600 hover:underline"
                >
                  {lojaIds.length === apoio.lojas.length ? 'Desmarcar todas' : 'Marcar todas'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {apoio.lojas.map((l) => {
                  const marcada = lojaIds.includes(l.id);
                  return (
                    <label
                      key={l.id}
                      className={juntar(
                        'flex h-[34px] cursor-pointer items-center gap-2.5 rounded-md border px-3',
                        marcada
                          ? 'border-primary-100 bg-primary-50'
                          : 'border-neutral-100 bg-white',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => setLojaIds(alternar(lojaIds, l.id))}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <span className="text-[13px] text-neutral-900">{l.nome}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm lg:w-[352px]">
            <div className="shrink-0 border-b border-neutral-100 px-4 py-3">
              <h2 className="font-display text-[15px] font-bold text-neutral-900">
                Senha de entrada
              </h2>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {senha ? (
                <SenhaGerada senha={senha} />
              ) : novo ? (
                <p className="text-[12.5px] leading-[18px] text-neutral-500">
                  O servidor gera a senha ao criar o usuário e mostra aqui{' '}
                  <strong className="font-semibold text-neutral-700">uma única vez</strong>.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[12.5px] leading-[18px] text-neutral-500">
                    Só o hash está guardado, então não há como mostrar a senha atual. Se ela se
                    perdeu, gere outra.
                  </p>
                  <Botao
                    variante="secundario"
                    carregando={redefinir.isPending}
                    onClick={() => redefinir.mutate()}
                  >
                    Gerar nova senha
                  </Botao>
                  <p className="text-[11.5px] leading-4 text-neutral-400">
                    Redefinir{' '}
                    <strong className="font-semibold text-neutral-600">
                      derruba as sessões abertas
                    </strong>
                    : redefine-se porque a senha pode ter vazado, e a sessão aberta sobreviveria à
                    troca.
                  </p>
                </div>
              )}

              {novo ? (
                <div className="mt-4 flex flex-col gap-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                    O que vai ser criado
                  </p>
                  <Item feito={nome.trim().length >= 2 && email.trim().length > 3}>
                    O usuário <span className="text-neutral-400">· nome, e-mail e o hash</span>
                  </Item>
                  <Item feito>
                    A credencial de login{' '}
                    <span className="text-neutral-400">· sem ela a senha não autentica</span>
                  </Item>
                  <Item feito={!faltaPerfil}>
                    {perfisEscolhidos.length > 0
                      ? `${String(perfisEscolhidos.length)} perfil${perfisEscolhidos.length > 1 ? 's' : ''}`
                      : 'Nenhum perfil'}{' '}
                    <span className="text-neutral-400">
                      ·{' '}
                      {perfisEscolhidos.length > 0
                        ? `${perfisEscolhidos.map((p) => p.nome).join(', ')} — ${String(new Set(perfisEscolhidos.flatMap((p) => p.permissoes)).size)} permissões`
                        : 'obrigatório'}
                    </span>
                  </Item>
                  <Item feito={!faltaLoja}>
                    {lojaIds.length > 0 ? `${String(lojaIds.length)} loja(s)` : 'Nenhuma loja'}{' '}
                    <span className="text-neutral-400">
                      · {lojaIds.length > 0 ? 'onde ela enxerga' : 'obrigatório'}
                    </span>
                  </Item>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                    Tudo numa transação só. Usuário gravado sem credencial é gente que não consegue
                    entrar.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-neutral-100 px-4 py-3">
              {senha && novo ? (
                <Botao variante="primario" onClick={aoSair}>
                  Concluir
                </Botao>
              ) : (
                <Botao
                  variante="primario"
                  carregando={salvar.isPending}
                  disabled={!podeSalvar}
                  onClick={() => salvar.mutate()}
                >
                  {novo ? 'Criar usuário' : 'Salvar'}
                </Botao>
              )}
              <button
                type="button"
                onClick={aoSair}
                className="h-8 text-[12.5px] text-neutral-500 hover:text-neutral-700"
              >
                {senha && novo ? 'Voltar para a equipe' : 'Cancelar'}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function SenhaGerada({ senha }: { readonly senha: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-md border border-primary-100 bg-primary-50 px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-primary-800">
          Senha provisória
        </p>
        <p className="mt-1.5 font-mono text-[20px] font-medium tracking-[0.06em] text-neutral-900">
          {senha}
        </p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(senha).then(() => setCopiado(true));
          }}
          className="mt-2 h-[30px] rounded-md border border-primary-100 bg-white px-2.5 text-[12.5px] text-primary-800"
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="text-[11.5px] leading-4 text-[var(--color-atencao)]">
        <strong className="font-semibold">Esta tela não mostra de novo.</strong> O servidor guarda
        só o hash — poder mostrar outra vez significaria ter guardado a senha. Perdeu? Gere outra.
      </p>
    </div>
  );
}

function Item({
  feito,
  children,
}: {
  readonly feito: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={juntar(
          'mt-0.5 shrink-0',
          feito ? 'text-[var(--color-sucesso)]' : 'text-neutral-300',
        )}
        aria-hidden="true"
      >
        {feito ? <path d="M20 6 9 17l-5-5" /> : <circle cx="12" cy="12" r="9" />}
      </svg>
      <span className="text-[12.5px] leading-[17px] text-neutral-700">{children}</span>
    </div>
  );
}

function CartaoPerfil({
  perfil,
  marcado,
  aoMarcar,
}: {
  readonly perfil: Perfil;
  readonly marcado: boolean;
  readonly aoMarcar: () => void;
}) {
  return (
    <label
      className={juntar(
        'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5',
        marcado ? 'border-primary-100 bg-primary-50' : 'border-neutral-100 bg-white',
      )}
    >
      <input
        type="checkbox"
        checked={marcado}
        onChange={aoMarcar}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-neutral-900">{perfil.nome}</span>
        <span className="mt-0.5 block text-[11.5px] leading-4 text-neutral-500">
          {perfil.descricao ?? 'Sem descrição'}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] text-neutral-400">
        {perfil.permissoes.length}
      </span>
    </label>
  );
}
