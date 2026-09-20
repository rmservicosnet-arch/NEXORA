import {
  PERM,
  type Carteira,
  type ExtratoCarteira,
  type MovimentoCarteira,
  type PaginaCarteiras,
} from '@estoque/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/** `\n` escrito assim porque o arquivo é lido por planilha, não por humano. */
const QUEBRA = String.fromCharCode(10);

function brl(valor: string | number): string {
  return Math.abs(Number(valor)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Iniciais para o avatar — no máximo duas, como no desenho. */
function iniciais(nome: string): string {
  const partes = nome.split(' ').filter((p) => p.length > 1);
  return `${partes[0]?.[0] ?? '?'}${partes[1]?.[0] ?? ''}`.toUpperCase();
}

function dataHora(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString('pt-BR'),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

const ROTULO_TIPO: Record<string, string> = {
  DEPOSITO: 'Depósito',
  QUITACAO: 'Quitação',
  DEVOLUCAO_VENDA: 'Devolução',
  BONIFICACAO: 'Bonificação',
  ESTORNO_DEBITO: 'Estorno de débito',
  AJUSTE_CREDITO: 'Ajuste a crédito',
  PAGAMENTO_VENDA: 'Pagamento de venda',
  VENDA_A_PRAZO: 'Venda a prazo',
  TAXA: 'Taxa',
  ESTORNO_CREDITO: 'Estorno de crédito',
  AJUSTE_DEBITO: 'Ajuste a débito',
};

/**
 * A cor do tipo, como no desenho: entrada de dinheiro em verde, venda a prazo
 * em azul, e o que cria dinheiro sem contrapartida em âmbar — para que salte.
 */
function tomDoTipo(tipo: string): string {
  if (tipo === 'QUITACAO' || tipo === 'DEPOSITO' || tipo === 'DEVOLUCAO_VENDA') {
    return 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]';
  }
  if (tipo === 'VENDA_A_PRAZO' || tipo === 'PAGAMENTO_VENDA') {
    return 'bg-primary-50 text-primary-700';
  }
  if (EXIGEM_MOTIVO.has(tipo)) {
    return 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]';
  }
  return 'bg-neutral-50 text-neutral-600';
}

const TIPOS_LANCAMENTO = [
  { valor: 'QUITACAO', rotulo: 'Quitação', permissao: PERM.carteira.lancarQuitacao },
  { valor: 'DEPOSITO', rotulo: 'Depósito', permissao: PERM.carteira.lancarDeposito },
  { valor: 'BONIFICACAO', rotulo: 'Bonificação', permissao: PERM.carteira.ajustar },
  { valor: 'TAXA', rotulo: 'Taxa', permissao: PERM.carteira.ajustar },
  { valor: 'AJUSTE_CREDITO', rotulo: 'Ajuste a crédito', permissao: PERM.carteira.ajustar },
  { valor: 'AJUSTE_DEBITO', rotulo: 'Ajuste a débito', permissao: PERM.carteira.ajustar },
];

/** Os que criam dinheiro sem contrapartida. O banco também exige motivo. */
const EXIGEM_MOTIVO = new Set(['BONIFICACAO', 'AJUSTE_CREDITO', 'AJUSTE_DEBITO']);

/**
 * As carteiras da empresa.
 *
 * A lista responde "quem deve"; o extrato de cada uma responde "por quê" — e
 * são duas perguntas diferentes, em duas telas. Antes era um mestre-detalhe
 * que espremia o extrato em metade da largura.
 */
export function Carteiras() {
  const navegar = useNavigate();

  const [busca, setBusca] = useState('');
  const [soDevedores, setSoDevedores] = useState(false);

  const parametros = new URLSearchParams({ limite: '60' });
  if (busca.trim()) parametros.set('busca', busca.trim());
  if (soDevedores) parametros.set('apenasDevedores', 'true');

  const lista = useQuery({
    queryKey: ['carteiras', busca, soDevedores],
    queryFn: () => pedir<PaginaCarteiras>(`/carteira?${parametros.toString()}`),
    placeholderData: keepPreviousData,
  });

  const itens = lista.data?.itens ?? [];
  const devendo = itens.filter((c) => Number(c.saldo) < 0).length;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome do cliente…"
          aria-label="Buscar cliente"
          className="h-[34px] w-full max-w-[300px] rounded-md border border-neutral-200 bg-neutral-25 px-3 text-[13.5px]"
        />

        <div className="flex-1" />

        {lista.data ? (
          <span className="text-[13px] text-neutral-500">
            A receber:{' '}
            <strong className="font-mono font-semibold text-[var(--color-perigo)]">
              R$ {brl(lista.data.totalAReceber)}
            </strong>
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Carteiras
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {itens.length} {itens.length === 1 ? 'conta corrente' : 'contas correntes'}
              {devendo > 0 ? ` · ${devendo} em aberto` : ''} · saldo negativo é o cliente devendo à
              loja
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-neutral-600">
            <input
              type="checkbox"
              checked={soDevedores}
              onChange={(e) => setSoDevedores(e.target.checked)}
              className="size-3.5 accent-[var(--color-perigo)]"
            />
            Só quem está devendo
          </label>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm">
          <div className="hidden shrink-0 grid-cols-[minmax(0,1fr)_150px_150px_150px_130px] gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid">
            {['Cliente', 'Saldo', 'Limite', 'Disponível', 'Estado'].map((t, i) => (
              <span
                key={t}
                className={juntar(
                  'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                  i >= 1 && i <= 3 ? 'text-right' : '',
                )}
              >
                {t}
              </span>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {lista.isPending ? <EstadoCarregando titulo="Carregando…" /> : null}

            {lista.isSuccess && itens.length === 0 ? (
              <EstadoVazio
                titulo={soDevedores ? 'Ninguém devendo' : 'Nenhuma carteira'}
                descricao={
                  soDevedores
                    ? 'Nenhuma conta corrente está em aberto.'
                    : 'Clientes com conta corrente aparecem aqui.'
                }
              />
            ) : null}

            {itens.map((c) => (
              <LinhaCarteira
                key={c.id}
                carteira={c}
                aoAbrir={() => void navegar(`/carteiras/${c.clienteId}`)}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

/**
 * O extrato de uma carteira.
 *
 * A tela inteira, como no desenho: identidade, os três números e o razão em
 * colunas. Conferir uma conta é ler de cima para baixo — e isso não cabe em
 * metade da largura.
 */
export function CarteiraDoCliente() {
  const { clienteId = '' } = useParams();
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [erro, setErro] = useState<string | null>(null);

  const [tipo, setTipo] = useState('QUITACAO');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [formulario, setFormulario] = useState(false);

  const [formLimite, setFormLimite] = useState(false);
  const [novoLimite, setNovoLimite] = useState('');
  const [motivoLimite, setMotivoLimite] = useState('');

  const extrato = useQuery({
    queryKey: ['carteiras', 'extrato', clienteId],
    queryFn: () => pedir<ExtratoCarteira>(`/carteira/${clienteId}/extrato?limite=100`),
  });

  const lancar = useMutation({
    mutationFn: () =>
      pedir<ExtratoCarteira>(`/carteira/${clienteId}/lancamentos`, {
        method: 'POST',
        body: {
          tipo,
          valor,
          ...(motivo ? { justificativa: motivo } : {}),
          ...(tipo === 'QUITACAO' || tipo === 'DEPOSITO' ? { formaPagamento: 'PIX' } : {}),
        },
      }),
    onSuccess: async () => {
      setFormulario(false);
      setValor('');
      setMotivo('');
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['carteiras'] });
      // O cadastro do cliente mostra o mesmo saldo; deixá-lo com a versão
      // anterior faria as duas telas discordarem.
      await fila.invalidateQueries({ queryKey: ['clientes'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível lançar.');
    },
  });

  const limitar = useMutation({
    mutationFn: () =>
      pedir<Carteira>(`/carteira/${clienteId}/limite`, {
        method: 'POST',
        body: {
          limiteCredito: novoLimite,
          ...(motivoLimite.trim() ? { justificativa: motivoLimite.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      setFormLimite(false);
      setNovoLimite('');
      setMotivoLimite('');
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['carteiras'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível mudar o limite.');
    },
  });

  const estornar = useMutation({
    mutationFn: (movimentoId: string) =>
      pedir<ExtratoCarteira>(`/carteira/${clienteId}/lancamentos/${movimentoId}/estornar`, {
        method: 'POST',
        body: { justificativa: 'Estorno lançado pela tela de carteiras' },
      }),
    onSuccess: async () => {
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['carteiras'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível estornar.');
    },
  });

  const disponiveis = TIPOS_LANCAMENTO.filter((t) => pode(t.permissao));
  const atual = extrato.data;

  function abrirLancamento(qual: string) {
    setTipo(qual);
    setFormLimite(false);
    setFormulario(true);
    setErro(null);
  }

  function exportar() {
    if (!atual) return;

    const colunas = [
      'data',
      'hora',
      'tipo',
      'documento',
      'motivo',
      'credito',
      'debito',
      'saldo',
      'lancado_por',
      'estornado',
    ];
    const linhas = atual.movimentos.map((m) => {
      const { data, hora } = dataHora(m.criadoEm);
      const credito = m.sentido === 'CREDITO';
      return [
        data,
        hora,
        ROTULO_TIPO[m.tipo] ?? m.tipo,
        documentoDe(m).replaceAll(';', ','),
        (m.justificativa ?? '').replaceAll(';', ','),
        credito ? m.valor : '',
        credito ? '' : m.valor,
        m.saldoPosterior,
        m.ator ?? 'Sistema',
        m.estornado ? 'sim' : 'nao',
      ].join(';');
    });

    const marcaUtf8 = String.fromCharCode(0xfeff);
    const url = URL.createObjectURL(
      new Blob([marcaUtf8 + [colunas.join(';'), ...linhas].join(QUEBRA)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `extrato-${atual.carteira.cliente.toLowerCase().replaceAll(' ', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (extrato.isPending) {
    return <EstadoCarregando titulo="Carregando extrato…" />;
  }

  if (extrato.isError || !atual) {
    return (
      <EstadoErro
        titulo="Não foi possível abrir a carteira"
        descricao={
          extrato.error instanceof ErroRequisicao
            ? extrato.error.corpo.mensagem
            : 'O cliente pode não ter conta corrente.'
        }
        aoTentarNovamente={() => void extrato.refetch()}
      />
    );
  }

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <Link
          to="/carteiras"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Carteiras
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-[13.5px] font-medium text-neutral-900">
          {atual.carteira.cliente}
        </span>

        <div className="flex-1" />

        <Botao variante="secundario" onClick={exportar}>
          Exportar extrato
        </Botao>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-neutral-100 bg-white px-4 py-4 sm:px-6">
            <Identidade
              carteira={atual.carteira}
              podeQuitar={pode(PERM.carteira.lancarQuitacao)}
              podeDepositar={pode(PERM.carteira.lancarDeposito)}
              podeLimitar={pode(PERM.carteira.definirLimite)}
              temOutros={disponiveis.length > 0}
              aoQuitar={() => abrirLancamento('QUITACAO')}
              aoDepositar={() => abrirLancamento('DEPOSITO')}
              aoAjustar={() => {
                abrirLancamento(disponiveis[0]?.valor ?? 'QUITACAO');
              }}
              aoLimitar={() => {
                setFormulario(false);
                setNovoLimite(atual.carteira.limiteCredito);
                setFormLimite(true);
                setErro(null);
              }}
            />

            <Numeros carteira={atual.carteira} />

            {erro ? (
              <Aviso tom="perigo" className="mt-3" titulo="Não foi possível concluir">
                {erro}
              </Aviso>
            ) : null}

            {formulario ? (
              <div className="mt-3 flex flex-wrap items-end gap-2.5 rounded-md border border-primary-100 bg-primary-50 p-3.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Tipo
                  </span>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value)}
                    className="h-10 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                  >
                    {disponiveis.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Valor
                  </span>
                  <input
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-[110px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[14px]"
                  />
                </label>

                <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Motivo{EXIGEM_MOTIVO.has(tipo) ? '' : ' (opcional)'}
                  </span>
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder={
                      EXIGEM_MOTIVO.has(tipo)
                        ? 'Obrigatório: este tipo cria dinheiro sem contrapartida'
                        : 'Comprovante, acordo, observação'
                    }
                    className="h-10 rounded-md border border-neutral-200 px-2.5 text-[13.5px]"
                  />
                </label>

                <Botao
                  variante="primario"
                  carregando={lancar.isPending}
                  disabled={
                    valor.trim().length === 0 ||
                    (EXIGEM_MOTIVO.has(tipo) && motivo.trim().length < 5)
                  }
                  onClick={() => lancar.mutate()}
                >
                  Lançar
                </Botao>

                <Botao variante="fantasma" onClick={() => setFormulario(false)}>
                  Cancelar
                </Botao>
              </div>
            ) : null}

            {formLimite ? (
              <div className="mt-3 flex flex-wrap items-end gap-2.5 rounded-md border border-neutral-200 bg-neutral-25 p-3.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Limite de crédito
                  </span>
                  <input
                    value={novoLimite}
                    onChange={(e) => setNovoLimite(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-[130px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[14px]"
                  />
                </label>

                <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Motivo (opcional)
                  </span>
                  <input
                    value={motivoLimite}
                    onChange={(e) => setMotivoLimite(e.target.value)}
                    placeholder="Acordo, análise de crédito, decisão do gestor"
                    className="h-10 rounded-md border border-neutral-200 px-2.5 text-[13.5px]"
                  />
                </label>

                <Botao
                  variante="primario"
                  carregando={limitar.isPending}
                  disabled={novoLimite.trim().length === 0}
                  onClick={() => limitar.mutate()}
                >
                  Salvar limite
                </Botao>

                <Botao variante="fantasma" onClick={() => setFormLimite(false)}>
                  Cancelar
                </Botao>

                <p className="w-full text-[11.5px] text-neutral-500">
                  O limite é quanto o saldo pode ficar negativo. Reduzi-lo não desfaz compra
                  nenhuma: só impede a próxima.
                </p>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {atual.movimentos.length === 0 ? (
              <EstadoVazio titulo="Sem movimentos" descricao="Nada lançado ainda." />
            ) : (
              <div>
                <CabecalhoDaTabela />

                {atual.movimentos.map((m) => (
                  <LinhaMovimento
                    key={m.id}
                    movimento={m}
                    podeEstornar={pode(PERM.carteira.estornar)}
                    ocupado={estornar.isPending}
                    aoEstornar={() => estornar.mutate(m.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <Rodape extrato={atual} />
        </div>
      </main>
    </>
  );
}

function Identidade({
  carteira,
  podeQuitar,
  podeDepositar,
  podeLimitar,
  temOutros,
  aoQuitar,
  aoDepositar,
  aoAjustar,
  aoLimitar,
}: {
  readonly carteira: Carteira;
  readonly podeQuitar: boolean;
  readonly podeDepositar: boolean;
  readonly podeLimitar: boolean;
  readonly temOutros: boolean;
  readonly aoQuitar: () => void;
  readonly aoDepositar: () => void;
  readonly aoAjustar: () => void;
  readonly aoLimitar: () => void;
}) {
  const desde = new Date(carteira.criadoEm).toLocaleDateString('pt-BR');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-50 font-semibold text-primary-700">
        {iniciais(carteira.cliente)}
      </span>

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-[18px] font-semibold text-neutral-900">
          {carteira.cliente}
        </h1>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-neutral-500">
          {carteira.tabelaPreco ? <span>tabela {carteira.tabelaPreco} ·</span> : null}
          <span>
            conta corrente {carteira.status === 'ATIVO' ? 'ativa' : 'inativa'} desde {desde}
          </span>
          {carteira.bloqueadaParaCompra ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-perigo-fundo)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-perigo)]">
              <span className="size-1.5 rounded-full bg-current" />
              bloqueada para compra — quitação continua liberada
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {podeQuitar ? (
          <Botao variante="primario" onClick={aoQuitar}>
            Lançar quitação
          </Botao>
        ) : null}
        {podeDepositar ? (
          <Botao variante="secundario" onClick={aoDepositar}>
            Depósito
          </Botao>
        ) : null}
        {podeLimitar ? (
          <Botao variante="secundario" onClick={aoLimitar}>
            Definir limite
          </Botao>
        ) : null}
        {temOutros ? (
          <Botao variante="fantasma" onClick={aoAjustar}>
            Ajustar
          </Botao>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Os três números, e a conta que os liga.
 *
 * "Disponível" sozinho não se explica: mostrar `saldo + limite` embaixo é o
 * que impede a pergunta "por que só isso?" — e é onde se vê que um limite
 * generoso está escondendo uma dívida.
 */
function Numeros({ carteira }: { readonly carteira: Carteira }) {
  const saldo = Number(carteira.saldo);
  const disponivel = Number(carteira.disponivel);
  const excedido = disponivel < 0;

  return (
    <>
      <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-neutral-100 bg-white p-3.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Saldo atual
          </p>
          <p
            className={juntar(
              'mt-1 font-mono text-[22px] font-bold leading-7',
              saldo < 0
                ? 'text-[var(--color-perigo)]'
                : saldo > 0
                  ? 'text-[var(--color-sucesso)]'
                  : 'text-neutral-600',
            )}
          >
            {saldo < 0 ? '− ' : ''}R$ {brl(saldo)}
          </p>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            {saldo < 0
              ? 'O cliente deve à loja'
              : saldo > 0
                ? 'A loja deve ao cliente'
                : 'Nada em aberto'}
          </p>
        </div>

        <div className="rounded-md border border-neutral-100 bg-white p-3.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Limite de crédito
          </p>
          <p className="mt-1 font-mono text-[22px] font-bold leading-7 text-neutral-900">
            R$ {brl(carteira.limiteCredito)}
          </p>
          <p className="mt-0.5 text-[12px] text-neutral-500">quanto pode ficar negativo</p>
        </div>

        <div className="rounded-md border border-neutral-100 bg-white p-3.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Disponível para compra
          </p>
          <p
            className={juntar(
              'mt-1 font-mono text-[22px] font-bold leading-7',
              excedido ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
            )}
          >
            {excedido ? '− ' : ''}R$ {brl(disponivel)}
          </p>
          <p className="mt-0.5 font-mono text-[12px] text-neutral-500">
            {saldo < 0 ? '−' : ''}
            {brl(saldo)} + {brl(carteira.limiteCredito)}
          </p>
        </div>
      </div>

      {excedido ? (
        <Aviso tom="perigo" className="mt-3" titulo={`Acima do limite em R$ ${brl(disponivel)}`}>
          O débito passou do limite com a permissão{' '}
          <span className="font-mono">carteira.exceder_limite</span> e justificativa. Novas compras
          ficam bloqueadas até quitar.
        </Aviso>
      ) : null}
    </>
  );
}

function CabecalhoDaTabela() {
  const colunas = [
    { texto: 'Data', classe: '' },
    { texto: 'Tipo', classe: '' },
    { texto: 'Documento e motivo', classe: '' },
    { texto: 'Crédito', classe: 'text-right' },
    { texto: 'Débito', classe: 'text-right' },
    { texto: 'Saldo', classe: 'text-right' },
    { texto: 'Lançado por', classe: '' },
  ];

  return (
    <div className="hidden border-b border-neutral-100 bg-neutral-25 px-5 py-2 sm:grid sm:grid-cols-[92px_118px_minmax(0,1fr)_92px_92px_104px_118px] sm:gap-x-2.5">
      {colunas.map((c, i) => (
        <span
          key={c.texto || `vazia-${String(i)}`}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            c.classe,
          )}
        >
          {c.texto}
        </span>
      ))}
    </div>
  );
}

/** O documento que explica o movimento — e só ele; o motivo vai embaixo. */
function documentoDe(m: MovimentoCarteira): string {
  if (m.vendaNumero !== null) return `Venda #${String(m.vendaNumero)}`;
  if (m.documento && m.formaPagamento) return `${m.formaPagamento} · ${m.documento}`;
  return m.documento ?? m.formaPagamento ?? ROTULO_TIPO[m.tipo] ?? m.tipo;
}

function Rodape({ extrato }: { readonly extrato: ExtratoCarteira }) {
  const movimentos = extrato.movimentos;
  const ultimo = movimentos[0];
  const primeiro = movimentos[movimentos.length - 1];
  const periodo =
    primeiro && ultimo
      ? `${dataHora(primeiro.criadoEm).data} a ${dataHora(ultimo.criadoEm).data}`
      : '';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-neutral-100 bg-neutral-25 px-5 py-2.5 text-[12.5px] text-neutral-500">
      <span>
        {movimentos.length} {movimentos.length === 1 ? 'movimento' : 'movimentos'}
        {periodo ? ` · ${periodo}` : ''}
      </span>
      <div className="flex-1" />
      <span>
        Créditos{' '}
        <strong className="font-mono text-[var(--color-sucesso)]">
          R$ {brl(extrato.totalCreditos)}
        </strong>
      </span>
      <span>
        Débitos{' '}
        <strong className="font-mono text-[var(--color-perigo)]">
          R$ {brl(extrato.totalDebitos)}
        </strong>
      </span>
      <span>
        Saldo{' '}
        <strong
          className={juntar(
            'font-mono',
            Number(extrato.carteira.saldo) < 0
              ? 'text-[var(--color-perigo)]'
              : 'text-[var(--color-sucesso)]',
          )}
        >
          {Number(extrato.carteira.saldo) < 0 ? '− ' : ''}R$ {brl(extrato.carteira.saldo)}
        </strong>
      </span>
    </div>
  );
}

function LinhaCarteira({
  carteira,
  aoAbrir,
}: {
  readonly carteira: Carteira;
  readonly aoAbrir: () => void;
}) {
  const saldo = Number(carteira.saldo);
  const disponivel = Number(carteira.disponivel);
  const inativa = carteira.status === 'INATIVO';

  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={juntar(
        'flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-50 px-4 py-2.5 text-left last:border-0 hover:bg-neutral-25',
        'lg:grid lg:grid-cols-[minmax(0,1fr)_150px_150px_150px_130px]',
        saldo < 0 && 'bg-[#fdf7f7]',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-primary-50 text-[11px] font-semibold text-primary-700">
          {iniciais(carteira.cliente)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-neutral-900">
            {carteira.cliente}
          </span>
          <span className="block truncate text-[11px] text-neutral-400">
            {carteira.tabelaPreco ? `tabela ${carteira.tabelaPreco}` : 'sem tabela'} · desde{' '}
            {new Date(carteira.criadoEm).toLocaleDateString('pt-BR')}
          </span>
        </span>
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-semibold lg:text-right',
          saldo < 0
            ? 'text-[var(--color-perigo)]'
            : saldo > 0
              ? 'text-[var(--color-sucesso)]'
              : 'text-neutral-400',
        )}
      >
        {saldo < 0 ? '− ' : ''}R$ {brl(carteira.saldo)}
      </span>

      <span className="font-mono text-[13px] text-neutral-600 lg:text-right">
        R$ {brl(carteira.limiteCredito)}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] lg:text-right',
          disponivel < 0 ? 'font-semibold text-[var(--color-perigo)]' : 'text-neutral-900',
        )}
      >
        {disponivel < 0 ? '− ' : ''}R$ {brl(carteira.disponivel)}
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        {carteira.bloqueadaParaCompra ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-perigo-fundo)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--color-perigo)]">
            <span className="size-1.5 rounded-full bg-current" />
            Bloqueada
          </span>
        ) : (
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
        )}
      </span>
    </button>
  );
}

function LinhaMovimento({
  movimento,
  podeEstornar,
  ocupado,
  aoEstornar,
}: {
  readonly movimento: MovimentoCarteira;
  readonly podeEstornar: boolean;
  readonly ocupado: boolean;
  readonly aoEstornar: () => void;
}) {
  const credito = movimento.sentido === 'CREDITO';
  const { data, hora } = dataHora(movimento.criadoEm);
  const criaDinheiro = EXIGEM_MOTIVO.has(movimento.tipo);
  const saldo = Number(movimento.saldoPosterior);

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5',
        'sm:grid sm:grid-cols-[92px_118px_minmax(0,1fr)_92px_92px_104px_118px] sm:px-5',
        movimento.estornado && 'bg-neutral-25 opacity-60',
        movimento.excedeuLimite && 'bg-[#fdf5f5]',
        !movimento.estornado && !movimento.excedeuLimite && criaDinheiro && 'bg-[#fdfaf6]',
      )}
    >
      {/* Data e hora empilhadas: lado a lado não cabem na coluna, e o que
          quebrava era a hora — justamente o que separa dois lançamentos do
          mesmo dia. */}
      <span className="order-1 font-mono text-[11.5px] text-neutral-500 sm:order-none">
        <span className="sm:block">{data}</span>{' '}
        <span className="text-neutral-400 sm:block">{hora}</span>
      </span>

      <span className="order-2 sm:order-none">
        <span
          className={juntar(
            'inline-flex items-center rounded px-2 py-0.5 text-[11.5px] font-medium',
            tomDoTipo(movimento.tipo),
          )}
        >
          {ROTULO_TIPO[movimento.tipo] ?? movimento.tipo}
        </span>
      </span>

      <div className="order-4 w-full min-w-0 sm:order-none sm:w-auto">
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-neutral-900">
          {documentoDe(movimento)}
          {/* Os tipos que criam dinheiro sem contrapartida aparecem
              destacados. docs/WALLET.md §7. */}
          {criaDinheiro ? (
            <span className="shrink-0 rounded bg-[var(--color-atencao-fundo)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-atencao)]">
              sem contrapartida
            </span>
          ) : null}
          {movimento.excedeuLimite ? (
            <span className="shrink-0 rounded bg-[var(--color-perigo-fundo)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-perigo)]">
              acima do limite
            </span>
          ) : null}
          {movimento.estornado ? (
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-500">
              estornado
            </span>
          ) : null}
        </p>
        {movimento.justificativa ? (
          <p
            className={juntar(
              'text-[11.5px]',
              movimento.excedeuLimite
                ? 'text-[var(--color-perigo)]'
                : criaDinheiro
                  ? 'text-[var(--color-atencao)]'
                  : 'text-neutral-500',
            )}
          >
            {movimento.justificativa}
          </p>
        ) : null}
      </div>

      <span className="order-3 text-right font-mono text-[13.5px] font-semibold text-[var(--color-sucesso)] sm:order-none">
        {credito ? `R$ ${brl(movimento.valor)}` : <span className="text-neutral-300">—</span>}
      </span>

      <span className="order-3 text-right font-mono text-[13.5px] font-semibold text-[var(--color-perigo)] sm:order-none">
        {credito ? <span className="text-neutral-300">—</span> : `R$ ${brl(movimento.valor)}`}
      </span>

      <span
        className={juntar(
          'order-5 text-right font-mono text-[12.5px] sm:order-none',
          saldo < 0 ? 'text-[var(--color-perigo)]' : 'text-[var(--color-sucesso)]',
        )}
        title="Saldo depois deste movimento"
      >
        {saldo < 0 ? '− ' : ''}R$ {brl(saldo)}
      </span>

      {/* O estorno mora embaixo de quem lançou. Numa coluna própria ele
          roubava a largura do documento — e é o documento que se lê. */}
      <span className="order-6 flex min-w-0 flex-col sm:order-none">
        <span className="truncate text-[12px] text-neutral-500">
          {/* `null` é movimento do próprio sistema, não um nome que faltou. */}
          {movimento.ator ?? 'Sistema'}
        </span>
        {podeEstornar && !movimento.estornado && movimento.estornoDeId === null ? (
          <button
            type="button"
            onClick={aoEstornar}
            disabled={ocupado}
            className="self-start text-[11.5px] font-medium text-[var(--color-perigo)] underline decoration-[#f0c9cb] underline-offset-2 disabled:opacity-50"
          >
            estornar
          </button>
        ) : null}
      </span>
    </div>
  );
}
