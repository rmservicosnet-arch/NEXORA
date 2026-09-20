import {
  PERM,
  type DestinoDevolucao,
  type ResultadoDevolucao,
  type Venda,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function inteiro(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

const SITUACAO: Record<Venda['status'], { texto: string; pilula: string }> = {
  RASCUNHO: { texto: 'Rascunho', pilula: 'bg-neutral-100 text-neutral-500' },
  CONCLUIDA: { texto: 'Concluída', pilula: 'bg-[#e6f1eb] text-[#155537]' },
  DEVOLVIDA_PARCIAL: { texto: 'Devolvida em parte', pilula: 'bg-[#fbf0da] text-[#8f6206]' },
  DEVOLVIDA_TOTAL: { texto: 'Devolvida', pilula: 'bg-neutral-100 text-neutral-500' },
  CANCELADA: { texto: 'Cancelada', pilula: 'bg-[#fdf5f5] text-[var(--color-perigo)]' },
};

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  PRAZO: 'A prazo',
  CARTEIRA: 'Carteira',
};

const DESTINO: Record<DestinoDevolucao['onde'], { rotulo: string; caixa: string; texto: string }> =
  {
    TITULO: {
      rotulo: 'Título',
      caixa: 'border-primary-100 bg-primary-50',
      texto: 'text-primary-800',
    },
    CARTEIRA: {
      rotulo: 'Carteira',
      caixa: 'border-[#c8cfec] bg-[#eef0fa]',
      texto: 'text-primary-800',
    },
    CAIXA: { rotulo: 'Gaveta', caixa: 'border-[#bfdccb] bg-[#e6f1eb]', texto: 'text-[#155537]' },
  };

/** O que basta de motivo para o servidor aceitar. Menos é rascunho. */
const MOTIVO_MINIMO = 5;

/**
 * Uma venda, e as duas coisas que só se fazem daqui.
 *
 * CANCELAR apaga o faturamento inteiro e devolve tudo — inclusive o que o
 * cliente levou e ficou com ele. DEVOLVER tira só o que voltou, e a venda
 * continua existindo pelo que ficou. São operações diferentes, e a tela diz
 * isso antes de oferecer as duas.
 *
 * O painel da direita mostra PARA ONDE VAI O DINHEIRO antes de alguém
 * confirmar — e o número vem do servidor, da mesma função que vai executar a
 * devolução. Calcular a prévia aqui seria a regra de dinheiro escrita duas
 * vezes, e a segunda envelhecendo em silêncio.
 */
export function VendaDetalhe() {
  const { id = '' } = useParams();
  const { pode } = useSessao();
  const fila = useQueryClient();
  const navegar = useNavigate();

  const consulta = useQuery({
    queryKey: ['vendas', 'detalhe', id],
    queryFn: () => pedir<Venda>(`/vendas/${id}`),
  });

  const venda = consulta.data;

  if (consulta.isPending) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoCarregando titulo="Abrindo a venda…" />
      </main>
    );
  }

  if (consulta.isError || !venda) {
    return (
      <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <EstadoErro
          titulo="Não foi possível abrir a venda"
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

  return (
    <Corpo
      venda={venda}
      podeDevolver={pode(PERM.venda.devolver)}
      podeCancelar={pode(PERM.venda.cancelar)}
      aoMudar={() => {
        void fila.invalidateQueries({ queryKey: ['vendas'] });
        void fila.invalidateQueries({ queryKey: ['carteiras'] });
        void fila.invalidateQueries({ queryKey: ['contas'] });
        void fila.invalidateQueries({ queryKey: ['caixa'] });
      }}
      aoCancelar={() => navegar('/vendas')}
    />
  );
}

function Corpo({
  venda,
  podeDevolver,
  podeCancelar,
  aoMudar,
  aoCancelar,
}: {
  readonly venda: Venda;
  readonly podeDevolver: boolean;
  readonly podeCancelar: boolean;
  readonly aoMudar: () => void;
  readonly aoCancelar: () => void;
}) {
  /*
    O estado carrega o id do DONO: ir de uma venda para outra não remonta este
    componente — a rota é a mesma, muda o parâmetro. Sem isto, a quantidade
    escolhida numa venda apareceria na seguinte.
  */
  const [dono, setDono] = useState(venda.id);
  const [devolvendo, setDevolvendo] = useState(false);
  const [escolhas, setEscolhas] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');

  if (dono !== venda.id) {
    setDono(venda.id);
    setDevolvendo(false);
    setEscolhas({});
    setMotivo('');
    setErro(null);
    setCancelando(false);
    setMotivoCancelamento('');
  }

  const situacao = SITUACAO[venda.status];
  const encerrada = venda.status === 'CANCELADA' || venda.status === 'DEVOLVIDA_TOTAL';

  const escolhidos = Object.entries(escolhas).filter(([, q]) => q > 0);
  const unidades = escolhidos.reduce((soma, [, q]) => soma + q, 0);

  const valorEscolhido = escolhidos.reduce((soma, [itemId, q]) => {
    const item = venda.itens.find((i) => i.id === itemId);
    if (!item) return soma;
    return soma + (Number(item.totalItem) / Number(item.quantidade)) * q;
  }, 0);

  /*
    A PRÉVIA vem do servidor, da mesma função que vai executar a devolução: ela
    roda inteira e desfaz no fim. As recusas do caminho — caixa fechado, valor
    sem destino — aparecem AQUI, antes de a pessoa apertar o botão.

    O motivo não muda para onde o dinheiro vai, então a prévia usa um texto
    fixo: exigi-lo antes faria a tela ficar muda justamente enquanto quem opera
    ainda está decidindo.
  */
  /*
    A previa custa uma transacao no servidor — ela roda a devolucao inteira e
    desfaz. Sem a espera, apertar "+" tres vezes abriria tres transacoes, e as
    duas primeiras so existiriam para serem jogadas fora.
  */
  const chave = JSON.stringify(escolhas);
  const [chaveEstavel, setChaveEstavel] = useState(chave);

  useEffect(() => {
    const id = setTimeout(() => setChaveEstavel(chave), 350);
    return () => clearTimeout(id);
  }, [chave]);

  const previa = useQuery({
    queryKey: ['vendas', 'previa', venda.id, chaveEstavel],
    enabled: devolvendo && unidades > 0,
    retry: false,
    queryFn: () =>
      pedir<ResultadoDevolucao>(`/vendas/${venda.id}/devolucoes/previa`, {
        method: 'POST',
        body: {
          motivo: 'Prévia da devolução',
          itens: escolhidos.map(([itemId, q]) => ({ itemId, quantidade: String(q) })),
        },
      }),
  });

  const devolver = useMutation({
    mutationFn: () =>
      pedir<ResultadoDevolucao>(`/vendas/${venda.id}/devolucoes`, {
        method: 'POST',
        body: {
          motivo: motivo.trim(),
          itens: escolhidos.map(([itemId, q]) => ({ itemId, quantidade: String(q) })),
        },
      }),
    onSuccess: () => {
      setDevolvendo(false);
      setEscolhas({});
      setMotivo('');
      setErro(null);
      aoMudar();
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível devolver.');
    },
  });

  const cancelar = useMutation({
    mutationFn: () =>
      pedir<Venda>(`/vendas/${venda.id}/cancelar`, {
        method: 'POST',
        body: { motivo: motivoCancelamento.trim() },
      }),
    onSuccess: () => {
      aoMudar();
      aoCancelar();
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível cancelar.');
    },
  });

  const recusa = previa.error instanceof ErroRequisicao ? previa.error.corpo.mensagem : null;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <Link to="/vendas" className="text-[13.5px] text-neutral-500 no-underline hover:underline">
          Vendas
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-mono text-[13.5px] font-medium text-neutral-900">{venda.numero}</span>

        <div className="flex-1" />

        {podeDevolver && !encerrada && !devolvendo ? (
          <Botao
            variante="primario"
            onClick={() => {
              setDevolvendo(true);
              setCancelando(false);
              setErro(null);
            }}
          >
            Devolver itens
          </Botao>
        ) : null}

        {podeCancelar && venda.status !== 'CANCELADA' ? (
          <button
            type="button"
            onClick={() => {
              setCancelando(!cancelando);
              setDevolvendo(false);
              setErro(null);
            }}
            className="h-9 rounded-md border border-[#f0c9cb] px-3.5 text-[13.5px] font-medium text-[var(--color-perigo)] hover:bg-[#fdf5f5]"
          >
            Cancelar venda
          </button>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6">
        {/*
          A diferença entre as duas operações, antes de oferecer as duas:
          "cancelar" é a palavra que a pessoa conhece, e é a errada aqui.
        */}
        {!encerrada ? (
          <Aviso tom="atencao" titulo="Devolver não é cancelar">
            Cancelar apaga o faturamento inteiro e devolve tudo — inclusive o que o cliente levou e
            ficou com ele. Devolver tira só o que voltou, e a venda continua existindo pelo que
            ficou.
          </Aviso>
        ) : null}

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        ) : null}

        {cancelando ? (
          <section className="flex flex-col gap-2.5 rounded-md border border-[#f0c9cb] bg-[#fdf5f5] p-4">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              Cancelar a venda {venda.numero}
            </h2>
            <p className="text-[12.5px] leading-[18px] text-[#8a1a21]">
              Todo o estoque volta, o débito na carteira é estornado e o título desta venda é
              cancelado. Título que já recebeu dinheiro derruba o cancelamento — alguém precisa
              decidir o que fazer com o que entrou.
            </p>
            <input
              value={motivoCancelamento}
              onChange={(e) => setMotivoCancelamento(e.target.value)}
              autoFocus
              placeholder="Por que esta venda está sendo cancelada?"
              className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
            />
            <div className="flex gap-2">
              <Botao
                variante="perigo"
                carregando={cancelar.isPending}
                disabled={motivoCancelamento.trim().length < MOTIVO_MINIMO}
                onClick={() => cancelar.mutate()}
              >
                Cancelar a venda
              </Botao>
              <Botao variante="secundario" onClick={() => setCancelando(false)}>
                Voltar
              </Botao>
            </div>
          </section>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-3.5 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Resumo venda={venda} situacao={situacao} />

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="min-w-full lg:min-w-[700px]">
                  <CabecalhoItens devolvendo={devolvendo} />
                  {venda.itens.map((i) => (
                    <LinhaItem
                      key={i.id}
                      item={i}
                      devolvendo={devolvendo}
                      escolhido={escolhas[i.id] ?? 0}
                      aoEscolher={(q) => setEscolhas({ ...escolhas, [i.id]: q })}
                    />
                  ))}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3">
                <span className="text-[12.5px] font-semibold text-neutral-700">
                  {venda.itens.length} {venda.itens.length === 1 ? 'item' : 'itens'} ·{' '}
                  {inteiro(venda.itens.reduce((s, i) => s + Number(i.quantidade), 0))} unidades
                  {Number(venda.valorDevolvido) > 0
                    ? ` · R$ ${brl(venda.valorDevolvido)} já voltaram`
                    : ''}
                </span>
                <div className="flex-1" />
                <span className="font-mono text-[14px] font-semibold tabular-nums text-neutral-900">
                  R$ {brl(venda.total)}
                </span>
              </div>
            </section>

            <Pagamentos venda={venda} />
          </div>

          {devolvendo ? (
            <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm lg:w-[352px]">
              <div className="shrink-0 border-b border-neutral-100 px-4 py-3">
                <h2 className="font-display text-[15px] font-bold text-neutral-900">
                  Devolver itens
                </h2>
                <p className="mt-0.5 text-[12px] leading-[17px] text-neutral-500">
                  Escolha a quantidade na tabela ao lado. O estoque volta pelo custo congelado na
                  saída.
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {unidades === 0 ? (
                  <p className="px-4 py-5 text-[12.5px] text-neutral-500">
                    Nenhuma unidade escolhida ainda.
                  </p>
                ) : (
                  <>
                    <div className="border-b border-neutral-50 px-4 py-2.5">
                      {escolhidos.map(([itemId, q]) => {
                        const item = venda.itens.find((i) => i.id === itemId);
                        if (!item) return null;
                        return (
                          <p
                            key={itemId}
                            className="flex items-baseline justify-between gap-2 text-[12.5px] text-neutral-700"
                          >
                            <span className="min-w-0 truncate">
                              {q} × {item.produto}
                            </span>
                            <span className="shrink-0 font-mono tabular-nums">
                              R$ {brl((Number(item.totalItem) / Number(item.quantidade)) * q)}
                            </span>
                          </p>
                        );
                      })}
                    </div>

                    <label className="flex flex-col gap-1 px-4 py-3">
                      <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                        Motivo
                      </span>
                      <textarea
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        rows={2}
                        placeholder="Dois kimonos vieram com defeito de costura"
                        className="rounded-md border border-neutral-200 px-2.5 py-2 text-[13px] leading-[18px]"
                      />
                      <span className="text-[11px] text-neutral-400">
                        Vai para a auditoria e para o razão de estoque. Obrigatório.
                      </span>
                    </label>

                    <div className="flex flex-col gap-1.5 px-4 pb-3">
                      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                        Para onde vai o dinheiro
                      </p>

                      {previa.isFetching || chaveEstavel !== chave ? (
                        <p className="text-[12px] text-neutral-400">Calculando no servidor…</p>
                      ) : recusa ? (
                        <Aviso tom="perigo" titulo="Esta devolução não pode ser feita">
                          {recusa}
                        </Aviso>
                      ) : (
                        (previa.data?.destinos ?? []).map((d, i) => {
                          const tom = DESTINO[d.onde];
                          return (
                            <div
                              key={`${d.onde}-${String(i)}`}
                              className={juntar('rounded-md border px-3 py-2', tom.caixa)}
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span
                                  className={juntar(
                                    'inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em]',
                                    tom.texto,
                                  )}
                                >
                                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white font-mono text-[10px]">
                                    {i + 1}
                                  </span>
                                  {tom.rotulo}
                                </span>
                                <span
                                  className={juntar(
                                    'shrink-0 font-mono text-[13.5px] font-medium tabular-nums',
                                    tom.texto,
                                  )}
                                >
                                  R$ {brl(d.valor)}
                                </span>
                              </div>
                              <p className={juntar('mt-0.5 text-[11.5px] leading-4', tom.texto)}>
                                {d.descricao}
                              </p>
                            </div>
                          );
                        })
                      )}

                      <p className="text-[11px] leading-[15px] text-neutral-400">
                        Cartão e PIX entram por fora da gaveta e o estorno acontece na maquineta:
                        sem carteira onde creditar, o sistema{' '}
                        <strong className="font-semibold text-neutral-600">recusa</strong> em vez de
                        deixar o valor sem dono.
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-2 border-t border-neutral-100 px-4 py-3">
                <Botao
                  variante="primario"
                  carregando={devolver.isPending}
                  disabled={
                    unidades === 0 ||
                    motivo.trim().length < MOTIVO_MINIMO ||
                    Boolean(recusa) ||
                    previa.isFetching ||
                    chaveEstavel !== chave
                  }
                  onClick={() => devolver.mutate()}
                >
                  {unidades === 0
                    ? 'Escolha o que volta'
                    : `Devolver ${String(unidades)} ${unidades === 1 ? 'unidade' : 'unidades'} — R$ ${brl(valorEscolhido)}`}
                </Botao>
                <button
                  type="button"
                  onClick={() => {
                    setDevolvendo(false);
                    setEscolhas({});
                    setMotivo('');
                  }}
                  className="h-8 text-[12.5px] text-neutral-500 hover:text-neutral-700"
                >
                  Cancelar
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </>
  );
}

function Resumo({
  venda,
  situacao,
}: {
  readonly venda: Venda;
  readonly situacao: { texto: string; pilula: string };
}) {
  const campos = [
    ['Quando', venda.concluidaEm ? new Date(venda.concluidaEm).toLocaleString('pt-BR') : '—'],
    ['Cliente', venda.cliente ?? 'Consumidor'],
    ['Vendedor', venda.vendedor],
    ['Loja', `${venda.loja} · ${venda.local}`],
  ];

  return (
    <section className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 rounded-md border border-neutral-100 bg-white px-4 py-3 shadow-sm">
      <div>
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
          Venda
        </p>
        <p className="font-display text-[24px] font-bold leading-7 tabular-nums text-neutral-900">
          {venda.numero}
        </p>
      </div>

      <div className="hidden w-px self-stretch bg-neutral-100 sm:block" />

      {campos.map(([rotulo, valor]) => (
        <div key={rotulo} className="min-w-0">
          <p className="text-[11px] text-neutral-400">{rotulo}</p>
          <p className="truncate text-[13px] text-neutral-900">{valor}</p>
        </div>
      ))}

      <div className="flex-1" />

      <div className="text-right">
        <p className="text-[11px] text-neutral-400">Total</p>
        <p className="font-display text-[22px] font-bold leading-6 tabular-nums text-neutral-900">
          R$ {brl(venda.total)}
        </p>
      </div>

      <span
        className={juntar(
          'inline-flex h-5 shrink-0 items-center rounded-full px-2.5 text-[11px] font-semibold',
          situacao.pilula,
        )}
      >
        {situacao.texto}
      </span>
    </section>
  );
}

const GRADE_ITENS = 'lg:grid-cols-[minmax(0,1fr)_62px_86px_100px_120px_110px]';

function CabecalhoItens({ devolvendo }: { readonly devolvendo: boolean }) {
  const colunas = [
    { t: 'Item' },
    { t: 'Qtd', a: true },
    { t: 'Já voltou', a: true },
    { t: 'Preço', a: true },
    { t: 'Total', a: true },
    { t: devolvendo ? 'Devolver' : '', a: true },
  ];

  return (
    <div
      className={juntar(
        'sticky top-0 z-10 hidden gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE_ITENS,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={`${c.t}-${String(i)}`}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            c.a && 'text-right',
          )}
        >
          {c.t}
        </span>
      ))}
    </div>
  );
}

function LinhaItem({
  item,
  devolvendo,
  escolhido,
  aoEscolher,
}: {
  readonly item: Venda['itens'][number];
  readonly devolvendo: boolean;
  readonly escolhido: number;
  readonly aoEscolher: (quantidade: number) => void;
}) {
  const vendida = Number(item.quantidade);
  const voltou = Number(item.quantidadeDevolvida);
  const restam = vendida - voltou;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 lg:grid',
        GRADE_ITENS,
        escolhido > 0 && 'bg-primary-50',
      )}
    >
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        <span className="block truncate text-[13px] text-neutral-900">
          {item.produto} <span className="text-neutral-500">· {item.descricaoVariacao}</span>
        </span>
        <span className="block truncate font-mono text-[10.5px] text-neutral-400">{item.sku}</span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-500 lg:text-right">
        {inteiro(vendida)}
      </span>

      {/* Zero não se escreve: "—" diz que nada voltou sem parecer um número. */}
      <span
        className={juntar(
          'font-mono text-[12.5px] lg:text-right',
          voltou > 0 ? 'font-medium text-[var(--color-atencao)]' : 'text-neutral-300',
        )}
      >
        {voltou > 0 ? inteiro(voltou) : '—'}
      </span>

      <span className="font-mono text-[12.5px] tabular-nums text-neutral-500 lg:text-right">
        {brl(item.precoUnitario)}
      </span>

      <span className="font-mono text-[13px] font-medium tabular-nums text-neutral-900 lg:text-right">
        {brl(item.totalItem)}
      </span>

      {/*
        UM controle, que o MODO libera. Fora do modo de devolução ele nem
        aparece — um stepper sempre visível e sem efeito ensinaria que apertar
        não faz nada.
      */}
      {devolvendo ? (
        <span className="flex items-center justify-end">
          {restam > 0 ? (
            <Stepper valor={escolhido} maximo={restam} aoMudar={aoEscolher} />
          ) : (
            <span className="text-[11.5px] text-neutral-400">tudo já voltou</span>
          )}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

function Stepper({
  valor,
  maximo,
  aoMudar,
}: {
  readonly valor: number;
  readonly maximo: number;
  readonly aoMudar: (v: number) => void;
}) {
  const passo = (delta: number) => aoMudar(Math.min(maximo, Math.max(0, valor + delta)));

  return (
    <span className="flex items-center">
      <button
        type="button"
        aria-label="Menos um"
        disabled={valor === 0}
        onClick={() => passo(-1)}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-l-md border border-neutral-200 text-neutral-700 disabled:text-neutral-300"
      >
        −
      </button>
      <span
        className={juntar(
          'flex h-[26px] w-[34px] items-center justify-center border-y border-neutral-200 font-mono text-[12.5px] font-medium tabular-nums',
          valor > 0 ? 'bg-primary-50 text-primary-800' : 'text-neutral-400',
        )}
      >
        {valor}
      </span>
      <button
        type="button"
        aria-label="Mais um"
        disabled={valor >= maximo}
        onClick={() => passo(1)}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-r-md border border-neutral-200 text-neutral-700 disabled:text-neutral-300"
      >
        +
      </button>
    </span>
  );
}

function Pagamentos({ venda }: { readonly venda: Venda }) {
  return (
    <section className="shrink-0 rounded-md border border-neutral-100 bg-white px-4 py-3 shadow-sm">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        Como foi pago
      </p>

      {venda.pagamentos.map((p, i) => (
        <p
          key={`${p.forma}-${String(i)}`}
          className="flex items-baseline justify-between gap-3 border-b border-neutral-50 py-1.5 text-[12.5px] text-neutral-700 last:border-0"
        >
          <span>
            {FORMA[p.forma] ?? p.forma}
            {p.parcelas > 1 ? ` · ${String(p.parcelas)}×` : ''}
            {p.bandeira ? ` · ${p.bandeira}` : ''}
            {p.ultimosQuatro ? ` ····${p.ultimosQuatro}` : ''}
          </span>
          <span className="shrink-0 font-mono tabular-nums">R$ {brl(p.valor)}</span>
        </p>
      ))}

      {Number(venda.troco) > 0 ? (
        <p className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px] text-neutral-500">
          <span>Troco devolvido</span>
          <span className="shrink-0 font-mono tabular-nums">− R$ {brl(venda.troco)}</span>
        </p>
      ) : null}

      {/*
        Não é enfeite: é desta lista que sai a ORDEM da devolução. Quem lê
        precisa poder prever o destino antes de o painel calcular.
      */}
      <p className="mt-2 text-[11.5px] leading-4 text-neutral-400">
        É desta lista que sai a ordem da devolução: o que o cliente ainda deve é abatido antes do
        que ele já pagou.
      </p>
    </section>
  );
}
