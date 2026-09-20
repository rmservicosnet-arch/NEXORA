import { PERM, type TabelaPreco } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

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
 *
 * A linha inteira abre os preços daquela tabela: é para isso que se entra
 * aqui. Preencher produto por produto, pela tela do produto, era o caminho
 * mais longo possível para a mesma coisa.
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

  const tabelas = consulta.data ?? [];
  const ativas = tabelas.filter((t) => t.status === 'ATIVO').length;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Tabelas de preço</span>
        <div className="flex-1" />
        {podeEditar && !criando ? (
          <Botao variante="primario" onClick={() => setCriando(true)}>
            <Mais />
            Nova tabela
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Tabelas de preço
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            {tabelas.length} {tabelas.length === 1 ? 'tabela' : 'tabelas'}
            {ativas !== tabelas.length ? ` · ${ativas} ativas` : ''} · a padrão vale para quem não
            tem tabela própria · desativar uma em uso deixa o cliente sem catálogo
          </p>
        </div>

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
              Ela nasce vazia. Enquanto não tiver preço, quem for vinculado a ela vê o catálogo sem
              nada.
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
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {consulta.isSuccess ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
            <div className="hidden shrink-0 grid-cols-[minmax(0,1fr)_140px_100px_100px_110px_200px] gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid">
              {['Tabela', 'Chave', 'Com preço', 'Sem preço', 'Clientes', 'Estado'].map((t, i) => (
                <span
                  key={t}
                  className={juntar(
                    'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                    i >= 2 && i <= 4 ? 'text-right' : '',
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tabelas.map((t) =>
                editando === t.id ? (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-end gap-2 border-b border-neutral-50 px-4 py-3"
                  >
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
                  <LinhaTabela
                    key={t.id}
                    tabela={t}
                    podeEditar={podeEditar}
                    aoRenomear={() => {
                      setEditando(t.id);
                      setNovoNome(t.nome);
                    }}
                    aoAlterar={(dados) => alterar.mutate({ id: t.id, dados })}
                  />
                ),
              )}
            </div>

            <div className="flex h-11 shrink-0 items-center gap-2 border-t border-neutral-100 bg-neutral-25 px-4">
              <span className="text-[var(--color-atencao)]">
                <Alerta />
              </span>
              <span className="text-[12.5px] text-[var(--color-atencao)]">
                Item sem preço na tabela não aparece no catálogo daquele cliente — e não pode ser
                vendido por ela.
              </span>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function LinhaTabela({
  tabela,
  podeEditar,
  aoRenomear,
  aoAlterar,
}: {
  readonly tabela: TabelaPreco;
  readonly podeEditar: boolean;
  readonly aoRenomear: () => void;
  readonly aoAlterar: (dados: Record<string, unknown>) => void;
}) {
  const inativa = tabela.status === 'INATIVO';

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-50 px-4 py-3 last:border-0',
        'lg:grid lg:grid-cols-[minmax(0,1fr)_140px_100px_100px_110px_200px]',
        inativa && 'bg-neutral-25',
      )}
    >
      {/*
        A linha inteira abre os preços — mas os botões de ação ficam fora do
        link. Um `<button>` dentro de `<a>` é HTML inválido, e renomear não
        pode significar navegar.
      */}
      <Link
        to={`/tabelas-preco/${tabela.id}`}
        className="order-1 flex min-w-0 flex-1 items-center gap-2.5 no-underline lg:order-none lg:flex-none"
      >
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
          <Etiqueta />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={juntar(
                'text-[13.5px] font-medium',
                inativa ? 'text-neutral-500' : 'text-neutral-900',
              )}
            >
              {tabela.nome}
            </span>
            {tabela.padrao ? (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10.5px] font-semibold text-primary-700">
                Padrão
              </span>
            ) : null}
          </span>
          <span className="block text-[11.5px] text-neutral-400">
            {tabela.padrao
              ? 'usada quando o cliente não tem tabela'
              : tabela.itensComPreco === 0
                ? 'vazia — ninguém vê catálogo por ela'
                : tabela.clientes === 0
                  ? 'nenhum cadastro compra por ela'
                  : `criada em ${new Date(tabela.criadoEm).toLocaleDateString('pt-BR')}`}
          </span>
        </span>
      </Link>

      <span className="order-3 font-mono text-[12px] text-neutral-500 lg:order-none">
        {tabela.chave}
      </span>

      <span
        className={juntar(
          'order-4 font-mono text-[13px] lg:order-none lg:text-right',
          tabela.itensComPreco === 0
            ? 'font-medium text-[var(--color-atencao)]'
            : 'text-neutral-900',
        )}
      >
        {tabela.itensComPreco}
        <span className="text-neutral-400 lg:hidden"> com preço</span>
      </span>

      <span
        className={juntar(
          'order-5 font-mono text-[13px] lg:order-none lg:text-right',
          tabela.semPreco > 0 ? 'font-medium text-[var(--color-atencao)]' : 'text-neutral-300',
        )}
      >
        {tabela.semPreco > 0 ? tabela.semPreco : '—'}
        <span className="text-neutral-400 lg:hidden"> sem preço</span>
      </span>

      <span className="order-5 font-mono text-[13px] text-neutral-900 lg:order-none lg:text-right">
        {tabela.clientes}
        <span className="text-neutral-400 lg:hidden">
          {tabela.clientes === 1 ? ' cliente' : ' clientes'}
        </span>
      </span>

      <div className="order-6 flex flex-wrap items-center gap-2 lg:order-none">
        <span
          className={juntar(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
            inativa
              ? 'bg-neutral-50 text-neutral-500'
              : 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {inativa ? 'Inativa' : 'Ativa'}
        </span>

        <Link
          to={`/tabelas-preco/${tabela.id}`}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 no-underline hover:underline"
        >
          Preços
          <Seta />
        </Link>

        {podeEditar ? (
          <Acoes tabela={tabela} aoRenomear={aoRenomear} aoAlterar={aoAlterar} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renomear, promover e desativar.
 *
 * Num menu, e não em três botões soltos na linha: a linha é a grade do
 * desenho, e três botões por linha a transformariam numa barra de ferramentas.
 */
function Acoes({
  tabela,
  aoRenomear,
  aoAlterar,
}: {
  readonly tabela: TabelaPreco;
  readonly aoRenomear: () => void;
  readonly aoAlterar: (dados: Record<string, unknown>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const inativa = tabela.status === 'INATIVO';

  return (
    <span className="relative">
      <button
        type="button"
        aria-label={`Ações de ${tabela.nome}`}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
      >
        <Reticencias />
      </button>

      {aberto ? (
        <>
          {/* Clique fora fecha. Sem isto o menu fica aberto atrás da próxima
              coisa que a pessoa for fazer. */}
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setAberto(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <span className="absolute right-0 top-8 z-20 flex w-[180px] flex-col rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                aoRenomear();
              }}
              className="px-3 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-25"
            >
              Renomear
            </button>

            {!tabela.padrao && !inativa ? (
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  aoAlterar({ padrao: true });
                }}
                className="px-3 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-25"
              >
                Tornar padrão
              </button>
            ) : null}

            {!tabela.padrao ? (
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  aoAlterar({ status: inativa ? 'ATIVO' : 'INATIVO' });
                }}
                className={juntar(
                  'px-3 py-1.5 text-left text-[13px] hover:bg-neutral-25',
                  inativa ? 'text-neutral-700' : 'text-[var(--color-perigo)]',
                )}
              >
                {inativa ? 'Reativar' : 'Desativar'}
              </button>
            ) : null}
          </span>
        </>
      ) : null}
    </span>
  );
}

function Reticencias() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function Etiqueta() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0l-6-6A2 2 0 0 1 3 12.6V5a2 2 0 0 1 2-2h7.6a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.9z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  );
}

function Seta() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}

function Mais() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function Alerta() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
