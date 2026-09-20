import {
  PERM,
  type ApoioCliente,
  type Cliente as ClienteDto,
  type ExtratoCarteira,
  type PaginaPedidos,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { AcessosDoCliente } from './AcessosDoCliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

const MODOS = [
  {
    valor: 'PEDIDO_COM_CONFIRMACAO',
    rotulo: 'Pedido com confirmação',
    ajuda: 'O cliente envia; a equipe confere e confirma antes de virar venda.',
  },
  {
    valor: 'PAGAMENTO_IMEDIATO',
    rotulo: 'Pagamento imediato',
    ajuda: 'O carrinho vira venda na hora, debitada na carteira do cliente.',
  },
] as const;

export function Cliente() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [tabelaPrecoId, setTabelaPrecoId] = useState<string>('');
  const [modoCheckout, setModoCheckout] = useState<string>('');
  const [usaCarteira, setUsaCarteira] = useState(false);
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const consulta = useQuery({
    queryKey: ['clientes', clienteId],
    queryFn: () => pedir<ClienteDto>(`/clientes/${clienteId ?? ''}`),
    enabled: Boolean(clienteId),
  });

  const apoio = useQuery({
    queryKey: ['clientes', 'apoio'],
    queryFn: () => pedir<ApoioCliente>('/clientes/apoio'),
  });

  /**
   * A carteira e os últimos pedidos.
   *
   * São o histórico que explica o cadastro: "por que este cliente está
   * bloqueado" e "o que ele costuma comprar" se respondem aqui, sem abrir
   * outras duas telas.
   */
  const carteira = useQuery({
    queryKey: ['carteiras', 'extrato', clienteId],
    queryFn: () => pedir<ExtratoCarteira>(`/carteira/${clienteId ?? ''}/extrato?limite=1`),
    enabled: Boolean(clienteId) && consulta.data?.temCarteira === true,
  });

  const pedidos = useQuery({
    queryKey: ['pedidos', 'do-cliente', clienteId],
    queryFn: () => pedir<PaginaPedidos>(`/pedidos?clienteId=${clienteId ?? ''}&limite=6`),
    enabled: Boolean(clienteId) && pode(PERM.pedido.visualizarFila),
  });

  // O formulário nasce do servidor a cada carga do cadastro.
  useEffect(() => {
    const c = consulta.data;
    if (!c) return;
    setTabelaPrecoId(c.tabelaPrecoId ?? '');
    setModoCheckout(c.modoCheckout ?? '');
    setUsaCarteira(c.usaCarteira);
    setNome(c.nome);
    setDocumento(c.documento ?? '');
    setEmail(c.email ?? '');
    setTelefone(c.telefone ?? '');
  }, [consulta.data]);

  const salvar = useMutation({
    mutationFn: () =>
      pedir<{ id: string }>(`/clientes/${clienteId ?? ''}`, {
        method: 'PATCH',
        body: {
          nome,
          documento: documento.trim() || null,
          email: email.trim() || null,
          telefone: telefone.trim() || null,
          // String vazia significa "nenhuma" — e `null` é como se diz isso à
          // API. Mandar `''` faria o Zod recusar um uuid inválido.
          tabelaPrecoId: tabelaPrecoId || null,
          modoCheckout: modoCheckout || null,
          usaCarteira,
        },
      }),
    onSuccess: async () => {
      setErro(null);
      setSalvo(true);
      await fila.invalidateQueries({ queryKey: ['clientes'] });
    },
    onError: (e) => {
      setSalvo(false);
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando cadastro…" />;
  }

  if (consulta.isError || !consulta.data) {
    return (
      <EstadoErro
        titulo="Não foi possível abrir o cadastro"
        descricao={
          consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente novamente em instantes.'
        }
      />
    );
  }

  const cliente = consulta.data;
  const podeEditar = pode(PERM.cliente.editar);
  const tabelaEscolhida = apoio.data?.tabelas.find((t) => t.id === tabelaPrecoId) ?? null;

  const sujo =
    nome !== cliente.nome ||
    (documento.trim() || null) !== cliente.documento ||
    (email.trim() || null) !== cliente.email ||
    (telefone.trim() || null) !== cliente.telefone ||
    (tabelaPrecoId || null) !== cliente.tabelaPrecoId ||
    (modoCheckout || null) !== cliente.modoCheckout ||
    usaCarteira !== cliente.usaCarteira;

  function descartar() {
    setNome(cliente.nome);
    setDocumento(cliente.documento ?? '');
    setEmail(cliente.email ?? '');
    setTelefone(cliente.telefone ?? '');
    setTabelaPrecoId(cliente.tabelaPrecoId ?? '');
    setModoCheckout(cliente.modoCheckout ?? '');
    setUsaCarteira(cliente.usaCarteira);
    setSalvo(false);
    setErro(null);
  }

  const saldo = cliente.saldoCarteira === null ? null : Number(cliente.saldoCarteira);
  const conta = carteira.data?.carteira ?? null;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <Link
          to="/clientes"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Clientes
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-[13.5px] font-medium text-neutral-900">{cliente.nome}</span>

        <div className="flex-1" />

        {sujo ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-atencao-fundo)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-atencao)]">
            <Relogio />
            Alterações não salvas
          </span>
        ) : null}

        {podeEditar ? (
          <>
            <Botao variante="secundario" disabled={!sujo} onClick={descartar}>
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={salvar.isPending}
              disabled={!sujo}
              onClick={() => salvar.mutate()}
            >
              Salvar cliente
            </Botao>
          </>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-[13.5px] font-semibold text-primary-700">
            {iniciais(cliente.nome)}
          </span>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            {cliente.nome}
          </h1>
          {cliente.documento ? (
            <span className="rounded bg-neutral-50 px-2 py-0.5 font-mono text-[12.5px] text-neutral-500">
              {cliente.documento}
            </span>
          ) : null}
          <span
            className={juntar(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
              cliente.status === 'ATIVO'
                ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
                : 'bg-neutral-50 text-neutral-500',
            )}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {cliente.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
          </span>
          <span className="text-[13px] text-neutral-500">
            · {cliente.tabelaPreco ? `tabela ${cliente.tabelaPreco}` : 'sem tabela'} · cliente desde{' '}
            {new Date(cliente.criadoEm).toLocaleDateString('pt-BR')}
          </span>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível salvar">
            {erro}
          </Aviso>
        ) : null}
        {salvo ? <Aviso tom="sucesso">Cadastro atualizado.</Aviso> : null}

        <div className="flex flex-col gap-3.5 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <section className="rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-display text-[15px] font-semibold text-neutral-900">
                Dados
              </h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  rotulo="Nome"
                  value={nome}
                  disabled={!podeEditar}
                  onChange={(e) => {
                    setNome(e.target.value);
                    setSalvo(false);
                  }}
                />
                <Campo
                  rotulo="Documento"
                  value={documento}
                  disabled={!podeEditar}
                  placeholder="CNPJ ou CPF"
                  onChange={(e) => {
                    setDocumento(e.target.value);
                    setSalvo(false);
                  }}
                />
                <Campo
                  rotulo="E-mail"
                  type="email"
                  value={email}
                  disabled={!podeEditar}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setSalvo(false);
                  }}
                />
                <Campo
                  rotulo="Telefone"
                  value={telefone}
                  disabled={!podeEditar}
                  onChange={(e) => {
                    setTelefone(e.target.value);
                    setSalvo(false);
                  }}
                />
              </div>
            </section>

            <section className="rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                Como a compra dele termina
              </h2>
              <p className="mb-3 mt-1 text-[12.5px] leading-[18px] text-neutral-500">
                Vale para o carrinho do portal. Em branco, segue o padrão da empresa.
              </p>

              {/*
                Dois cartões, não um select: são duas políticas diferentes, e
                a diferença entre elas é o texto — que num select fica
                escondido até alguém abrir.
              */}
              <div className="grid gap-2.5 sm:grid-cols-2">
                {MODOS.map((m) => {
                  const ativo = (modoCheckout || cliente.modoCheckoutEfetivo) === m.valor;
                  const ePadrao = apoio.data?.modoCheckoutPadrao === m.valor;
                  return (
                    <button
                      key={m.valor}
                      type="button"
                      aria-pressed={ativo}
                      disabled={!podeEditar}
                      onClick={() => {
                        setModoCheckout(m.valor);
                        setSalvo(false);
                      }}
                      className={juntar(
                        'rounded-lg border p-3.5 text-left disabled:opacity-60',
                        ativo
                          ? 'border-primary-600 bg-primary-50'
                          : 'border-neutral-200 bg-white hover:bg-neutral-25',
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={juntar(
                            'text-[13.5px] font-semibold',
                            ativo ? 'text-primary-800' : 'text-neutral-900',
                          )}
                        >
                          {m.rotulo}
                        </span>
                        {ePadrao ? (
                          <span className="rounded-full border border-primary-100 bg-white px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                            padrão da empresa
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[12px] leading-[17px] text-neutral-500">
                        {m.ajuda}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/*
                "Herdar" é uma opção de verdade, não a ausência de escolha:
                quem herda acompanha a empresa quando ela muda de política.
              */}
              {podeEditar && modoCheckout ? (
                <button
                  type="button"
                  onClick={() => {
                    setModoCheckout('');
                    setSalvo(false);
                  }}
                  className="mt-2 text-[12.5px] font-medium text-primary-600 underline"
                >
                  voltar a seguir a empresa
                </button>
              ) : null}

              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-md border border-neutral-100 bg-neutral-25 p-3">
                <input
                  type="checkbox"
                  checked={usaCarteira}
                  disabled={!podeEditar}
                  onChange={(e) => {
                    setUsaCarteira(e.target.checked);
                    setSalvo(false);
                  }}
                  className="mt-0.5 size-4"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-medium text-neutral-900">
                    Compra em conta corrente
                  </span>
                  <span className="text-[12px] leading-[17px] text-neutral-500">
                    Decide onde a dívida vive: na carteira, ou como título em contas a receber.
                    Contar nos dois seria contar duas vezes.
                  </span>
                </span>
              </label>

              {(modoCheckout || cliente.modoCheckoutEfetivo) === 'PAGAMENTO_IMEDIATO' &&
              !cliente.temCarteira ? (
                <Aviso tom="perigo" className="mt-3" titulo="Pagamento imediato sem carteira">
                  Não existe pagamento automático sem uma conta de onde tirar o dinheiro. O checkout
                  deste cliente vai ser recusado até ele ter carteira.
                </Aviso>
              ) : null}
            </section>

            {clienteId ? <AcessosDoCliente clienteId={clienteId} /> : null}
          </div>

          <div className="flex w-full shrink-0 flex-col gap-3.5 xl:w-[360px]">
            <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                Tabela de preço
              </h2>
              <p className="mb-2.5 mt-0.5 text-[12.5px] leading-[18px] text-neutral-500">
                Decide o catálogo e o preço que ele vê no portal.
              </p>

              <select
                value={tabelaPrecoId}
                disabled={!podeEditar}
                onChange={(e) => {
                  setTabelaPrecoId(e.target.value);
                  setSalvo(false);
                }}
                className="h-[42px] w-full rounded-md border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900"
              >
                <option value="">Sem tabela — vê o catálogo vazio</option>
                {apoio.data?.tabelas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                    {t.padrao ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>

              {/*
                Duas armadilhas diferentes, e a tela precisa distinguir: sem
                tabela o catálogo é vazio porque não há lista; com uma tabela
                vazia ele é vazio porque a lista não foi preenchida. O segundo
                caso engana mais — parece configurado.
              */}
              {!tabelaPrecoId ? (
                <Aviso tom="atencao" className="mt-2.5">
                  Sem tabela, o portal deste cliente fica vazio: um item sem preço na tabela dele
                  não existe para ele.
                </Aviso>
              ) : tabelaEscolhida && tabelaEscolhida.itensComPreco === 0 ? (
                <Aviso tom="atencao" className="mt-2.5" titulo="Esta tabela não tem nenhum preço">
                  O cadastro fica vinculado, mas o catálogo continua vazio até alguém preencher os
                  preços dela.
                </Aviso>
              ) : tabelaEscolhida ? (
                <div className="mt-2.5 flex items-center gap-2 rounded-md border border-primary-100 bg-primary-50 px-3 py-2.5">
                  <span className="shrink-0 text-primary-600">
                    <Certo />
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-primary-800">
                    {tabelaEscolhida.itensComPreco}{' '}
                    {tabelaEscolhida.itensComPreco === 1 ? 'item' : 'itens'} com preço
                  </span>
                  <Link
                    to={`/tabelas-preco/${tabelaEscolhida.id}`}
                    className="shrink-0 text-[12.5px] font-medium text-primary-700 no-underline hover:underline"
                  >
                    Ver preços
                  </Link>
                </div>
              ) : null}
            </section>

            {/*
              A carteira só aparece quando existe. Mostrar um cartão zerado
              para quem não tem conta corrente inventaria uma conta.
            */}
            {cliente.temCarteira ? (
              <section
                className={juntar(
                  'rounded-md border bg-white p-4 shadow-sm',
                  saldo !== null && saldo < 0 ? 'border-[#f0c9cb]' : 'border-neutral-100',
                )}
              >
                <div className="flex items-baseline gap-2">
                  <h2 className="flex-1 font-display text-[15px] font-semibold text-neutral-900">
                    Carteira
                  </h2>
                  <Link
                    to="/carteiras"
                    className="text-[12.5px] font-medium text-primary-600 no-underline hover:underline"
                  >
                    Abrir extrato
                  </Link>
                </div>

                <p
                  className={juntar(
                    'mt-2 font-mono text-[26px] font-bold leading-[30px]',
                    saldo === null || saldo === 0
                      ? 'text-neutral-600'
                      : saldo < 0
                        ? 'text-[var(--color-perigo)]'
                        : 'text-[var(--color-sucesso)]',
                  )}
                >
                  {saldo !== null && saldo < 0 ? '− ' : ''}R$ {brl(cliente.saldoCarteira ?? 0)}
                </p>
                <p className="mt-0.5 text-[12px] text-neutral-500">
                  {saldo === null || saldo === 0
                    ? 'nada em aberto'
                    : saldo < 0
                      ? 'o cliente deve à loja'
                      : 'a loja deve ao cliente'}
                </p>

                {conta ? (
                  <div className="mt-3 flex gap-3">
                    <div className="flex-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-400">
                        Limite
                      </p>
                      <p className="mt-0.5 font-mono text-[14px] text-neutral-900">
                        R$ {brl(conta.limiteCredito)}
                      </p>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-400">
                        Disponível
                      </p>
                      <p
                        className={juntar(
                          'mt-0.5 font-mono text-[14px]',
                          Number(conta.disponivel) < 0
                            ? 'font-semibold text-[var(--color-perigo)]'
                            : 'text-neutral-900',
                        )}
                      >
                        {Number(conta.disponivel) < 0 ? '− ' : ''}R$ {brl(conta.disponivel)}
                      </p>
                    </div>
                  </div>
                ) : null}

                {conta?.bloqueadaParaCompra ? (
                  <p className="mt-2.5 inline-flex items-center gap-1.5 rounded bg-[var(--color-perigo-fundo)] px-2 py-1 text-[11.5px] font-semibold text-[var(--color-perigo)]">
                    Bloqueada para compra — quitação continua liberada
                  </p>
                ) : null}
              </section>
            ) : null}

            {pedidos.data && pedidos.data.itens.length > 0 ? (
              <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
                <div className="flex items-baseline gap-2 border-b border-neutral-100 px-4 py-3">
                  <h2 className="flex-1 font-display text-[15px] font-semibold text-neutral-900">
                    Últimos pedidos
                  </h2>
                  <Link
                    to="/pedidos"
                    className="text-[12.5px] font-medium text-primary-600 no-underline hover:underline"
                  >
                    Ver todos
                  </Link>
                </div>

                {pedidos.data.itens.map((p) => (
                  <Link
                    key={p.id}
                    to={`/pedidos/${p.id}`}
                    className="flex items-center gap-2.5 border-b border-neutral-50 px-4 py-2 no-underline last:border-0 hover:bg-neutral-25"
                  >
                    <span className="font-mono text-[12px] text-neutral-600">#{p.numero}</span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={juntar(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                          tomDoPedido(p.status),
                        )}
                      >
                        {ROTULO_STATUS[p.status] ?? p.status}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-neutral-400">
                      {p.enviadoEm
                        ? new Date(p.enviadoEm).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                          })
                        : '—'}
                    </span>
                    {/* O confirmado é o que a loja vai faturar; o solicitado
                        é o que o cliente pediu. Enquanto não há confirmação,
                        o que existe é o pedido dele. */}
                    <span className="shrink-0 font-mono text-[12.5px] font-medium text-neutral-900">
                      R${' '}
                      {brl(Number(p.valorConfirmado) > 0 ? p.valorConfirmado : p.valorSolicitado)}
                    </span>
                  </Link>
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

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

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_CONFIRMACAO: 'Aguardando',
  AGUARDANDO_ACEITE_CLIENTE: 'Aguardando aceite',
  CONFIRMADO: 'Confirmado',
  CONFIRMADO_PARCIALMENTE: 'Parcial',
  FATURADO: 'Faturado',
  RECUSADO: 'Recusado',
  DEVOLVIDO: 'Devolvido',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
};

function tomDoPedido(status: string): string {
  if (status === 'FATURADO' || status === 'CONFIRMADO') {
    return 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]';
  }
  if (status === 'CONFIRMADO_PARCIALMENTE' || status.startsWith('AGUARDANDO')) {
    return 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]';
  }
  if (status === 'RECUSADO' || status === 'CANCELADO' || status === 'DEVOLVIDO') {
    return 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]';
  }
  return 'bg-neutral-50 text-neutral-600';
}

function Relogio() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3 2" />
    </svg>
  );
}

function Certo() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
