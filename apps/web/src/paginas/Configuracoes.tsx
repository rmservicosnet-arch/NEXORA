import { PERM, type AlteracaoConfiguracao, type ConfiguracaoEmpresa } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/**
 * As seis seções da proposta.
 *
 * Só "Vendas e pedidos" tem o que configurar hoje. As outras aparecem porque
 * a navegação é o mapa do que a configuração cobre — escondê-las faria o
 * mapa mentir por omissão. Cada uma diz o que ainda não tem.
 */
const SECOES = [
  { chave: 'geral', rotulo: 'Geral' },
  { chave: 'vendas', rotulo: 'Vendas e pedidos' },
  { chave: 'estoque', rotulo: 'Estoque' },
  { chave: 'caixa', rotulo: 'Caixa' },
  { chave: 'notificacoes', rotulo: 'Notificações' },
  { chave: 'integracoes', rotulo: 'Integrações' },
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

const COBRANCAS = [
  { valor: 'NO_FATURAMENTO' as const, nome: 'No faturamento' },
  { valor: 'NA_CONFIRMACAO' as const, nome: 'Na confirmação' },
];

/** O rascunho: o que está na tela antes de "Salvar alterações". */
type Rascunho = Required<
  Pick<
    AlteracaoConfiguracao,
    | 'modoCheckout'
    | 'momentoCobranca'
    | 'validadePedidoHoras'
    | 'prazoReservaHoras'
    | 'permitirSaldoNegativo'
    | 'exigirAceiteAumento'
    | 'modoCaixa'
    | 'pushDetalhado'
  >
>;

function rascunhoDe(c: ConfiguracaoEmpresa): Rascunho {
  return {
    modoCheckout: c.modoCheckout,
    momentoCobranca: c.momentoCobranca,
    validadePedidoHoras: c.validadePedidoHoras,
    prazoReservaHoras: c.prazoReservaHoras,
    permitirSaldoNegativo: c.permitirSaldoNegativo,
    exigirAceiteAumento: c.exigirAceiteAumento,
    modoCaixa: c.modoCaixa,
    pushDetalhado: c.pushDetalhado,
  };
}

export function Configuracoes() {
  const { usuario, pode } = useSessao();
  const fila = useQueryClient();

  const [secao, setSecao] = useState<Secao>('vendas');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const podeEditar = pode(PERM.configuracao.editar);

  const consulta = useQuery({
    queryKey: ['configuracao'],
    queryFn: () => pedir<ConfiguracaoEmpresa>('/configuracao'),
  });

  // O rascunho nasce do servidor e só é substituído quando o servidor muda.
  useEffect(() => {
    if (consulta.data) setRascunho(rascunhoDe(consulta.data));
  }, [consulta.data]);

  const salvar = useMutation({
    mutationFn: (dados: Rascunho) =>
      pedir<ConfiguracaoEmpresa>('/configuracao', { method: 'PATCH', body: dados }),
    onSuccess: async (nova) => {
      setErro(null);
      setSalvo(true);
      fila.setQueryData(['configuracao'], nova);
      // A configuração muda o comportamento de outras telas: o checkout do
      // portal, o prazo da reserva, o caixa. Cache antigo faria a tela
      // seguinte trabalhar com a regra anterior.
      await fila.invalidateQueries({ queryKey: ['pedidos'] });
      await fila.invalidateQueries({ queryKey: ['clientes'] });
    },
    onError: (e) => {
      setSalvo(false);
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  if (consulta.isPending || !rascunho) {
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
  const salvo_ = rascunhoDe(cfg);
  const sujo = (Object.keys(salvo_) as (keyof Rascunho)[]).some((k) => rascunho[k] !== salvo_[k]);

  function mexer(mudanca: Partial<Rascunho>) {
    setSalvo(false);
    setRascunho((a) => (a ? { ...a, ...mudanca } : a));
  }

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <h1 className="font-display text-[18px] font-bold text-neutral-900">Configurações</h1>
        <span className="hidden text-[13px] text-neutral-500 sm:inline">
          · {usuario?.nome ? 'sua empresa' : ''}
        </span>

        <div className="hidden flex-1 sm:block" />

        {/*
          Nada é salvo a cada clique. Configuração muda o comportamento da
          empresa inteira — quem mexe precisa poder revisar e desistir.
        */}
        {podeEditar ? (
          <>
            <Botao
              variante="secundario"
              disabled={!sujo || salvar.isPending}
              onClick={() => {
                setRascunho(rascunhoDe(cfg));
                setErro(null);
                setSalvo(false);
              }}
            >
              Descartar
            </Botao>
            <Botao
              variante="primario"
              disabled={!sujo}
              carregando={salvar.isPending}
              onClick={() => salvar.mutate(rascunho)}
            >
              Salvar alterações
            </Botao>
          </>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <nav
          aria-label="Seções de configuração"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-100 bg-white p-3 lg:w-[216px] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:p-4"
        >
          {SECOES.map((s) => (
            <button
              key={s.chave}
              type="button"
              onClick={() => setSecao(s.chave)}
              className={juntar(
                'flex h-9 shrink-0 items-center rounded-md px-2.5 text-left text-[13.5px]',
                secao === s.chave
                  ? 'bg-primary-50 font-semibold text-primary-700'
                  : 'text-neutral-700 hover:bg-neutral-50',
              )}
            >
              {s.rotulo}
            </button>
          ))}
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível salvar">
              {erro}
            </Aviso>
          ) : null}
          {salvo && !sujo ? <Aviso tom="sucesso">Configuração salva.</Aviso> : null}
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
                  <strong className="font-semibold text-neutral-700">O PDV não é afetado</strong> —
                  a venda de balcão continua imediata.
                </p>
              </div>

              <Cartao
                titulo="O carrinho do cliente gera"
                ajuda="Configuração por empresa. Cada cadastro de cliente pode sobrepor a dele."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {MODOS.map((m) => (
                    <Escolha
                      key={m.valor}
                      ativo={rascunho.modoCheckout === m.valor}
                      titulo={m.titulo}
                      descricao={m.descricao}
                      selo={m.selo}
                      editavel={podeEditar}
                      aoEscolher={() => mexer({ modoCheckout: m.valor })}
                    />
                  ))}
                </div>

                {rascunho.modoCheckout === 'PAGAMENTO_IMEDIATO' ? (
                  <Aviso tom="atencao">
                    Sem carteira não há pagamento imediato: não existe conta de onde tirar o
                    dinheiro, e o checkout desses clientes é recusado com motivo.
                  </Aviso>
                ) : null}
              </Cartao>

              {rascunho.modoCheckout === 'PEDIDO_COM_CONFIRMACAO' ? (
                <Cartao>
                  <div>
                    <h3 className="font-display text-[14.5px] font-semibold text-neutral-900">
                      Quando gerar a cobrança
                      {inerte('momentoCobranca') ? <SeloSemEfeito /> : null}
                    </h3>
                    <p className="mb-2.5 text-[12.5px] text-neutral-500">
                      Momento em que o contas a receber é criado para o pedido.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {COBRANCAS.map((c) => (
                        <button
                          key={c.valor}
                          type="button"
                          aria-pressed={rascunho.momentoCobranca === c.valor}
                          disabled={!podeEditar || inerte('momentoCobranca')}
                          onClick={() => mexer({ momentoCobranca: c.valor })}
                          className={juntar(
                            'h-9 rounded-md border px-3.5 text-[13px] font-medium disabled:opacity-60',
                            rascunho.momentoCobranca === c.valor
                              ? 'border-primary-600 bg-primary-50 text-primary-700'
                              : 'border-neutral-200 bg-white text-neutral-600',
                          )}
                        >
                          {c.nome}
                        </button>
                      ))}
                    </div>
                    {inerte('momentoCobranca') ? <ExplicacaoSemEfeito /> : null}
                  </div>

                  <div className="border-t border-neutral-100" />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Numero
                      rotulo="Validade do pedido"
                      valor={rascunho.validadePedidoHoras}
                      ajuda="Depois disso o preço congelado vence. Um pedido não confirmado é expirado pela rotina."
                      editavel={podeEditar}
                      aoMudar={(v) => mexer({ validadePedidoHoras: v })}
                    />
                    <Numero
                      rotulo="Prazo da reserva confirmada"
                      valor={rascunho.prazoReservaHoras}
                      ajuda="Pedido confirmado e não faturado libera o estoque reservado. Padrão proposto: 7 dias."
                      editavel={podeEditar}
                      aoMudar={(v) => mexer({ prazoReservaHoras: v })}
                    />
                  </div>

                  <div className="border-t border-neutral-100" />

                  <Regra
                    titulo="Exigir aceite quando o total sobe"
                    descricao="A equipe inclui itens acordados. Se o total passar do que o cliente enviou, o pedido espera o aceite dele antes de ser confirmado."
                    valor={rascunho.exigirAceiteAumento ? 'Exigido' : 'Dispensado'}
                    tom={rascunho.exigirAceiteAumento ? 'ok' : 'alerta'}
                    editavel={podeEditar}
                    aoAlternar={() => mexer({ exigirAceiteAumento: !rascunho.exigirAceiteAumento })}
                  />
                </Cartao>
              ) : null}

              <Cartao titulo="Regras de estoque e caixa">
                <Regra
                  titulo="Venda com saldo negativo"
                  descricao="Permite concluir venda e confirmar pedido sem saldo. A divergência é registrada no razão e vai para a fila de regularização."
                  valor={rascunho.permitirSaldoNegativo ? 'Permitido' : 'Bloqueado'}
                  tom={rascunho.permitirSaldoNegativo ? 'ok' : 'alerta'}
                  editavel={podeEditar}
                  aoAlternar={() =>
                    mexer({ permitirSaldoNegativo: !rascunho.permitirSaldoNegativo })
                  }
                />
                <Regra
                  titulo="Modo de caixa"
                  descricao="Define se cada vendedor abre o próprio caixa ou se a loja opera com caixa compartilhado por turno."
                  valor={rascunho.modoCaixa === 'POR_OPERADOR' ? 'Por operador' : 'Compartilhado'}
                  tom="neutro"
                  editavel={podeEditar}
                  aoAlternar={() =>
                    mexer({
                      modoCaixa:
                        rascunho.modoCaixa === 'POR_OPERADOR'
                          ? 'COMPARTILHADO_POR_LOJA'
                          : 'POR_OPERADOR',
                    })
                  }
                />
                <Regra
                  titulo="Detalhe na notificação push"
                  descricao="Com isto desligado, a notificação não mostra cliente nem valor na tela bloqueada do aparelho."
                  valor={rascunho.pushDetalhado ? 'Ligado' : 'Desligado'}
                  tom="neutro"
                  editavel={podeEditar && !inerte('pushDetalhado')}
                  semEfeito={inerte('pushDetalhado')}
                  aoAlternar={() => mexer({ pushDetalhado: !rascunho.pushDetalhado })}
                />
              </Cartao>
            </>
          ) : (
            <Vazia rotulo={SECOES.find((s) => s.chave === secao)?.rotulo ?? ''} secao={secao} />
          )}
        </main>
      </div>
    </>
  );
}

function SeloSemEfeito() {
  return (
    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 align-middle text-[10.5px] font-semibold text-neutral-500">
      ainda sem efeito
    </span>
  );
}

function ExplicacaoSemEfeito() {
  return (
    <p className="mt-1.5 text-[11.5px] text-neutral-400">
      O campo existe no banco e nenhum código o consulta. Fica visível para não parecer esquecido, e
      desabilitado para não prometer o que não acontece.
    </p>
  );
}

function Cartao({
  titulo,
  ajuda,
  children,
}: {
  readonly titulo?: string;
  readonly ajuda?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm sm:px-[18px] sm:py-4">
      {titulo ? (
        <div>
          <h3 className="font-display text-[15px] font-semibold text-neutral-900">{titulo}</h3>
          {ajuda ? <p className="text-[12.5px] text-neutral-500">{ajuda}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Escolha({
  ativo,
  titulo,
  descricao,
  selo,
  editavel,
  aoEscolher,
}: {
  readonly ativo: boolean;
  readonly titulo: string;
  readonly descricao: string;
  readonly selo: string;
  readonly editavel: boolean;
  readonly aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      disabled={!editavel}
      onClick={aoEscolher}
      className={juntar(
        'flex flex-col gap-2 rounded-lg border p-4 text-left disabled:opacity-70',
        ativo
          ? 'border-primary-600 bg-primary-50'
          : 'border-neutral-200 bg-white hover:bg-neutral-25',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={juntar(
            'flex size-[17px] shrink-0 items-center justify-center rounded-full border-2',
            ativo ? 'border-primary-600' : 'border-neutral-300',
          )}
          aria-hidden="true"
        >
          {ativo ? <span className="size-2 rounded-full bg-primary-600" /> : null}
        </span>
        <span className="text-[14px] font-semibold text-neutral-900">{titulo}</span>
      </span>
      <span className="text-[12.5px] leading-[18px] text-neutral-600">{descricao}</span>
      <span
        className={juntar(
          'w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold',
          ativo ? 'bg-primary-100 text-primary-700' : 'bg-neutral-100 text-neutral-500',
        )}
      >
        {selo}
      </span>
    </button>
  );
}

function Numero({
  rotulo,
  valor,
  ajuda,
  editavel,
  aoMudar,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly ajuda: string;
  readonly editavel: boolean;
  readonly aoMudar: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
        {rotulo}
        <span className="mt-1 flex items-center gap-2">
          <input
            value={String(valor)}
            disabled={!editavel}
            inputMode="numeric"
            onChange={(e) => aoMudar(Number(e.target.value.replace(/\D/g, '')) || 0)}
            className="h-[38px] w-24 rounded-md border border-neutral-200 px-3 font-mono text-[14px] text-neutral-900 disabled:opacity-60"
          />
          <span className="text-[12.5px] font-normal normal-case tracking-normal text-neutral-500">
            horas
          </span>
        </span>
      </label>
      <p className="text-[12px] leading-[17px] text-neutral-500">{ajuda}</p>
    </div>
  );
}

/**
 * Uma regra: título, explicação, e o valor numa pílula à direita.
 *
 * A pílula É o controle — clicar alterna. Na proposta ela parece só um
 * indicador, mas há um "Salvar alterações" no cabeçalho: um painel de
 * configuração com valores que não se mudam seria um relatório.
 */
function Regra({
  titulo,
  descricao,
  valor,
  tom,
  editavel,
  semEfeito = false,
  aoAlternar,
}: {
  readonly titulo: string;
  readonly descricao: string;
  readonly valor: string;
  readonly tom: 'ok' | 'alerta' | 'neutro';
  readonly editavel: boolean;
  readonly semEfeito?: boolean;
  readonly aoAlternar: () => void;
}) {
  const cores =
    tom === 'ok'
      ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
      : tom === 'alerta'
        ? 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]'
        : 'bg-primary-50 text-primary-700';

  return (
    <div className="flex flex-col gap-1 border-t border-neutral-50 pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-neutral-900">
            {titulo}
            {semEfeito ? <SeloSemEfeito /> : null}
          </p>
          <p className="text-[12.5px] leading-[17px] text-neutral-500">{descricao}</p>
        </div>

        <button
          type="button"
          disabled={!editavel}
          aria-label={`${titulo}: ${valor}. Alternar`}
          onClick={aoAlternar}
          className={juntar(
            'h-7 shrink-0 rounded-full px-3 text-[12px] font-semibold disabled:opacity-60',
            semEfeito ? 'bg-neutral-100 text-neutral-500' : cores,
          )}
        >
          {valor}
        </button>
      </div>
      {semEfeito ? <ExplicacaoSemEfeito /> : null}
    </div>
  );
}

/** As seções que a proposta prevê e que ainda não têm o que configurar. */
function Vazia({ rotulo, secao }: { readonly rotulo: string; readonly secao: Secao }) {
  const porque: Record<Secao, string> = {
    geral:
      'Fuso horário e moeda existem no banco com um valor só; não há segunda opção a escolher.',
    vendas: '',
    estoque:
      'A regra de saldo negativo fica em "Vendas e pedidos", junto das outras que valem para a operação toda.',
    caixa: 'O modo de caixa fica em "Vendas e pedidos", junto das demais regras de operação.',
    notificacoes:
      'Não há envio de notificação nenhum ainda. O único ajuste que existe — detalhe no push — está em "Vendas e pedidos".',
    integracoes: 'Nenhuma integração foi construída.',
  };

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-[20px] font-bold text-neutral-900">{rotulo}</h2>
      <Aviso tom="info">{porque[secao]}</Aviso>
    </div>
  );
}
