import type { EmpresaDetalhe, SenhaAdminRedefinida, SessaoSuporte } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Tom por ação da plataforma. Lista explícita: ação nova não vira cor por engano. */
const TOM_ACAO: Record<string, string> = {
  PLATAFORMA_CRIOU: 'bg-neutral-100 text-neutral-700',
  PLATAFORMA_ENTROU: 'bg-[#fdf5f5] text-[var(--color-perigo)]',
  PLATAFORMA_SUSPENDEU: 'bg-[#fdf5f5] text-[var(--color-perigo)]',
  PLATAFORMA_REATIVOU: 'bg-[#e6f1eb] text-[#155537]',
  PLATAFORMA_SENHA_ADMIN: 'bg-[#fefbf3] text-[var(--color-atencao)]',
  PLATAFORMA_EXCLUIU: 'bg-[#fdf5f5] text-[var(--color-perigo)]',
};

function Dado({
  rotulo,
  valor,
  mono = false,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-0.5 truncate text-[13.5px] text-neutral-900',
          mono && 'font-mono text-[12.5px]',
        )}
      >
        {valor}
      </p>
    </div>
  );
}

/**
 * Uma empresa, vista de fora.
 *
 * As três ações perigosas pedem **motivo escrito**, e o motivo vai para o
 * `audit_log` DA EMPRESA — não para um diário da plataforma. Trilha que só o
 * visitante lê não é trilha.
 *
 * Cada motivo é digitado na própria tela. `window.prompt` não tem o estilo,
 * nem o foco, nem o celular.
 */
export function PlataformaEmpresa() {
  const { id = '' } = useParams();
  const fila = useQueryClient();

  const [aberta, setAberta] = useState<'suporte' | 'senha' | 'situacao' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [senhaNova, setSenhaNova] = useState<SenhaAdminRedefinida | null>(null);
  const [suporte, setSuporte] = useState<SessaoSuporte | null>(null);

  const consulta = useQuery({
    queryKey: ['plataforma', 'empresa', id],
    queryFn: () => pedir<EmpresaDetalhe>(`/plataforma/empresas/${id}`),
  });

  const empresa = consulta.data;

  /* O painel não remonta ao trocar de empresa: a rota é a mesma, muda o
     parâmetro. O estado carrega o id do dono. */
  const [dono, setDono] = useState(id);
  if (dono !== id) {
    setDono(id);
    setAberta(null);
    setMotivo('');
    setErro(null);
    setSenhaNova(null);
    setSuporte(null);
  }

  const fechar = () => {
    setAberta(null);
    setMotivo('');
  };

  const aoFalhar = (e: unknown) => {
    setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
  };

  const situacao = useMutation({
    mutationFn: () =>
      pedir(
        `/plataforma/empresas/${id}/${empresa?.status === 'ATIVO' ? 'suspender' : 'reativar'}`,
        {
          method: 'PUT',
          body: { motivo: motivo.trim() },
        },
      ),
    onSuccess: async () => {
      setErro(null);
      fechar();
      await fila.invalidateQueries({ queryKey: ['plataforma'] });
    },
    onError: aoFalhar,
  });

  const redefinir = useMutation({
    mutationFn: () =>
      pedir<SenhaAdminRedefinida>(`/plataforma/empresas/${id}/senha-admin`, {
        method: 'POST',
        body: { usuarioId: empresa?.administradores[0]?.id, motivo: motivo.trim() },
      }),
    onSuccess: async (r) => {
      setErro(null);
      setSenhaNova(r);
      fechar();
      await fila.invalidateQueries({ queryKey: ['plataforma'] });
    },
    onError: aoFalhar,
  });

  const entrarSuporte = useMutation({
    mutationFn: () =>
      pedir<SessaoSuporte>(`/plataforma/empresas/${id}/suporte`, {
        method: 'POST',
        body: { motivo: motivo.trim() },
      }),
    onSuccess: async (r) => {
      setErro(null);
      setSuporte(r);
      fechar();
      await fila.invalidateQueries({ queryKey: ['plataforma'] });
    },
    onError: aoFalhar,
  });

  if (consulta.isPending) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoCarregando titulo="Carregando a empresa…" />
      </main>
    );
  }

  if (consulta.isError || !empresa) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoErro
          titulo="Não foi possível abrir a empresa"
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

  const ativa = empresa.status === 'ATIVO';
  const admin = empresa.administradores[0];
  const minimoMotivo = aberta === 'suporte' ? 15 : 5;
  const motivoPronto = motivo.trim().length >= minimoMotivo;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Link
          to="/plataforma"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Empresas
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-[13.5px] font-medium text-neutral-900">{empresa.nome}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
          {empresa.nome}
        </h1>
        <span className="rounded bg-neutral-50 px-2 py-0.5 font-mono text-[12.5px] text-neutral-500">
          {empresa.slug}
        </span>
        <span
          className={juntar(
            'inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] font-semibold',
            ativa ? 'bg-[#e6f1eb] text-[#155537]' : 'bg-[#fdf5f5] text-[var(--color-perigo)]',
          )}
        >
          {ativa ? 'Ativa' : 'Suspensa'}
        </span>
      </div>

      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível concluir">
          {erro}
        </Aviso>
      ) : null}

      {empresa.lojas === 0 ? (
        <Aviso tom="atencao" titulo="Esta empresa não tem nenhuma loja">
          Quem entra vê telas vazias — é o estado <em>inerte</em>. O administrador consegue criar a
          primeira; enquanto não criar, o sistema parece quebrado para ele.
        </Aviso>
      ) : null}

      {senhaNova ? (
        <Aviso tom="atencao" titulo="Senha redefinida — ela aparece uma vez">
          <span className="select-all font-mono text-[14px] text-neutral-900">
            {senhaNova.senhaProvisoria}
          </span>{' '}
          para <strong className="font-semibold">{senhaNova.usuario.nome}</strong> (
          {senhaNova.usuario.email}). {senhaNova.sessoesRevogadas}{' '}
          {senhaNova.sessoesRevogadas === 1 ? 'sessão caiu' : 'sessões caíram'} junto — redefine-se
          porque a senha pode ter vazado, e a sessão aberta sobreviveria à troca.
        </Aviso>
      ) : null}

      {suporte ? (
        <Aviso tom="perigo" titulo="Sessão de suporte aberta">
          Em nome de <strong className="font-semibold">{suporte.comoUsuario.nome}</strong>, até{' '}
          {dataHora(suporte.expiraEm)}. A entrada está registrada na auditoria desta empresa, com o
          motivo — e a tela dela avisa que quem está ali não é o dono da conta.
        </Aviso>
      ) : null}

      <div className="flex flex-col items-stretch gap-3.5 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Dado rotulo="CNPJ" valor={empresa.documento ?? '—'} mono />
              <Dado rotulo="Criada em" valor={data(empresa.criadoEm)} />
              <Dado rotulo="Fuso horário" valor={empresa.fusoHorario ?? '—'} mono />
              <Dado rotulo="Moeda" valor={empresa.moeda ?? '—'} mono />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-neutral-50 pt-3.5 sm:grid-cols-4">
              <Dado rotulo="Lojas" valor={String(empresa.lojas)} />
              <Dado rotulo="Usuários" valor={String(empresa.usuarios)} />
              <Dado rotulo="Produtos" valor={String(empresa.produtos)} />
              <Dado
                rotulo="Última venda"
                valor={empresa.ultimaVenda ? dataHora(empresa.ultimaVenda) : 'nenhuma ainda'}
              />
            </div>
          </section>

          <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-4 pb-2.5 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                O que a plataforma já fez nesta empresa
              </p>
              <p className="mt-0.5 text-[12px] text-neutral-400">
                Toda ação daqui vira registro. É o que separa “suporte” de “alguém entrou e ninguém
                sabe”.
              </p>
            </div>

            {empresa.auditoria.length === 0 ? (
              /*
                "Nada além da criação" seria mentira nas empresas que nasceram
                pelo SEED: a plataforma não as criou, então não há nem esse
                registro. O vazio diz o que é verdade nos dois casos.
              */
              <p className="px-4 py-6 text-center text-[12.5px] text-neutral-400">
                A plataforma nunca agiu nesta empresa.
              </p>
            ) : (
              empresa.auditoria.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5"
                >
                  <span className="shrink-0 font-mono text-[12px] text-neutral-400">
                    {dataHora(r.criadoEm)}
                  </span>
                  <span
                    className={juntar(
                      'inline-flex h-5 shrink-0 items-center rounded-full px-2.5 font-mono text-[10.5px] font-medium',
                      TOM_ACAO[r.acao] ?? 'bg-neutral-100 text-neutral-700',
                    )}
                  >
                    {r.acao}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700">
                    {r.atorNome ?? 'plataforma'}
                    {r.motivo ? ` · ${r.motivo}` : ''}
                  </span>
                </div>
              ))
            )}

            <div className="bg-neutral-25 px-4 py-2.5 text-[12.5px] text-neutral-500">
              <strong className="font-semibold text-neutral-700">
                {empresa.auditoria.length}{' '}
                {empresa.auditoria.length === 1 ? 'registro' : 'registros'}
              </strong>{' '}
              · a empresa existe desde {data(empresa.criadoEm)}
            </div>
          </section>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[352px]">
          <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              Ações
            </p>

            <Acao
              titulo="Entrar para suporte"
              texto="Abre uma sessão marcada nesta empresa, por 30 minutos. Exige motivo com o caso concreto."
              rotulo="Entrar"
              perigo
              desabilitado={!ativa}
              motivoDesabilitado={
                ativa ? undefined : 'Empresa suspensa não recebe suporte — reative antes.'
              }
              aoClicar={() => {
                setAberta('suporte');
                setMotivo('');
              }}
            />

            <Acao
              titulo="Redefinir a senha do administrador"
              texto={
                admin
                  ? `Gera uma senha nova para ${admin.nome} e derruba as sessões dele.`
                  : 'Esta empresa não tem administrador ativo.'
              }
              rotulo="Redefinir"
              desabilitado={!admin}
              motivoDesabilitado={
                admin ? undefined : 'Sem administrador ativo, não há a quem redefinir.'
              }
              aoClicar={() => {
                setAberta('senha');
                setMotivo('');
              }}
            />

            <Acao
              titulo={ativa ? 'Suspender a empresa' : 'Reativar a empresa'}
              texto={
                ativa
                  ? 'Bloqueia o login de todos. Nada é apagado, e reativar devolve tudo.'
                  : 'Devolve o login a todo mundo da empresa.'
              }
              rotulo={ativa ? 'Suspender' : 'Reativar'}
              perigo={ativa}
              ultima
              aoClicar={() => {
                setAberta('situacao');
                setMotivo('');
              }}
            />
          </section>

          {aberta ? (
            <section className="rounded-md border border-primary-100 bg-primary-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-primary-800">
                Por quê?
              </p>
              <p className="mb-2 mt-0.5 text-[12px] leading-4 text-primary-800">
                {aberta === 'suporte'
                  ? '“Investigar” não é motivo. Diga o caso: o que o cliente relatou, qual venda, qual item.'
                  : 'Vai para a auditoria desta empresa, e é o que quem ler depois vai encontrar.'}
              </p>
              <textarea
                value={motivo}
                autoFocus
                rows={3}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full resize-none rounded-md border border-primary-200 bg-white px-2.5 py-2 text-[13px] text-neutral-900 outline-none focus:border-primary-400"
              />
              <p className="mt-1 text-[11.5px] text-primary-800">
                {motivo.trim().length} de {minimoMotivo} caracteres no mínimo
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Botao
                  variante="primario"
                  disabled={!motivoPronto}
                  carregando={situacao.isPending || redefinir.isPending || entrarSuporte.isPending}
                  onClick={() => {
                    if (aberta === 'suporte') entrarSuporte.mutate();
                    else if (aberta === 'senha') redefinir.mutate();
                    else situacao.mutate();
                  }}
                >
                  Confirmar
                </Botao>
                <button
                  type="button"
                  onClick={fechar}
                  className="h-9 rounded-md border border-neutral-200 bg-white px-3.5 text-[13px] text-neutral-600"
                >
                  Cancelar
                </button>
              </div>
            </section>
          ) : null}

          <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              Quem administra
            </p>
            <p className="mb-2 mt-0.5 text-[12px] text-neutral-400">
              {empresa.administradores.length} de {empresa.usuarios}{' '}
              {empresa.usuarios === 1 ? 'usuário tem' : 'usuários têm'} o perfil Administrador da
              empresa.
            </p>
            {empresa.administradores.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 border-t border-neutral-50 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-neutral-900">{a.nome}</span>
                  <span className="block truncate text-[11.5px] text-neutral-400">{a.email}</span>
                </span>
                <span className="shrink-0 text-[11.5px] text-neutral-400">
                  {a.ultimoLoginEm ? data(a.ultimoLoginEm) : 'nunca entrou'}
                </span>
              </div>
            ))}
          </section>

          <Aviso tom="perigo" titulo="Entrar para suporte é ver dado de cliente">
            A sessão nasce marcada, dura 30 minutos e aparece para a empresa no registro de
            auditoria dela. Ver dado sem ninguém saber é o que esta tela existe para impedir.
          </Aviso>
        </aside>
      </div>
    </main>
  );
}

function Acao({
  titulo,
  texto,
  rotulo,
  aoClicar,
  perigo = false,
  desabilitado = false,
  motivoDesabilitado,
  ultima = false,
}: {
  readonly titulo: string;
  readonly texto: string;
  readonly rotulo: string;
  readonly aoClicar: () => void;
  readonly perigo?: boolean;
  readonly desabilitado?: boolean;
  readonly motivoDesabilitado?: string;
  readonly ultima?: boolean;
}) {
  return (
    <div className={juntar('flex items-start gap-3 py-3', !ultima && 'border-b border-neutral-50')}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-neutral-900">{titulo}</p>
        <p className="mt-0.5 text-[12px] leading-[17px] text-neutral-500">{texto}</p>
        {/*
          O motivo do bloqueio é ELEMENTO VISÍVEL, não `title`: no celular não
          há hover, e um botão cinza sem explicação parece defeito.
        */}
        {desabilitado && motivoDesabilitado ? (
          <p className="mt-1 text-[11.5px] leading-4 text-[var(--color-atencao)]">
            {motivoDesabilitado}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={desabilitado}
        onClick={aoClicar}
        className={juntar(
          'h-[30px] shrink-0 rounded-md border px-3 text-[12.5px] disabled:opacity-40',
          perigo
            ? 'border-[#f0c9cb] text-[var(--color-perigo)]'
            : 'border-neutral-200 text-neutral-700',
        )}
      >
        {rotulo}
      </button>
    </div>
  );
}
