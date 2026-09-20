import { PERM, type AlteracaoConfiguracao, type ConfiguracaoEmpresa } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/**
 * As seções que a proposta prevê. Só "Vendas e pedidos" e "Estoque e caixa"
 * têm conteúdo hoje; as outras ficam de fora até terem o que configurar —
 * uma aba vazia promete uma tela que não existe.
 */
const SECOES = [
  { chave: 'vendas', rotulo: 'Vendas e pedidos' },
  { chave: 'operacao', rotulo: 'Estoque e caixa' },
] as const;

type Secao = (typeof SECOES)[number]['chave'];

const MODOS = [
  {
    valor: 'PAGAMENTO_IMEDIATO' as const,
    titulo: 'Pagamento imediato',
    descricao:
      'O carrinho vira venda na hora, com pagamento e baixa de estoque. Não passa por aprovação da equipe.',
    selo: 'Indicado para varejo',
  },
  {
    valor: 'PEDIDO_COM_CONFIRMACAO' as const,
    titulo: 'Pedido com confirmação',
    descricao:
      'O carrinho vira pedido aguardando confirmação. Sem efeito em estoque ou financeiro até a equipe conferir.',
    selo: 'Indicado para revenda e atacado',
  },
];

export function Configuracoes() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [secao, setSecao] = useState<Secao>('vendas');
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  const podeEditar = pode(PERM.configuracao.editar);

  const consulta = useQuery({
    queryKey: ['configuracao'],
    queryFn: () => pedir<ConfiguracaoEmpresa>('/configuracao'),
  });

  const salvar = useMutation({
    mutationFn: (dados: AlteracaoConfiguracao) =>
      pedir<ConfiguracaoEmpresa>('/configuracao', { method: 'PATCH', body: dados }),
    onSuccess: async (nova) => {
      setErro(null);
      setSalvo('Configuração salva.');
      // A configuração muda o comportamento de outras telas: o checkout do
      // portal, o prazo da reserva, o caixa. Deixar o cache antigo faria a
      // tela seguinte trabalhar com a regra anterior.
      fila.setQueryData(['configuracao'], nova);
      await fila.invalidateQueries({ queryKey: ['pedidos'] });
      await fila.invalidateQueries({ queryKey: ['clientes'] });
    },
    onError: (e) => {
      setSalvo(null);
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando configuração…" />;
  }

  if (consulta.isError || !consulta.data) {
    return (
      <EstadoErro
        titulo="Não foi possível carregar a configuração"
        descricao={
          consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente novamente em instantes.'
        }
      />
    );
  }

  const cfg = consulta.data;
  const inerte = (campo: string) => cfg.semEfeito.includes(campo);

  function mudar(dados: AlteracaoConfiguracao) {
    setSalvo(null);
    salvar.mutate(dados);
  }

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <h1 className="font-display text-[15px] font-semibold text-neutral-900">Configurações</h1>
        <div className="hidden flex-1 sm:block" />
        <span className="text-[12px] text-neutral-400">
          alterada em {new Date(cfg.alteradoEm).toLocaleDateString('pt-BR')}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 lg:flex-row">
          <nav
            aria-label="Seções"
            className="flex shrink-0 flex-row gap-1 lg:w-[180px] lg:flex-col"
          >
            {SECOES.map((s) => (
              <button
                key={s.chave}
                type="button"
                onClick={() => setSecao(s.chave)}
                className={juntar(
                  'h-9 rounded-md px-3 text-left text-[13px]',
                  secao === s.chave
                    ? 'bg-primary-50 font-semibold text-primary-700'
                    : 'text-neutral-600 hover:bg-neutral-50',
                )}
              >
                {s.rotulo}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {erro ? (
              <Aviso tom="perigo" titulo="Não foi possível salvar">
                {erro}
              </Aviso>
            ) : null}
            {salvo ? <Aviso tom="sucesso">{salvo}</Aviso> : null}
            {!podeEditar ? (
              <Aviso tom="info">
                Você pode ver a configuração, mas não alterá-la. Falta a permissão
                <span className="font-mono"> configuracao.editar</span>.
              </Aviso>
            ) : null}

            {secao === 'vendas' ? (
              <>
                <div>
                  <h2 className="font-display text-[20px] font-bold text-neutral-900">
                    Vendas e pedidos
                  </h2>
                  <p className="text-[13px] leading-[19px] text-neutral-500">
                    Define o que acontece quando um cliente finaliza o carrinho no portal.{' '}
                    <strong className="font-semibold text-neutral-700">O PDV não é afetado</strong>{' '}
                    — a venda de balcão continua imediata.
                  </p>
                </div>

                <Bloco
                  titulo="O carrinho do cliente gera"
                  ajuda="Configuração por empresa. Cada cadastro de cliente pode sobrepor a dele."
                >
                  <div className="flex flex-col gap-2">
                    {MODOS.map((m) => {
                      const ativo = cfg.modoCheckout === m.valor;
                      return (
                        <button
                          key={m.valor}
                          type="button"
                          aria-pressed={ativo}
                          disabled={!podeEditar || salvar.isPending}
                          onClick={() => mudar({ modoCheckout: m.valor })}
                          className={juntar(
                            'flex items-start gap-3 rounded-md border p-3 text-left disabled:opacity-60',
                            ativo
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-neutral-200 bg-white hover:bg-neutral-25',
                          )}
                        >
                          <span
                            className={juntar(
                              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                              ativo ? 'border-primary-600' : 'border-neutral-300',
                            )}
                            aria-hidden="true"
                          >
                            {ativo ? <span className="size-2 rounded-full bg-primary-600" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-medium text-neutral-900">
                              {m.titulo}
                            </span>
                            <span className="block text-[12.5px] leading-[17px] text-neutral-500">
                              {m.descricao}
                            </span>
                            <span
                              className={juntar(
                                'mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                ativo
                                  ? 'bg-primary-100 text-primary-700'
                                  : 'bg-neutral-100 text-neutral-500',
                              )}
                            >
                              {m.selo}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {cfg.modoCheckout === 'PAGAMENTO_IMEDIATO' ? (
                    <Aviso tom="atencao">
                      Sem carteira não há pagamento imediato: não existe conta de onde tirar o
                      dinheiro, e o checkout desses clientes é recusado com motivo.
                    </Aviso>
                  ) : null}
                </Bloco>

                {cfg.modoCheckout === 'PEDIDO_COM_CONFIRMACAO' ? (
                  <Bloco titulo="Prazos do pedido">
                    <Numero
                      rotulo="Validade do pedido"
                      valor={cfg.validadePedidoHoras}
                      unidade="horas"
                      ajuda="Depois disso o preço congelado vence. Um pedido não confirmado é expirado pela rotina."
                      editavel={podeEditar}
                      aoSalvar={(v) => mudar({ validadePedidoHoras: v })}
                    />
                    <Numero
                      rotulo="Prazo da reserva confirmada"
                      valor={cfg.prazoReservaHoras}
                      unidade="horas"
                      ajuda="Pedido confirmado e não faturado libera o estoque reservado. Reserva vencida já não segura saldo, mesmo antes da rotina passar."
                      editavel={podeEditar}
                      aoSalvar={(v) => mudar({ prazoReservaHoras: v })}
                    />

                    <Chave
                      titulo="Exigir aceite quando o total sobe"
                      descricao="A equipe inclui itens acordados. Se o total passar do que o cliente enviou, o pedido espera o aceite dele antes de ser confirmado."
                      ligado={cfg.exigirAceiteAumento}
                      editavel={podeEditar}
                      aoMudar={(v) => mudar({ exigirAceiteAumento: v })}
                      alerta={
                        cfg.exigirAceiteAumento
                          ? null
                          : 'Desligado: a equipe confirma cobrando mais que o enviado, sem registro do aceite.'
                      }
                    />

                    <Chave
                      titulo="Gerar a cobrança na confirmação"
                      descricao="Em vez de no faturamento. O contas a receber nasceria junto com a reserva."
                      ligado={cfg.momentoCobranca === 'NA_CONFIRMACAO'}
                      editavel={podeEditar && !inerte('momentoCobranca')}
                      semEfeito={inerte('momentoCobranca')}
                      aoMudar={(v) =>
                        mudar({ momentoCobranca: v ? 'NA_CONFIRMACAO' : 'NO_FATURAMENTO' })
                      }
                    />
                  </Bloco>
                ) : null}
              </>
            ) : null}

            {secao === 'operacao' ? (
              <>
                <div>
                  <h2 className="font-display text-[20px] font-bold text-neutral-900">
                    Estoque e caixa
                  </h2>
                  <p className="text-[13px] leading-[19px] text-neutral-500">
                    Regras que valem para toda a operação, inclusive o PDV.
                  </p>
                </div>

                <Bloco titulo="Estoque">
                  <Chave
                    titulo="Venda com saldo negativo"
                    descricao="Permite concluir venda e confirmar pedido sem saldo. A divergência é registrada no razão e vai para a fila de regularização — permitido, nunca silencioso."
                    ligado={cfg.permitirSaldoNegativo}
                    editavel={podeEditar}
                    aoMudar={(v) => mudar({ permitirSaldoNegativo: v })}
                    alerta={
                      cfg.permitirSaldoNegativo
                        ? null
                        : 'Desligado: o balcão vai recusar venda de item sem saldo, mesmo com a mercadoria na mão.'
                    }
                  />
                </Bloco>

                <Bloco titulo="Caixa">
                  <div className="flex flex-col gap-2">
                    {(
                      [
                        {
                          valor: 'POR_OPERADOR' as const,
                          titulo: 'Por operador',
                          descricao: 'Cada vendedor abre e fecha o próprio caixa.',
                        },
                        {
                          valor: 'COMPARTILHADO_POR_LOJA' as const,
                          titulo: 'Compartilhado por loja',
                          descricao: 'Um caixa por turno, usado por quem estiver no balcão.',
                        },
                      ] as const
                    ).map((o) => {
                      const ativo = cfg.modoCaixa === o.valor;
                      return (
                        <button
                          key={o.valor}
                          type="button"
                          aria-pressed={ativo}
                          disabled={!podeEditar || salvar.isPending}
                          onClick={() => mudar({ modoCaixa: o.valor })}
                          className={juntar(
                            'flex items-start gap-3 rounded-md border p-3 text-left disabled:opacity-60',
                            ativo
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-neutral-200 bg-white hover:bg-neutral-25',
                          )}
                        >
                          <span
                            className={juntar(
                              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                              ativo ? 'border-primary-600' : 'border-neutral-300',
                            )}
                            aria-hidden="true"
                          >
                            {ativo ? <span className="size-2 rounded-full bg-primary-600" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-medium text-neutral-900">
                              {o.titulo}
                            </span>
                            <span className="block text-[12.5px] text-neutral-500">
                              {o.descricao}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Bloco>

                <Bloco titulo="Notificações">
                  <Chave
                    titulo="Detalhe na notificação"
                    descricao="Com isto desligado, a notificação não mostra cliente nem valor na tela bloqueada do aparelho."
                    ligado={cfg.pushDetalhado}
                    editavel={podeEditar && !inerte('pushDetalhado')}
                    semEfeito={inerte('pushDetalhado')}
                    aoMudar={(v) => mudar({ pushDetalhado: v })}
                  />
                </Bloco>
              </>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

function Bloco({
  titulo,
  ajuda,
  children,
}: {
  readonly titulo: string;
  readonly ajuda?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
      <div>
        <h3 className="font-display text-[14px] font-semibold text-neutral-900">{titulo}</h3>
        {ajuda ? <p className="text-[12px] text-neutral-500">{ajuda}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Uma chave liga/desliga.
 *
 * `semEfeito` não é o mesmo que `!editavel`: desabilitado por permissão é
 * "você não pode"; sem efeito é "isto ainda não faz nada em lugar nenhum".
 * A segunda é a que engana, porque parece configuração de verdade.
 */
function Chave({
  titulo,
  descricao,
  ligado,
  editavel,
  semEfeito = false,
  alerta = null,
  aoMudar,
}: {
  readonly titulo: string;
  readonly descricao: string;
  readonly ligado: boolean;
  readonly editavel: boolean;
  readonly semEfeito?: boolean;
  readonly alerta?: string | null;
  readonly aoMudar: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-50 pt-3 first:border-0 first:pt-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-neutral-900">
            {titulo}
            {semEfeito ? (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
                ainda sem efeito
              </span>
            ) : null}
          </p>
          <p className="text-[12.5px] leading-[17px] text-neutral-500">{descricao}</p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label={titulo}
          disabled={!editavel}
          onClick={() => aoMudar(!ligado)}
          className={juntar(
            'mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50',
            ligado ? 'bg-primary-600' : 'bg-neutral-300',
          )}
        >
          <span
            className={juntar(
              'size-5 rounded-full bg-white shadow-sm transition-transform',
              ligado && 'translate-x-5',
            )}
          />
        </button>
      </div>

      {semEfeito ? (
        <p className="text-[11.5px] text-neutral-400">
          O campo existe no banco e nenhum código o consulta. Fica visível para não parecer
          esquecido, e desligado para não prometer o que não acontece.
        </p>
      ) : null}
      {alerta ? <p className="text-[11.5px] text-[var(--color-atencao)]">{alerta}</p> : null}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  unidade,
  ajuda,
  editavel,
  aoSalvar,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly unidade: string;
  readonly ajuda: string;
  readonly editavel: boolean;
  readonly aoSalvar: (v: number) => void;
}) {
  const [rascunho, setRascunho] = useState(String(valor));
  const mudou = rascunho !== String(valor) && rascunho.trim() !== '';

  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-50 pt-3 first:border-0 first:pt-0">
      <label className="flex flex-wrap items-center gap-2">
        <span className="min-w-[180px] flex-1 text-[13.5px] font-medium text-neutral-900">
          {rotulo}
        </span>
        <input
          value={rascunho}
          disabled={!editavel}
          inputMode="numeric"
          onChange={(e) => setRascunho(e.target.value.replace(/\D/g, ''))}
          className="h-9 w-[84px] rounded-md border border-neutral-200 px-2 text-right font-mono text-[13.5px] disabled:opacity-60"
        />
        <span className="text-[12.5px] text-neutral-500">{unidade}</span>
        {mudou && editavel ? (
          <Botao tamanho="compacto" variante="primario" onClick={() => aoSalvar(Number(rascunho))}>
            Salvar
          </Botao>
        ) : null}
      </label>
      <p className="text-[12px] leading-[17px] text-neutral-500">{ajuda}</p>
    </div>
  );
}
