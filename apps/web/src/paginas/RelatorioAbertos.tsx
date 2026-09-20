import { type LinhaAberto, type RelatorioAbertos } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import { baixarCsv, brl, CabecalhoRelatorio, Indicador, Painel } from './relatorio-pecas';

/** Acima disso a dívida deixou de ser prazo e virou cobrança. */
const ATRASO_LONGO = 60;

/**
 * Saldos em aberto.
 *
 * Dívida é saldo NEGATIVO — o sinal vem do razão e a tela não inverte nada:
 * inverter é esconder de quem lê. O "há quanto tempo" é medido desde o último
 * movimento que deixou o saldo em zero ou acima; a data do primeiro débito
 * diria "devendo há dois anos" para quem quitou dez vezes no meio.
 */
export function RelatorioAbertosTela() {
  const consulta = useQuery({
    queryKey: ['relatorios', 'carteira', 'abertos'],
    queryFn: () => pedir<RelatorioAbertos>('/relatorios/carteira/abertos?limite=200'),
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'saldos-em-aberto.csv',
      ['cliente', 'saldo', 'limite', 'disponivel', 'dias_negativo', 'bloqueada'],
      dados.itens.map((i) => [
        i.cliente,
        i.saldo,
        i.limiteCredito,
        i.disponivel,
        i.diasNegativo ?? '',
        i.bloqueada ? 'sim' : 'não',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Saldos em aberto"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="shrink-0">
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Saldos em aberto
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            Quem deve <strong className="font-semibold text-neutral-900">agora</strong> · o tempo é
            desde que o saldo ficou negativo e não voltou a zero
          </p>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Somando o que está em aberto…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível ler as carteiras"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {dados ? (
          <>
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo="Total em aberto"
                valor={`R$ ${brl(dados.totalDevido)}`}
                nota="soma das carteiras negativas"
                tom={Number(dados.totalDevido) < 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Clientes devendo"
                valor={String(dados.devedores)}
                nota="com saldo abaixo de zero"
              />
              <Indicador
                rotulo="Acima do limite"
                valor={String(dados.acimaDoLimite)}
                nota="a dívida passou do crédito concedido"
                tom={dados.acimaDoLimite > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Bloqueadas para compra"
                valor={String(dados.bloqueadas)}
                nota="não compram; quitação continua aberta"
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[760px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Ninguém devendo"
                        descricao="Nenhuma carteira com saldo abaixo de zero."
                      />
                    ) : (
                      dados.itens.map((i) => <Linha key={i.clienteId} item={i} />)
                    )}
                  </div>
                </div>
              </Painel>

              <Faixas dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

/**
 * Há quanto tempo a dívida está de pé.
 *
 * A carteira não tem vencimento por lançamento, então chamar isto de
 * "vencido há 60 dias" seria inventar uma data que não existe.
 */
function Faixas({ dados }: { readonly dados: RelatorioAbertos }) {
  const maior = dados.faixas.reduce((m, f) => Math.max(m, Math.abs(Number(f.valor))), 0);

  return (
    <section className="w-full shrink-0 self-start rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[320px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">Há quanto tempo</h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Tempo desde que o saldo ficou negativo — não é vencimento, que a carteira não tem.
      </p>

      <div className="mt-3.5 flex flex-col gap-2.5">
        {dados.faixas.map((f) => (
          <div key={f.faixa}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] text-neutral-700">{f.faixa}</span>
              <span className="font-mono text-[12.5px] font-medium text-neutral-900">
                {f.clientes}
              </span>
            </div>

            <div className="mt-1 h-[6px] rounded-full bg-neutral-50">
              <div
                className="h-full rounded-full bg-[var(--color-perigo)]"
                style={{ width: `${maior > 0 ? (Math.abs(Number(f.valor)) / maior) * 100 : 0}%` }}
              />
            </div>

            <p className="mt-0.5 font-mono text-[11.5px] text-neutral-500">R$ {brl(f.valor)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const GRADE = 'sm:grid-cols-[minmax(180px,1fr)_130px_120px_130px_96px]';

function Cabecalho() {
  const colunas = ['Cliente', 'Deve', 'Limite', 'Disponível', 'Há'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        GRADE,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i > 0 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAberto }) {
  const estourou = Number(item.disponivel) < 0;
  const antiga = (item.diasNegativo ?? 0) >= ATRASO_LONGO;

  return (
    <Link
      to={`/carteiras/${item.clienteId}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 no-underline hover:bg-neutral-25 sm:grid',
        GRADE,
        estourou && 'bg-[#fdf5f5]',
      )}
    >
      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.cliente}
        {item.bloqueada ? (
          <span className="ml-1.5 inline-flex rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-600">
            bloqueada
          </span>
        ) : null}
      </span>

      {/* O sinal fica: dívida é número negativo, e a tela não maquia. */}
      <span className="font-mono text-[13px] font-semibold text-[var(--color-perigo)] sm:text-right">
        R$ {brl(item.saldo)}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        R$ {brl(item.limiteCredito)}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          estourou ? 'font-medium text-[var(--color-perigo)]' : 'text-neutral-700',
        )}
        title={estourou ? 'A dívida passou do crédito concedido' : undefined}
      >
        {estourou ? '− ' : ''}R$ {brl(item.disponivel)}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          item.diasNegativo === null
            ? 'text-neutral-400'
            : antiga
              ? 'font-medium text-[var(--color-perigo)]'
              : 'text-neutral-600',
        )}
      >
        {item.diasNegativo === null ? 'sempre' : `${item.diasNegativo} d`}
      </span>
    </Link>
  );
}
