import {
  type PerfilCliente,
  PERM,
  type ApoioCliente,
  type Cliente,
  type PaginaClientes,
} from '@estoque/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

type Filtro = 'todos' | 'carteira' | 'semTabela' | 'inativos';

const FILTROS: { chave: Filtro; nome: string }[] = [
  { chave: 'todos', nome: 'Todos' },
  { chave: 'carteira', nome: 'Com carteira' },
  { chave: 'semTabela', nome: 'Sem tabela' },
  { chave: 'inativos', nome: 'Inativos' },
];

function brl(v: string | number): string {
  return Math.abs(Number(v)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function iniciais(nome: string): string {
  const partes = nome.split(' ').filter((p) => p.length > 1);
  return `${partes[0]?.[0] ?? '?'}${partes[1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * Os cadastros de cliente.
 *
 * A tabela vinculada aqui decide o catálogo inteiro daquele cliente: sem
 * tabela ele entra no portal e vê uma loja vazia, sem erro nenhum — e
 * ninguém descobre até o telefonema. Por isso o aviso é faixa, não rodapé.
 */
export function Clientes() {
  const { pode } = useSessao();
  const fila = useQueryClient();
  const navegar = useNavigate();

  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [tabelaPrecoId, setTabelaPrecoId] = useState('');
  const [perfil, setPerfil] = useState<PerfilCliente>('CONSUMIDOR');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = useQuery({
    queryKey: ['clientes', busca, filtro],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '60' });
      if (busca) p.set('busca', busca);
      if (filtro === 'semTabela') p.set('semTabela', 'true');
      if (filtro === 'inativos') p.set('status', 'INATIVO');
      return pedir<PaginaClientes>(`/clientes?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  // "Com carteira" não é filtro da API: é recorte do que já veio. Inventar
  // um parâmetro que o servidor não tem daria lista errada na página 2.
  const itens = (consulta.data?.itens ?? []).filter((c) =>
    filtro === 'carteira' ? c.temCarteira : true,
  );

  const emAberto = (consulta.data?.itens ?? []).filter(
    (c) => c.saldoCarteira !== null && Number(c.saldoCarteira) < 0,
  ).length;

  const podeAbrir = pode(PERM.cliente.editar);
  const podeCriar = pode(PERM.cliente.criar);

  const apoio = useQuery({
    queryKey: ['clientes', 'apoio'],
    queryFn: () => pedir<ApoioCliente>('/clientes/apoio'),
    enabled: criando,
  });

  /**
   * A tabela é escolhida na criação, não depois.
   *
   * Criar sem ela produz um cadastro que abre o portal e não vê nada — e o
   * aviso desta mesma tela existe justamente porque isso já aconteceu.
   */
  const criar = useMutation({
    mutationFn: () =>
      pedir<{ id: string }>('/clientes', {
        method: 'POST',
        body: {
          nome: nome.trim(),
          ...(documento.trim() ? { documento: documento.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(telefone.trim() ? { telefone: telefone.trim() } : {}),
          perfil,
          ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
        },
      }),
    onSuccess: async (criado) => {
      setCriando(false);
      setNome('');
      setDocumento('');
      setEmail('');
      setTelefone('');
      setTabelaPrecoId('');
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['clientes'] });
      void navegar(`/clientes/${criado.id}`);
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível cadastrar.');
    },
  });

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <input
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Nome, documento ou e-mail…"
          aria-label="Buscar cadastros"
          className="h-[34px] w-full max-w-[300px] rounded-md border border-neutral-200 bg-neutral-25 px-3 text-[13.5px]"
        />

        <div className="flex-1" />

        {podeCriar && !criando ? (
          <Botao variante="primario" onClick={() => setCriando(true)}>
            <Mais />
            Novo cliente
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Clientes
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {consulta.data?.total ?? 0} cadastros
              {consulta.data && consulta.data.semTabela > 0 ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setFiltro('semTabela')}
                    className="font-medium text-[var(--color-atencao)] underline decoration-[var(--color-atencao)]/40 underline-offset-2"
                  >
                    {consulta.data.semTabela} sem tabela de preço
                  </button>
                </>
              ) : null}
              {emAberto > 0 ? ` · ${emAberto} com carteira em aberto` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                aria-pressed={filtro === f.chave}
                onClick={() => setFiltro(f.chave)}
                className={juntar(
                  'h-8 rounded-full border px-3.5 text-[12.5px] font-medium',
                  filtro === f.chave
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25',
                )}
              >
                {f.nome}
              </button>
            ))}
          </div>
        </div>

        {/*
          Faixa, não nota de rodapé: cadastro sem tabela não dá erro em lugar
          nenhum — ele simplesmente abre o portal e não encontra nada.
        */}
        {consulta.data && consulta.data.semTabela > 0 && filtro !== 'semTabela' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#e6c9a8] bg-[var(--color-atencao-fundo)] px-3.5 py-3">
            <span className="shrink-0 text-[var(--color-atencao)]">
              <Alerta />
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-[#8f4b15]">
              <strong className="font-semibold">
                {consulta.data.semTabela}{' '}
                {consulta.data.semTabela === 1
                  ? 'cadastro sem tabela de preço.'
                  : 'cadastros sem tabela de preço.'}
              </strong>{' '}
              Sem tabela não há catálogo: o cliente entra no portal e vê uma loja vazia, porque o
              preço dele não existe em lugar nenhum.
            </span>
            <button
              type="button"
              onClick={() => setFiltro('semTabela')}
              className="h-[30px] shrink-0 rounded-md border border-[#d3a87a] bg-white px-3 text-[12.5px] font-semibold text-[#8f4b15]"
            >
              Ver {consulta.data.semTabela === 1 ? 'o cadastro' : `os ${consulta.data.semTabela}`}
            </button>
          </div>
        ) : null}

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível cadastrar">
            {erro}
          </Aviso>
        ) : null}

        {criando ? (
          <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Campo
                rotulo="Nome"
                value={nome}
                autoFocus
                onChange={(e) => setNome(e.target.value)}
                placeholder="Academia Ippon — Judô"
              />
              <Campo
                rotulo="Documento"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="CNPJ ou CPF, só números"
              />
              <Campo
                rotulo="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@empresa.com.br"
              />
              <Campo
                rotulo="Telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 98812-4410"
              />
            </div>

            {/*
              O perfil e a tabela sao perguntas DIFERENTES: uma diz quem ele
              e, a outra quanto ele paga. Mover um professor para uma tabela
              promocional nao pode tira-lo do ranking de revendedores.
            */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Perfil
              </span>
              <select
                value={perfil}
                onChange={(e) => setPerfil(e.target.value as PerfilCliente)}
                className="h-[42px] w-full max-w-[320px] rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
              >
                <option value="CONSUMIDOR">Consumidor final</option>
                <option value="PROFESSOR">Professor — revende para os alunos</option>
                <option value="REVENDEDOR">Revendedor</option>
              </select>
              <span className="text-[12px] text-neutral-500">
                Professor e revendedor entram no ranking de quem mais compra. Não confundir com a
                tabela de preço, que diz quanto ele paga.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Tabela de preço
              </span>
              <select
                value={tabelaPrecoId}
                onChange={(e) => setTabelaPrecoId(e.target.value)}
                className="h-[42px] w-full max-w-[320px] rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
              >
                <option value="">Sem tabela — vê o catálogo vazio</option>
                {(apoio.data?.tabelas ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                    {t.padrao ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-neutral-500">
                É a tabela que decide o catálogo e o preço que ele vê no portal.
              </span>
            </label>

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
                Cadastrar
              </Botao>
              <Botao variante="secundario" onClick={() => setCriando(false)}>
                Cancelar
              </Botao>
            </div>
          </section>
        ) : null}

        {consulta.isPending ? <EstadoCarregando titulo="Carregando cadastros…" /> : null}

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
            <div className="hidden shrink-0 grid-cols-[minmax(0,1fr)_150px_150px_130px_140px_110px] gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid">
              {['Cliente', 'Documento', 'Tabela', 'Carteira', 'Portal', 'Estado'].map((t) => (
                <span
                  key={t}
                  className={juntar(
                    'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                    t === 'Carteira' ? 'text-right' : '',
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {itens.length === 0 ? (
                <EstadoVazio
                  titulo={
                    filtro === 'semTabela'
                      ? 'Nenhum cadastro sem tabela'
                      : 'Nenhum cadastro encontrado'
                  }
                  descricao={
                    filtro === 'semTabela'
                      ? 'Todos os cadastros ativos têm tabela de preço.'
                      : 'Ajuste a busca ou o filtro.'
                  }
                />
              ) : (
                itens.map((c) => <LinhaCliente key={c.id} cliente={c} podeAbrir={podeAbrir} />)
              )}
            </div>

            <div className="flex h-11 shrink-0 items-center border-t border-neutral-100 bg-neutral-25 px-4 text-[12.5px] text-neutral-500">
              Exibindo {itens.length} de {consulta.data.total} · a lista segue por cursor, não por
              página numerada
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function LinhaCliente({
  cliente,
  podeAbrir,
}: {
  readonly cliente: Cliente;
  readonly podeAbrir: boolean;
}) {
  const semTabela = cliente.tabelaPreco === null;
  const saldo = cliente.saldoCarteira === null ? null : Number(cliente.saldoCarteira);
  const inativo = cliente.status === 'INATIVO';

  const conteudo = (
    <>
      <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 lg:order-none lg:flex-none">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-primary-50 text-[11px] font-semibold text-primary-700">
          {iniciais(cliente.nome)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-neutral-900">
            {cliente.nome}
          </span>
          <span className="block truncate text-[11px] text-neutral-400">
            {cliente.email ?? cliente.telefone ?? 'sem contato'}
            {cliente.email && cliente.telefone ? ` · ${cliente.telefone}` : ''}
          </span>
        </span>
      </div>

      <span className="order-3 font-mono text-[11.5px] text-neutral-600 lg:order-none">
        {cliente.documento ?? '—'}
      </span>

      <span className="order-4 lg:order-none">
        <span
          className={juntar(
            'inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium',
            semTabela
              ? 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]'
              : 'bg-primary-50 text-primary-700',
          )}
        >
          {cliente.tabelaPreco ?? 'sem tabela'}
        </span>
      </span>

      <span
        className={juntar(
          'order-5 font-mono text-[12.5px] font-medium lg:order-none lg:text-right',
          saldo === null || saldo === 0
            ? 'text-neutral-300'
            : saldo < 0
              ? 'text-[var(--color-perigo)]'
              : 'text-[var(--color-sucesso)]',
        )}
      >
        {saldo === null || saldo === 0
          ? '—'
          : `${saldo < 0 ? '− ' : ''}R$ ${brl(cliente.saldoCarteira ?? 0)}`}
      </span>

      <span
        className={juntar(
          'order-6 text-[12px] lg:order-none',
          cliente.acessos > 0 ? 'text-neutral-600' : 'text-neutral-300',
        )}
      >
        {cliente.acessos > 0
          ? `${cliente.acessos} ${cliente.acessos === 1 ? 'acesso' : 'acessos'}`
          : 'não entra'}
      </span>

      <span className="order-7 lg:order-none">
        <span
          className={juntar(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
            inativo
              ? 'bg-neutral-50 text-neutral-500'
              : 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {inativo ? 'Inativo' : 'Ativo'}
        </span>
      </span>
    </>
  );

  const classe = juntar(
    'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-50 px-4 py-2.5 last:border-0',
    'lg:grid lg:grid-cols-[minmax(0,1fr)_150px_150px_130px_140px_110px]',
    semTabela && !inativo && 'bg-[#fdfaf6]',
  );

  if (!podeAbrir) {
    return <div className={classe}>{conteudo}</div>;
  }

  return (
    <Link
      to={`/clientes/${cliente.id}`}
      className={juntar(classe, 'no-underline hover:bg-neutral-25')}
    >
      {conteudo}
    </Link>
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
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}
