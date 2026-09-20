import { type LinhaFila, type LojaPainel, type RelatorioFila } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  brl,
  CabecalhoRelatorio,
  dataHora,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

/** Acima disso o pedido deixou de esperar e passou a ser esquecido. */
const ESQUECIDO = 24;

function espera(horas: number): string {
  if (horas < 1) return 'menos de 1 h';
  if (horas < 24) return `${horas} h`;
  return `${Math.floor(horas / 24)} d ${horas % 24} h`;
}

/**
 * Fila e tempo de confirmação.
 *
 * A fila é agora — não tem período. O período vale para o tempo já medido:
 * quanto demorou para confirmar o que foi confirmado.
 *
 * Esperar a equipe e esperar o cliente são filas diferentes. Somadas, a
 * equipe leva a culpa por um aumento que o cliente ainda não aceitou.
 */
export function RelatorioFilaTela() {
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
    queryKey: ['relatorios', 'fila', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioFila>(`/relatorios/pedidos/fila?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
    // A fila muda sozinha enquanto a tela está aberta.
    refetchInterval: 60_000,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'fila-de-pedidos.csv',
      ['numero', 'cliente', 'loja', 'enviado_em', 'horas_na_fila', 'itens', 'valor', 'espera'],
      dados.itens.map((i) => [
        i.numero,
        i.cliente,
        i.loja,
        dataHora(i.enviadoEm),
        i.horasNaFila,
        i.itens,
        i.valorSolicitado,
        i.esperaCliente ? 'cliente' : 'equipe',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Fila e tempo de confirmação"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Fila e tempo de confirmação
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              A fila é <strong className="font-semibold text-neutral-900">agora</strong>; o tempo
              medido é dos últimos {dados ? rotuloPeriodo(dados.dias) : '…'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao
              rotulo="Tempo medido"
              valor={String(dias)}
              aoMudar={(v) => trocar('dias', v, '30')}
            >
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

        {consulta.isPending ? <EstadoCarregando titulo="Olhando a fila…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível ler a fila"
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
                rotulo="Aguardando a equipe"
                valor={String(dados.naFila)}
                nota={`R$ ${brl(dados.valorNaFila)} parados`}
                tom={dados.naFila > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="O mais antigo"
                valor={dados.maisAntigoHoras === null ? '—' : espera(dados.maisAntigoHoras)}
                nota="sem resposta desde que chegou"
                tom={
                  dados.maisAntigoHoras !== null && dados.maisAntigoHoras >= ESQUECIDO
                    ? 'perigo'
                    : 'normal'
                }
              />
              {/*
                Esperar o cliente é fila DELE. No mesmo número, a equipe
                levaria a culpa por um aumento que o cliente não aceitou.
              */}
              <Indicador
                rotulo="Esperando o cliente"
                valor={String(dados.esperandoCliente)}
                nota="aceite de aumento pendente"
              />
              <Indicador
                rotulo="Com preço vencido"
                valor={String(dados.precoVencido)}
                nota="o congelamento do envio expirou"
                tom={dados.precoVencido > 0 ? 'perigo' : 'normal'}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[800px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Nada na fila"
                        descricao="Nenhum pedido aguardando resposta."
                      />
                    ) : (
                      dados.itens.map((i) => <Linha key={i.id} item={i} />)
                    )}
                  </div>

                  <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:flex">
                    <span className="text-[12.5px] font-semibold text-neutral-700">
                      Exibindo {dados.itens.length} · do que espera há mais tempo
                    </span>
                  </div>
                </div>
              </Painel>

              <Lado dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function Lado({ dados }: { readonly dados: RelatorioFila }) {
  const maior = dados.faixas.reduce((m, f) => Math.max(m, f.pedidos), 0);

  return (
    <div className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[300px]">
      <section className="rounded-lg border border-neutral-100 bg-white p-4 shadow-sm">
        <h2 className="font-display text-[14px] font-semibold text-neutral-900">Há quanto tempo</h2>
        <p className="mt-0.5 text-[12px] text-neutral-500">
          A média esconde o pedido esquecido. A cauda é o que irrita o cliente.
        </p>

        <div className="mt-3.5 flex flex-col gap-2.5">
          {dados.faixas.map((f) => (
            <div key={f.faixa}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] text-neutral-700">{f.faixa}</span>
                <span className="font-mono text-[12.5px] font-medium text-neutral-900">
                  {f.pedidos}
                </span>
              </div>

              <div className="mt-1 h-[6px] rounded-full bg-neutral-50">
                <div
                  className="h-full rounded-full bg-[var(--color-primary-500)]"
                  style={{ width: `${maior > 0 ? (f.pedidos / maior) * 100 : 0}%` }}
                />
              </div>

              <p className="mt-0.5 font-mono text-[11.5px] text-neutral-500">R$ {brl(f.valor)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-100 bg-white p-4 shadow-sm">
        <h2 className="font-display text-[14px] font-semibold text-neutral-900">
          Tempo até confirmar
        </h2>
        <p className="mt-0.5 text-[12px] text-neutral-500">
          {dados.confirmados}{' '}
          {dados.confirmados === 1 ? 'pedido confirmado' : 'pedidos confirmados'} nos últimos{' '}
          {rotuloPeriodo(dados.dias)}.
        </p>

        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-neutral-50 pt-3">
          <span className="text-[13px] text-neutral-700">Mediana</span>
          <span className="font-display text-[24px] font-bold leading-7 text-neutral-900">
            {dados.horasMediana === null ? '—' : `${dados.horasMediana} h`}
          </span>
        </div>

        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-neutral-500">Média</span>
          <span className="font-mono text-[15px] text-neutral-600">
            {dados.horasMedias === null ? '—' : `${dados.horasMedias} h`}
          </span>
        </div>

        {/* Média muito acima da mediana é a cauda falando: alguns pedidos
            ficaram esquecidos, e é neles que está o problema. */}
        {dados.horasMediana !== null &&
        dados.horasMedias !== null &&
        Number(dados.horasMedias) > Number(dados.horasMediana) * 2 ? (
          <p className="mt-2.5 text-[12px] leading-[17px] text-neutral-500">
            A média é o dobro da mediana: a maioria é atendida rápido e{' '}
            <strong className="text-neutral-700">alguns poucos ficam esquecidos</strong>.
          </p>
        ) : null}
      </section>
    </div>
  );
}

const GRADE = 'sm:grid-cols-[70px_minmax(160px,1fr)_130px_124px_56px_110px_92px]';

function Cabecalho() {
  const colunas = ['Pedido', 'Cliente', 'Loja', 'Enviado em', 'Itens', 'Valor', 'Esperando'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        GRADE,
      )}
    >
      {colunas.map((c) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            ['Itens', 'Valor', 'Esperando'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaFila }) {
  const esquecido = !item.esperaCliente && item.horasNaFila >= ESQUECIDO;

  return (
    <Link
      to={`/pedidos/${item.id}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 no-underline hover:bg-neutral-25 sm:grid',
        GRADE,
        esquecido && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[12px] text-neutral-600">#{item.numero}</span>

      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.cliente}
        {item.precoVencido ? (
          <span className="ml-1.5 inline-flex rounded-full bg-[#fdecec] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-perigo)]">
            preço vencido
          </span>
        ) : null}
      </span>

      <span className="truncate text-[12.5px] text-neutral-500">{item.loja}</span>

      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.enviadoEm)}</span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">{item.itens}</span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        R$ {brl(item.valorSolicitado)}
      </span>

      <span className="sm:text-right">
        <span
          className={juntar(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
            item.esperaCliente
              ? 'bg-neutral-100 text-neutral-600'
              : esquecido
                ? 'bg-[#fdecec] text-[var(--color-perigo)]'
                : 'bg-[#fdf3e3] text-[var(--color-atencao)]',
          )}
          title={item.esperaCliente ? 'Aguardando o cliente aceitar o aumento' : undefined}
        >
          {item.esperaCliente ? 'Cliente' : espera(item.horasNaFila)}
        </span>
      </span>
    </Link>
  );
}
