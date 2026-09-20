import {
  PERM,
  type Caixa as CaixaDto,
  type CaixaAtual,
  type ContextoPdv,
  type PaginaCaixas,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(valor: string | number): string {
  return Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function Caixa() {
  const { pode, usuario } = useSessao();
  const fila = useQueryClient();

  const [lojaId, setLojaId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<
    'abrir' | 'fechar' | 'sangria' | 'suprimento' | null
  >(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');

  const contexto = useQuery({
    queryKey: ['pdv', 'contexto'],
    queryFn: () => pedir<ContextoPdv>('/vendas/contexto'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const lojas = contexto.data?.lojas ?? [];
    if (!lojaId && lojas.length > 0) {
      setLojaId(lojas[0]!.id);
    }
  }, [contexto.data, lojaId]);

  const atual = useQuery({
    queryKey: ['caixa', 'meu', lojaId],
    queryFn: () => pedir<CaixaAtual>(`/caixa/meu?lojaId=${lojaId}`),
    enabled: Boolean(lojaId),
  });

  const historico = useQuery({
    queryKey: ['caixa', 'historico'],
    queryFn: () => pedir<PaginaCaixas>('/caixa?limite=20'),
  });

  const caixa = atual.data?.caixa ?? null;

  function fechar() {
    setFormulario(null);
    setValor('');
    setMotivo('');
    setErro(null);
  }

  /**
   * Conferencia: o segundo par de olhos.
   *
   * A rota `POST /caixa/:id/conferir` existe com permissao propria desde o
   * inicio e nenhuma tela a chamava — metade do caminho do docs/CASHBOX.md §6
   * construida. Sem ela, "CONFERIDO" era um status que nada alcancava.
   */
  const conferir = useMutation({
    mutationFn: (id: string) =>
      pedir<CaixaDto>(`/caixa/${id}/conferir`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['caixa'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Nao foi possivel conferir.');
    },
  });

  const acao = useMutation({
    mutationFn: async () => {
      if (formulario === 'abrir') {
        return pedir<CaixaDto>('/caixa/abrir', {
          method: 'POST',
          body: { lojaId, valorAbertura: valor || '0', ...(motivo ? { observacao: motivo } : {}) },
        });
      }

      if (!caixa) throw new Error('sem caixa');

      if (formulario === 'fechar') {
        return pedir<CaixaDto>(`/caixa/${caixa.id}/fechar`, {
          method: 'POST',
          body: { valorContado: valor || '0', ...(motivo ? { observacao: motivo } : {}) },
        });
      }

      return pedir<CaixaDto>(`/caixa/${caixa.id}/movimento`, {
        method: 'POST',
        body: {
          tipo: formulario === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO',
          valor,
          motivo,
        },
      });
    },
    onSuccess: async () => {
      fechar();
      await fila.invalidateQueries({ queryKey: ['caixa'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  if (contexto.isPending) {
    return <EstadoCarregando titulo="Carregando…" />;
  }

  const lojas = contexto.data?.lojas ?? [];

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Caixa</span>

        <select
          value={lojaId}
          onChange={(e) => setLojaId(e.target.value)}
          aria-label="Loja"
          className="h-[35px] rounded-md border border-neutral-200 bg-white px-2.5 text-[13px]"
        >
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {caixa ? (
          <>
            {pode(PERM.caixa.suprimento) ? (
              <Botao
                variante="secundario"
                onClick={() => {
                  fechar();
                  setFormulario('suprimento');
                }}
              >
                Suprimento
              </Botao>
            ) : null}
            {pode(PERM.caixa.sangria) ? (
              <Botao
                variante="secundario"
                onClick={() => {
                  fechar();
                  setFormulario('sangria');
                }}
              >
                Sangria
              </Botao>
            ) : null}
            {pode(PERM.caixa.fechar) ? (
              <Botao
                variante="primario"
                onClick={() => {
                  fechar();
                  setFormulario('fechar');
                  setValor(caixa.resumo.esperadoEmCaixa);
                }}
              >
                Fechar caixa
              </Botao>
            ) : null}
          </>
        ) : pode(PERM.caixa.abrir) ? (
          <Botao
            variante="primario"
            onClick={() => {
              fechar();
              setFormulario('abrir');
            }}
          >
            Abrir caixa
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {/* A largura do artboard: 1440 menos o menu e a folga lateral. Com
              860px a tabela do turno e a lista de caixas nao cabiam lado a
              lado e viravam duas pilhas. */}
        <div className="flex w-full flex-col gap-4">
          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {formulario ? (
            <section className="flex flex-col gap-3 rounded-md border border-primary-100 bg-primary-50 p-5">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                {formulario === 'abrir'
                  ? 'Abrir caixa'
                  : formulario === 'fechar'
                    ? 'Fechar caixa'
                    : formulario === 'sangria'
                      ? 'Registrar sangria'
                      : 'Registrar suprimento'}
              </h2>

              {formulario === 'fechar' ? (
                <Aviso tom="atencao">
                  Informe o que foi <strong>contado na gaveta</strong>. A diferença para o esperado
                  fica registrada como é — o sistema não ajusta nada.
                </Aviso>
              ) : null}

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  {formulario === 'abrir'
                    ? 'Fundo de troco'
                    : formulario === 'fechar'
                      ? 'Valor contado'
                      : 'Valor'}
                </span>
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="h-12 w-full max-w-[200px] rounded-md border border-neutral-200 bg-white px-3 text-right font-mono text-[18px]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  {formulario === 'sangria' || formulario === 'suprimento'
                    ? 'Motivo'
                    : 'Observação (opcional)'}
                </span>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={
                    formulario === 'sangria'
                      ? 'Para onde foi o dinheiro'
                      : formulario === 'suprimento'
                        ? 'De onde veio o dinheiro'
                        : ''
                  }
                  className="h-11 rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
                />
              </label>

              <div className="flex gap-2">
                <Botao
                  variante="primario"
                  carregando={acao.isPending}
                  disabled={
                    valor.trim().length === 0 ||
                    ((formulario === 'sangria' || formulario === 'suprimento') &&
                      motivo.trim().length < 5)
                  }
                  onClick={() => acao.mutate()}
                >
                  Confirmar
                </Botao>
                <Botao variante="secundario" onClick={fechar}>
                  Cancelar
                </Botao>
              </div>
            </section>
          ) : null}

          {atual.isPending ? <EstadoCarregando titulo="Carregando caixa…" /> : null}

          {caixa ? <PainelCaixa caixa={caixa} /> : null}

          {!caixa && !atual.isPending && !formulario ? (
            <Aviso tom="info" titulo="Nenhum caixa aberto nesta loja">
              Enquanto não houver caixa aberto, o PDV recusa pagamento em dinheiro. Cartão e PIX
              continuam funcionando — eles não passam pela gaveta.
            </Aviso>
          ) : null}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            {caixa ? <MovimentosDoTurno caixa={caixa} /> : null}

            <section
              className={juntar(
                'flex w-full flex-col gap-3',
                caixa ? 'lg:w-[392px] lg:shrink-0' : '',
              )}
            >
              {/* A lista ACOMPANHA a altura da coluna ao lado e rola por
                  dentro: sem isso, igualar as colunas so mudava o vazio de
                  lugar — da pagina para dentro do cartao. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
                <div className="shrink-0 border-b border-neutral-100 px-4 py-3">
                  <h2 className="font-display text-[14px] font-semibold text-neutral-900">
                    Caixas anteriores
                  </h2>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {(historico.data?.itens ?? []).length === 0 ? (
                    <p className="p-5 text-[13px] text-neutral-500">
                      Nenhum caixa registrado ainda.
                    </p>
                  ) : (
                    (historico.data?.itens ?? []).map((c) => (
                      <LinhaHistorico
                        key={c.id}
                        caixa={c}
                        compacta={Boolean(caixa)}
                        podeConferir={pode(PERM.caixa.conferir)}
                        souEu={c.operadorId === usuario?.id}
                        conferindo={conferir.isPending && conferir.variables === c.id}
                        aoConferir={() => conferir.mutate(c.id)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* CASHBOX.md §7: sem `caixa.conferir` ninguem ve o caixa alheio,
                  nem na listagem. Dizer isso por escrito evita a pergunta
                  "por que a lista esta curta?". */}
              <p className="px-1 text-[11.5px] leading-4 text-neutral-500">
                {pode(PERM.caixa.conferir)
                  ? 'Voce ve caixas de outras pessoas porque tem caixa.conferir — e nao confere os seus: feita por quem fechou, a conferencia e assinatura em branco.'
                  : 'A lista mostra apenas os seus caixas: o valor da gaveta alheia e o que aquela pessoa vai ter de justificar no fechamento.'}
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

function PainelCaixa({ caixa }: { readonly caixa: CaixaDto }) {
  const r = caixa.resumo;

  const aberto = new Date(caixa.abertoEm);
  const ate = caixa.fechadoEm ? new Date(caixa.fechadoEm) : new Date();
  const minutos = Math.floor((ate.getTime() - aberto.getTime()) / 60_000);
  const horas = Math.floor(minutos / 60);
  const duracao = String(horas) + 'h' + String(minutos % 60).padStart(2, '0');

  return (
    <section className="overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-3.5 pt-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[17px] font-semibold text-neutral-900">
              Caixa #{caixa.numero}
            </h2>
            <Selo status={caixa.status} />
          </div>
          <p className="mt-1 text-[13px] text-neutral-500">
            {caixa.operador} · {caixa.loja} · aberto em{' '}
            {aberto.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {duracao}{' '}
            de turno
          </p>
        </div>

        <div className="text-right">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500">
            Esperado na gaveta
          </p>
          <p className="font-mono text-[30px] font-bold leading-9 tabular-nums text-neutral-900">
            R$ {brl(r.esperadoEmCaixa)}
          </p>
          <p className="text-[12px] text-neutral-400">
            é este valor que a contagem do fechamento tem de encontrar
          </p>
        </div>
      </div>

      {/*
        A conta aberta em PARCELAS, nunca só no total: quem confere precisa ver
        de onde cada uma veio, e diante de uma diferença a única saída seria
        aceitar o número. O troco é parcela própria porque é a que se esquece —
        e esquecê-la transforma todo caixa que deu troco numa falta.
        docs/CASHBOX.md §4.
      */}
      <div className="grid grid-cols-2 border-t border-neutral-100 bg-neutral-25 sm:grid-cols-3 lg:grid-cols-5">
        <Parcela rotulo="Fundo de troco" valor={r.valorAbertura} sinal="+" />
        <Parcela rotulo="Suprimentos" valor={r.suprimentos} sinal="+" tom="sucesso" />
        <Parcela rotulo="Sangrias" valor={r.sangrias} sinal="-" tom="perigo" />
        <Parcela rotulo="Dinheiro recebido" valor={r.dinheiroRecebido} sinal="+" />
        <Parcela rotulo="Troco devolvido" valor={r.trocoDevolvido} sinal="-" tom="perigo" />
      </div>

      {/* Cartão e PIX vão para a adquirente, não para a gaveta. Contá-los no
          fechamento faria o operador procurar, em espécie, um dinheiro que
          nunca esteve ali. docs/CASHBOX.md §1. */}
      <div className="border-t border-neutral-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="text-neutral-400"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
          </svg>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Não entra na gaveta — vai para a adquirente
          </p>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-[12px] text-neutral-500">Cartão</p>
            <p className="font-mono text-[14px] tabular-nums text-neutral-700">
              R$ {brl(r.vendasEmCartao)}
            </p>
          </div>
          <div>
            <p className="text-[12px] text-neutral-500">PIX</p>
            <p className="font-mono text-[14px] tabular-nums text-neutral-700">
              R$ {brl(r.vendasEmPix)}
            </p>
          </div>
          <div>
            <p className="text-[12px] text-neutral-500">Outras formas</p>
            <p className="font-mono text-[14px] tabular-nums text-neutral-700">
              R$ {brl(r.outrasFormas)}
            </p>
          </div>
          <div>
            <p className="text-[12px] text-neutral-500">
              Vendido no turno{' '}
              <span className="text-neutral-400">
                · {r.quantidadeVendas} venda{r.quantidadeVendas === 1 ? '' : 's'}
              </span>
            </p>
            <p className="font-mono text-[14px] font-medium tabular-nums text-neutral-900">
              R$ {brl(r.totalVendido)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * O razão do turno.
 *
 * Append-only como todo razão daqui: sangria e suprimento não se corrigem,
 * lança-se o contrário. O motivo é obrigatório justamente para ser lido nesta
 * tabela — dinheiro que saiu sem motivo escrito vira diferença sem dono no
 * fechamento, e a conversa acontece dias depois, sem ninguém lembrar.
 */
function MovimentosDoTurno({ caixa }: { readonly caixa: CaixaDto }) {
  return (
    <section className="w-full min-w-0 flex-1 overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <h2 className="font-display text-[14px] font-semibold text-neutral-900">
          Movimentos do turno
        </h2>
        <span className="text-[11.5px] text-neutral-400">
          append-only · correção é lançamento contrário
        </span>
      </div>

      <div
        className={juntar(GRADE_MOVIMENTO, 'border-b border-neutral-100 bg-neutral-25 px-4 py-2')}
      >
        <ColunaCaixa>Hora</ColunaCaixa>
        <ColunaCaixa>Tipo</ColunaCaixa>
        <ColunaCaixa>Motivo</ColunaCaixa>
        <ColunaCaixa direita>Valor</ColunaCaixa>
      </div>

      {caixa.movimentos.map((m) => {
        const sangria = m.tipo === 'SANGRIA';
        return (
          <div
            key={m.id}
            className={juntar(GRADE_MOVIMENTO, 'border-b border-neutral-50 px-4 py-2.5')}
          >
            <span className="font-mono text-[12.5px] text-neutral-500">
              {new Date(m.criadoEm).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span>
              <span
                className={juntar(
                  'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                  sangria
                    ? 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]'
                    : 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
                )}
              >
                {sangria ? 'Sangria' : 'Suprimento'}
              </span>
            </span>
            <span className="min-w-0 truncate text-[12.5px] text-neutral-700">{m.motivo}</span>
            <span
              className={juntar(
                'text-right font-mono text-[13.5px] font-medium tabular-nums',
                sangria ? 'text-[var(--color-perigo)]' : 'text-[var(--color-sucesso)]',
              )}
            >
              {sangria ? '-' : '+'} R$ {brl(m.valor)}
            </span>
          </div>
        );
      })}

      {/* A abertura fecha a lista por baixo: é o primeiro lançamento do turno,
          e sem ela o fundo de troco parece ter nascido do nada. */}
      <div className={juntar(GRADE_MOVIMENTO, 'px-4 py-2.5')}>
        <span className="font-mono text-[12.5px] text-neutral-500">
          {new Date(caixa.abertoEm).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span>
          <span className="inline-block rounded-full bg-neutral-50 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">
            Abertura
          </span>
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-neutral-700">
          {caixa.observacaoAbertura ?? 'Fundo de troco conferido na abertura'}
        </span>
        <span className="text-right font-mono text-[13.5px] font-medium tabular-nums text-neutral-900">
          + R$ {brl(caixa.valorAbertura)}
        </span>
      </div>
    </section>
  );
}

/** A mesma grade no cabeçalho e em cada linha. Uma declaração, não duas. */
const GRADE_MOVIMENTO = 'grid grid-cols-[52px_104px_minmax(0,1fr)_112px] items-center gap-3';

function ColunaCaixa({
  children,
  direita,
}: {
  readonly children: React.ReactNode;
  readonly direita?: boolean;
}) {
  return (
    <span
      className={juntar(
        'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
        direita && 'text-right',
      )}
    >
      {children}
    </span>
  );
}

function Parcela({
  rotulo,
  valor,
  sinal,
  tom,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly sinal: '+' | '-';
  readonly tom?: 'sucesso' | 'perigo';
}) {
  return (
    <div className="border-b border-r border-neutral-100 px-5 py-3 last:border-r-0">
      <p className="text-[11.5px] text-neutral-500">{rotulo}</p>
      <p
        className={juntar(
          'mt-0.5 font-mono text-[15px] font-medium tabular-nums',
          Number(valor) === 0
            ? 'text-neutral-400'
            : tom === 'sucesso'
              ? 'text-[var(--color-sucesso)]'
              : tom === 'perigo'
                ? 'text-[var(--color-perigo)]'
                : 'text-neutral-900',
        )}
      >
        {sinal === '-' ? '−' : '+'} R$ {brl(valor)}
      </p>
    </div>
  );
}

function LinhaHistorico({
  caixa,
  compacta,
  podeConferir,
  souEu,
  conferindo,
  aoConferir,
}: {
  readonly caixa: CaixaDto;
  readonly compacta: boolean;
  readonly podeConferir: boolean;
  readonly souEu: boolean;
  readonly conferindo: boolean;
  readonly aoConferir: () => void;
}) {
  const diferenca = caixa.diferenca === null ? null : Number(caixa.diferenca);

  /*
    Conferir é o segundo par de olhos: só cabe em caixa FECHADO e nunca por
    quem o fechou. O botão nasce desabilitado com o motivo POR ESCRITO em vez
    de sumir — some, e quem tem a permissão fica procurando onde clicar.
    docs/CASHBOX.md §6.
  */
  const cabeConferir = caixa.status === 'FECHADO' && podeConferir;

  return (
    <div className="flex flex-col gap-2 border-b border-neutral-50 px-4 py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] text-neutral-600">#{caixa.numero}</span>
        <Selo status={caixa.status} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-neutral-900">{caixa.operador}</p>
          <p className="truncate text-[11.5px] text-neutral-400">
            {caixa.loja} · {new Date(caixa.abertoEm).toLocaleDateString('pt-BR')}
          </p>
        </div>

        {/*
          Falta e sobra por EXTENSO, não em `title`: no celular não há hover, e
          é no celular que a conferência acontece no balcão.
        */}
        <span className="shrink-0 text-right">
          <span
            className={juntar(
              'block font-mono text-[13px] font-medium tabular-nums',
              diferenca === null
                ? 'text-neutral-400'
                : diferenca === 0
                  ? 'text-[var(--color-sucesso)]'
                  : 'text-[var(--color-perigo)]',
            )}
          >
            {diferenca === null
              ? '—'
              : diferenca === 0
                ? 'exato'
                : (diferenca > 0 ? '+ R$ ' : '− R$ ') + brl(Math.abs(diferenca))}
          </span>
          {diferenca !== null && diferenca !== 0 ? (
            <span className="block text-[11px] text-[var(--color-perigo)]">
              {diferenca < 0 ? 'falta' : 'sobra'}
            </span>
          ) : null}
        </span>

        {cabeConferir ? (
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <button
              type="button"
              disabled={souEu || conferindo}
              onClick={aoConferir}
              className={juntar(
                'h-7 rounded-md px-2.5 text-[12px] font-semibold',
                souEu
                  ? 'cursor-not-allowed border border-neutral-100 bg-neutral-50 text-neutral-300'
                  : 'bg-primary-600 text-white hover:bg-primary-700',
              )}
            >
              {conferindo ? 'Conferindo…' : 'Conferir'}
            </button>
            {/*
              O motivo cabe em duas palavras ao lado do botão. A frase inteira
              mora uma vez no rodapé da lista: repetida em cada caixa meu, ela
              virava parágrafo a cada duas linhas e ninguém lia nenhum.
            */}
            {souEu ? <span className="text-[10.5px] text-neutral-400">você fechou</span> : null}
          </span>
        ) : null}
      </div>

      {caixa.status === 'CONFERIDO' && caixa.conferidoPor && !compacta ? (
        <p className="text-[11px] text-neutral-400">
          conferido por {caixa.conferidoPor}
          {caixa.conferidoEm
            ? ' em ' + new Date(caixa.conferidoEm).toLocaleDateString('pt-BR')
            : ''}
        </p>
      ) : null}
    </div>
  );
}

function Selo({ status }: { readonly status: CaixaDto['status'] }) {
  const mapa = {
    ABERTO: { texto: 'Aberto', cor: 'text-[var(--color-sucesso)] bg-[var(--color-sucesso-fundo)]' },
    FECHADO: {
      texto: 'Fechado',
      cor: 'text-[var(--color-atencao)] bg-[var(--color-atencao-fundo)]',
    },
    CONFERIDO: { texto: 'Conferido', cor: 'text-neutral-600 bg-neutral-50' },
  } as const;

  const { texto, cor } = mapa[status];

  return (
    <span
      className={juntar(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
        cor,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {texto}
    </span>
  );
}
