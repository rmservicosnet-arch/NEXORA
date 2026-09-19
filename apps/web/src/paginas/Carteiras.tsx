import {
  PERM,
  type Carteira,
  type ExtratoCarteira,
  type MovimentoCarteira,
  type PaginaCarteiras,
} from '@estoque/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(valor: string | number): string {
  return Math.abs(Number(valor)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Como um saldo é escrito na tela.
 *
 * O valor que trafega é negativo quando o cliente deve. A tela escreve "em
 * aberto" porque é o que o operador fala — mas o sinal nunca é invertido no
 * dado. Ver docs/WALLET.md §2.
 */
function rotuloDeSaldo(saldo: string): { texto: string; tom: 'devendo' | 'credito' | 'zerado' } {
  const n = Number(saldo);
  if (n < 0) return { texto: `R$ ${brl(n)} em aberto`, tom: 'devendo' };
  if (n > 0) return { texto: `R$ ${brl(n)} de crédito`, tom: 'credito' };
  return { texto: 'Zerado', tom: 'zerado' };
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

export function Carteiras() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [busca, setBusca] = useState('');
  const [soDevedores, setSoDevedores] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [tipo, setTipo] = useState('QUITACAO');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [formulario, setFormulario] = useState(false);

  const parametros = new URLSearchParams({ limite: '50' });
  if (busca.trim()) parametros.set('busca', busca.trim());
  if (soDevedores) parametros.set('apenasDevedores', 'true');

  const lista = useQuery({
    queryKey: ['carteiras', busca, soDevedores],
    queryFn: () => pedir<PaginaCarteiras>(`/carteira?${parametros.toString()}`),
    placeholderData: keepPreviousData,
  });

  const extrato = useQuery({
    queryKey: ['carteiras', 'extrato', selecionado],
    queryFn: () => pedir<ExtratoCarteira>(`/carteira/${selecionado ?? ''}/extrato?limite=100`),
    enabled: Boolean(selecionado),
  });

  const lancar = useMutation({
    mutationFn: () =>
      pedir<ExtratoCarteira>(`/carteira/${selecionado ?? ''}/lancamentos`, {
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
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível lançar.');
    },
  });

  const estornar = useMutation({
    mutationFn: (movimentoId: string) =>
      pedir<ExtratoCarteira>(`/carteira/${selecionado ?? ''}/lancamentos/${movimentoId}/estornar`, {
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
  const itens = lista.data?.itens ?? [];

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Carteiras</span>
        <div className="flex-1" />
        {lista.data ? (
          <span className="text-[13px] text-neutral-500">
            A receber:{' '}
            <strong className="font-mono font-semibold text-[--color-perigo]">
              R$ {brl(lista.data.totalAReceber)}
            </strong>
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="flex w-[380px] shrink-0 flex-col border-r border-neutral-100">
          <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-100 p-4">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome do cliente"
              aria-label="Buscar cliente"
              className="h-[35px] rounded-md border border-neutral-200 bg-white px-3 text-[13px]"
            />
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-neutral-600">
              <input
                type="checkbox"
                checked={soDevedores}
                onChange={(e) => setSoDevedores(e.target.checked)}
                className="size-3.5 accent-[--color-perigo]"
              />
              So quem esta devendo
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {lista.isPending ? <EstadoCarregando titulo="Carregando..." /> : null}

            {lista.isSuccess && itens.length === 0 ? (
              <EstadoVazio
                titulo="Nenhuma carteira"
                descricao="Clientes com conta corrente aparecem aqui."
              />
            ) : null}

            {itens.map((c) => (
              <LinhaCarteira
                key={c.id}
                carteira={c}
                ativo={c.clienteId === selecionado}
                aoSelecionar={() => {
                  setSelecionado(c.clienteId);
                  setFormulario(false);
                  setErro(null);
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!selecionado ? (
            <EstadoVazio
              titulo="Escolha um cliente"
              descricao="O extrato aparece aqui, com saldo, limite e cada lancamento."
            />
          ) : extrato.isPending ? (
            <EstadoCarregando titulo="Carregando extrato..." />
          ) : extrato.data ? (
            <>
              <div className="shrink-0 border-b border-neutral-100 bg-white p-5">
                <Cabecalho
                  carteira={extrato.data.carteira}
                  podeLancar={disponiveis.length > 0}
                  aoLancar={() => {
                    setFormulario((v) => !v);
                    setTipo(disponiveis[0]?.valor ?? 'QUITACAO');
                  }}
                />

                {erro ? (
                  <Aviso tom="perigo" className="mt-3" titulo="Nao foi possivel concluir">
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
                        className="h-10 w-[120px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[14px]"
                      />
                    </label>

                    <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                      <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                        Motivo{EXIGEM_MOTIVO.has(tipo) ? '' : ' (opcional)'}
                      </span>
                      <input
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder={
                          EXIGEM_MOTIVO.has(tipo)
                            ? 'Obrigatorio: este tipo cria dinheiro sem contrapartida'
                            : 'Comprovante, acordo, observacao'
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
                      Lancar
                    </Botao>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {extrato.data.movimentos.length === 0 ? (
                  <EstadoVazio titulo="Sem movimentos" descricao="Nada lancado ainda." />
                ) : (
                  extrato.data.movimentos.map((m) => (
                    <LinhaMovimento
                      key={m.id}
                      movimento={m}
                      podeEstornar={pode(PERM.carteira.estornar)}
                      ocupado={estornar.isPending}
                      aoEstornar={() => estornar.mutate(m.id)}
                    />
                  ))
                )}
              </div>

              <div className="flex h-11 shrink-0 items-center justify-end gap-5 border-t border-neutral-100 bg-neutral-25 px-5 text-[12.5px] text-neutral-500">
                <span>
                  Creditos{' '}
                  <strong className="font-mono text-[--color-sucesso]">
                    R$ {brl(extrato.data.totalCreditos)}
                  </strong>
                </span>
                <span>
                  Debitos{' '}
                  <strong className="font-mono text-[--color-perigo]">
                    R$ {brl(extrato.data.totalDebitos)}
                  </strong>
                </span>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}

function Cabecalho({
  carteira,
  podeLancar,
  aoLancar,
}: {
  readonly carteira: Carteira;
  readonly podeLancar: boolean;
  readonly aoLancar: () => void;
}) {
  const { texto, tom } = rotuloDeSaldo(carteira.saldo);

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate font-display text-[18px] font-semibold text-neutral-900">
          {carteira.cliente}
        </h1>
        <p
          className={juntar(
            'mt-0.5 font-mono text-[22px] font-bold leading-7',
            tom === 'devendo'
              ? 'text-[--color-perigo]'
              : tom === 'credito'
                ? 'text-[--color-sucesso]'
                : 'text-neutral-600',
          )}
        >
          {texto}
        </p>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Limite R$ {brl(carteira.limiteCredito)} · disponivel para compra{' '}
          <strong className="font-mono text-neutral-900">R$ {brl(carteira.disponivel)}</strong>
        </p>
        {carteira.bloqueadaParaCompra ? (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[--color-perigo-fundo] px-2 py-0.5 text-[11.5px] font-semibold text-[--color-perigo]">
            <span className="size-1.5 rounded-full bg-current" />
            Bloqueada para compra — quitacao continua liberada
          </p>
        ) : null}
      </div>

      {podeLancar ? (
        <Botao variante="primario" onClick={aoLancar}>
          Lancar
        </Botao>
      ) : null}
    </div>
  );
}

function LinhaCarteira({
  carteira,
  ativo,
  aoSelecionar,
}: {
  readonly carteira: Carteira;
  readonly ativo: boolean;
  readonly aoSelecionar: () => void;
}) {
  const { texto, tom } = rotuloDeSaldo(carteira.saldo);

  return (
    <button
      type="button"
      onClick={aoSelecionar}
      className={juntar(
        'flex w-full flex-col gap-0.5 border-b border-neutral-50 px-4 py-2.5 text-left',
        ativo ? 'bg-primary-50' : 'hover:bg-neutral-25',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13.5px] font-medium text-neutral-900">
          {carteira.cliente}
        </span>
        <span
          className={juntar(
            'shrink-0 font-mono text-[13px] font-semibold',
            tom === 'devendo'
              ? 'text-[--color-perigo]'
              : tom === 'credito'
                ? 'text-[--color-sucesso]'
                : 'text-neutral-400',
          )}
        >
          {texto}
        </span>
      </span>
      <span className="text-[11.5px] text-neutral-400">
        limite R$ {brl(carteira.limiteCredito)}
        {carteira.bloqueadaParaCompra ? ' · bloqueada' : ''}
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
  const quando = new Date(movimento.criadoEm);
  const criaDinheiro = EXIGEM_MOTIVO.has(movimento.tipo);

  return (
    <div
      className={juntar(
        'grid grid-cols-[124px_minmax(0,1fr)_120px_120px_86px] items-center gap-3 border-b border-neutral-50 px-5 py-2.5',
        movimento.estornado && 'bg-neutral-25 opacity-60',
        movimento.excedeuLimite && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">
        {quando.toLocaleDateString('pt-BR')}{' '}
        <span className="text-neutral-400">
          {quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-[13.5px] text-neutral-900">
          <span
            className={juntar(
              'size-1.5 shrink-0 rounded-full',
              credito ? 'bg-[--color-sucesso]' : 'bg-[--color-atencao]',
            )}
            aria-hidden="true"
          />
          {ROTULO_TIPO[movimento.tipo] ?? movimento.tipo}
          {movimento.vendaNumero !== null ? (
            <span className="text-neutral-400">· venda {movimento.vendaNumero}</span>
          ) : null}
          {/* Os tipos que criam dinheiro sem contrapartida aparecem
              destacados. docs/WALLET.md §7. */}
          {criaDinheiro ? (
            <span className="shrink-0 rounded bg-[--color-atencao-fundo] px-1.5 py-0.5 text-[10.5px] font-semibold text-[--color-atencao]">
              sem contrapartida
            </span>
          ) : null}
          {movimento.excedeuLimite ? (
            <span className="shrink-0 rounded bg-[--color-perigo-fundo] px-1.5 py-0.5 text-[10.5px] font-semibold text-[--color-perigo]">
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
          <p className="truncate text-[11.5px] text-neutral-500">{movimento.justificativa}</p>
        ) : null}
      </div>

      <span
        className={juntar(
          'text-right font-mono text-[13.5px] font-semibold',
          credito ? 'text-[--color-sucesso]' : 'text-[--color-perigo]',
        )}
      >
        {credito ? '+' : '-'} R$ {brl(movimento.valor)}
      </span>

      <span
        className="text-right font-mono text-[12.5px] text-neutral-500"
        title="Saldo depois deste movimento"
      >
        R$ {brl(movimento.saldoPosterior)}
        {Number(movimento.saldoPosterior) < 0 ? ' D' : ''}
      </span>

      <span className="text-right">
        {podeEstornar && !movimento.estornado && movimento.estornoDeId === null ? (
          <button
            type="button"
            onClick={aoEstornar}
            disabled={ocupado}
            className="text-[11.5px] font-medium text-[--color-perigo] underline decoration-[#f0c9cb] underline-offset-2 disabled:opacity-50"
          >
            estornar
          </button>
        ) : null}
      </span>
    </div>
  );
}
