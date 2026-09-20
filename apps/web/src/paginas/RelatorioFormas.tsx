import { type LojaPainel, type RelatorioFormas } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  brl,
  CabecalhoRelatorio,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

const FORMAS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  PRAZO: 'A prazo',
  CARTEIRA: 'Carteira do cliente',
};

/**
 * Uma só matiz, do escuro ao claro: a forma não é categoria disputando
 * atenção, é uma fatia de um mesmo total.
 */
const RAMPA = [
  'var(--color-primary-700)',
  'var(--color-primary-600)',
  'var(--color-primary-500)',
  'var(--color-primary-400)',
  'var(--color-primary-300)',
  'var(--color-primary-200)',
  'var(--color-primary-100)',
  'var(--color-neutral-200)',
];

/**
 * Formas de pagamento.
 *
 * O número que interessa não é "quanto entrou por cartão": é quanto do
 * faturamento ainda não está na conta. Crédito conta como futuro mesmo em uma
 * parcela — quem liquida é a adquirente, e o sistema não guarda a data dela.
 */
export function RelatorioFormasTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 30);
  const lojaId = parametrosUrl.get('lojaId') ?? '';

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const lojas = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
  });

  const consulta = useQuery({
    queryKey: ['relatorios', 'formas', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioFormas>(`/relatorios/formas-pagamento?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'formas-de-pagamento.csv',
      ['forma', 'total', 'participacao', 'pagamentos', 'valor_medio', 'parcelas_medias', 'quando'],
      dados.formas.map((f) => [
        FORMAS[f.forma] ?? f.forma,
        f.total,
        f.participacao,
        f.pagamentos,
        f.medio,
        f.parcelasMedias,
        f.futuro ? 'depois' : 'na hora',
      ]),
    );
  }

  const total = Number(dados?.total ?? 0);
  const futuro = Number(dados?.futuro ?? 0);
  const parteFutura = total > 0 ? (futuro / total) * 100 : 0;

  return (
    <>
      <CabecalhoRelatorio
        titulo="Formas de pagamento"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Formas de pagamento
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · só vendas concluídas
                </>
              ) : (
                'Carregando…'
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '30')}>
              {PERIODOS.map((d) => (
                <option key={d} value={d}>
                  {rotuloPeriodo(d)}
                </option>
              ))}
            </Selecao>

            <Selecao rotulo="Loja" valor={lojaId} aoMudar={(v) => trocar('lojaId', v, '')}>
              <option value="">Todas</option>
              {(lojas.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Somando os recebimentos…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível somar os recebimentos"
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
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-3">
              <Indicador
                rotulo="Recebido no período"
                valor={`R$ ${brl(dados.total)}`}
                nota={`${dados.formas.reduce((s, f) => s + f.pagamentos, 0)} pagamentos`}
              />
              <Indicador
                rotulo="Já está na conta"
                valor={`R$ ${brl(dados.imediato)}`}
                nota="dinheiro, PIX, débito e transferência"
                tom="sucesso"
              />
              <Indicador
                rotulo="Entra depois"
                valor={`R$ ${brl(dados.futuro)}`}
                nota={`${parteFutura.toFixed(0)}% do período · crédito, boleto, prazo e carteira`}
                tom={parteFutura > 50 ? 'atencao' : 'normal'}
              />
            </div>

            {/*
              O aviso é elemento visível, não `title`: quem confere o caixa no
              celular não tem hover, e crédito "à vista" no balde errado faria
              a loja contar com dinheiro que a adquirente ainda não mandou.
            */}
            <p className="shrink-0 rounded-lg border border-neutral-100 bg-neutral-25 px-3.5 py-2.5 text-[12.5px] leading-[18px] text-neutral-600">
              Crédito conta como <strong className="text-neutral-800">entra depois</strong> mesmo em
              uma parcela: quem liquida é a adquirente, e o sistema ainda não registra a data dela.
            </p>

            <div className="flex shrink-0 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[770px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1">
                    {dados.formas.length === 0 ? (
                      <EstadoVazio
                        titulo="Nenhum recebimento no período"
                        descricao="Aumente o período ou troque a loja."
                      />
                    ) : (
                      dados.formas.map((f, i) => (
                        <div
                          key={f.forma}
                          className={juntar(
                            'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 sm:grid',
                            GRADE,
                          )}
                        >
                          <span className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-900">
                            <span
                              className="size-2.5 shrink-0 rounded-[2px]"
                              style={{ background: RAMPA[i % RAMPA.length] }}
                            />
                            {FORMAS[f.forma] ?? f.forma}
                          </span>

                          <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
                            R$ {brl(f.total)}
                          </span>

                          <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
                            {f.participacao}%
                          </span>

                          <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
                            {f.pagamentos}
                          </span>

                          <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
                            R$ {brl(f.medio)}
                          </span>

                          <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
                            {f.forma === 'CREDITO' ? `${f.parcelasMedias}x` : '—'}
                          </span>

                          <span className="sm:text-right">
                            <span
                              className={juntar(
                                'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                f.futuro
                                  ? 'bg-[#fdf3e3] text-[var(--color-atencao)]'
                                  : 'bg-[#e8f3ec] text-[var(--color-sucesso)]',
                              )}
                            >
                              {f.futuro ? 'Depois' : 'Na hora'}
                            </span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Painel>

              <Parcelamento dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'sm:grid-cols-[minmax(160px,1fr)_120px_70px_80px_110px_74px_84px]';

function Cabecalho() {
  const colunas = ['Forma', 'Total', '%', 'Pagtos.', 'Médio', 'Parcelas', 'Quando'];

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

/** Em quantas vezes a loja vendeu. Só do crédito — é onde parcelar existe. */
function Parcelamento({ dados }: { readonly dados: RelatorioFormas }) {
  const maior = dados.parcelamento.reduce((m, p) => Math.max(m, Number(p.total)), 0);

  return (
    <section className="w-full shrink-0 rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[340px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">
        Parcelamento no crédito
      </h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Em quantas vezes o cliente dividiu — e quanto disso ainda não chegou.
      </p>

      {dados.parcelamento.length === 0 ? (
        <p className="mt-4 text-[13px] text-neutral-400">Nenhuma venda no crédito no período.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-2">
          {dados.parcelamento.map((p) => (
            <div key={p.parcelas} className="flex items-center gap-2.5">
              <span className="w-8 shrink-0 text-right font-mono text-[12.5px] font-medium text-neutral-700">
                {p.parcelas}x
              </span>

              <span className="h-[18px] min-w-0 flex-1 rounded-[3px] bg-neutral-50">
                <span
                  className="block h-full rounded-[3px] bg-[var(--color-primary-500)]"
                  style={{ width: `${maior > 0 ? (Number(p.total) / maior) * 100 : 0}%` }}
                />
              </span>

              <span className="w-[86px] shrink-0 text-right font-mono text-[12.5px] text-neutral-900">
                R$ {brl(p.total)}
              </span>

              <span className="w-[42px] shrink-0 text-right font-mono text-[12px] text-neutral-500">
                {p.participacao}%
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
