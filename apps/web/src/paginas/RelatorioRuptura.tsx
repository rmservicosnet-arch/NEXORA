import { type LinhaRuptura, type LojaPainel, type RelatorioRuptura } from '@estoque/contracts';
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

/**
 * Ruptura: venda perdida por falta de estoque.
 *
 * É o único lugar do sistema onde a demanda aparece SEM a venda — o cliente
 * pediu e a loja não tinha. Um relatório de vendas nunca mostraria isso: ele
 * só conhece o que saiu.
 */
export function RelatorioRupturaTela() {
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
    queryKey: ['relatorios', 'ruptura', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioRuptura>(`/relatorios/pedidos/ruptura?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'ruptura.csv',
      [
        'sku',
        'produto',
        'variacao',
        'pedidos',
        'solicitada',
        'atendida',
        'nao_atendida',
        'valor_perdido',
        'saldo_atual',
      ],
      dados.itens.map((i) => [
        i.sku,
        i.produto,
        i.descricaoVariacao,
        i.pedidos,
        i.solicitada,
        i.atendida,
        i.naoAtendida,
        i.valorPerdido,
        i.saldoAtual,
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Ruptura"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Ruptura
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · o que o cliente pediu e a loja não tinha
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

        {consulta.isPending ? <EstadoCarregando titulo="Procurando o que faltou…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível apurar a ruptura"
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
                rotulo="Venda perdida"
                valor={`R$ ${brl(dados.valorPerdido)}`}
                nota="pelo preço congelado do pedido"
                tom={Number(dados.valorPerdido) > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Itens em falta"
                valor={String(dados.itensEmFalta)}
                nota="linhas de pedido não atendidas"
              />
              <Indicador
                rotulo="Pedidos afetados"
                valor={String(dados.pedidosAfetados)}
                nota="clientes que ficaram sem"
                tom={dados.pedidosAfetados > 0 ? 'atencao' : 'normal'}
              />
              {/*
                Confirmar acima do disponível não é ruptura: é a loja
                assumindo a falta, com autorização. Fica à parte porque vira
                saldo negativo — e o de estoque é outro relatório.
              */}
              <Indicador
                rotulo="Confirmados sem saldo"
                valor={String(dados.confirmadosSemSaldo)}
                nota="atendidos mesmo sem ter: viram saldo negativo"
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1000px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nada faltou no período"
                      descricao="Todo item pedido foi atendido pela quantidade solicitada."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.variacaoId} item={i} />)
                  )}
                </div>

                <div
                  className={juntar(
                    'hidden shrink-0 items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:grid',
                    GRADE,
                  )}
                >
                  <span className="col-span-2 text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length} de {dados.itensEmFalta} · do maior prejuízo
                  </span>
                  <span />
                  <span />
                  <span />
                  <span className="text-right font-mono text-[14px] font-semibold text-[var(--color-perigo)]">
                    R$ {brl(dados.itens.reduce((s, i) => s + Number(i.valorPerdido), 0))}
                  </span>
                  <span />
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'sm:grid-cols-[128px_minmax(200px,1fr)_74px_92px_92px_120px_110px]';

function Cabecalho() {
  const colunas = ['SKU', 'Variação', 'Pedidos', 'Pedido', 'Atendido', 'Perdido', 'Saldo hoje'];

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
            i > 1 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaRuptura }) {
  const saldo = Number(item.saldoAtual);
  const falta = Number(item.naoAtendida);

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-600">{item.sku}</span>

      <span className="min-w-0 truncate text-[13px] text-neutral-900">
        {item.produto}
        <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">{item.pedidos}</span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        {item.solicitada}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        {item.atendida}
      </span>

      <span className="font-mono text-[13px] font-semibold text-[var(--color-perigo)] sm:text-right">
        R$ {brl(item.valorPerdido)}
        <span className="ml-1 font-normal text-neutral-400">({falta})</span>
      </span>

      {/*
        O saldo de hoje ao lado do que faltou: repor ou não é decisão com os
        dois números. Saldo zero agora significa que a falta continua.
      */}
      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          saldo <= 0 ? 'font-medium text-[var(--color-perigo)]' : 'text-neutral-700',
        )}
        title={saldo <= 0 ? 'Continua sem saldo' : 'Já foi reposto'}
      >
        {item.saldoAtual}
      </span>
    </div>
  );
}
