import { type LinhaFornecedor, type RelatorioComprasFornecedor } from '@estoque/contracts';
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
 * De quem se compra, quanto e em quanto tempo chega.
 *
 * O prazo médio é a coluna que muda decisão: um fornecedor 8% mais barato que
 * demora três semanas a mais custa ruptura, e ruptura não aparece no preço da
 * nota.
 */
export function RelatorioFornecedoresTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const dias = Number(parametrosUrl.get('dias') ?? 90);

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'fornecedores', dias],
    queryFn: () =>
      pedir<RelatorioComprasFornecedor>(
        `/relatorios/compras/fornecedores?dias=${String(dias)}&limite=100`,
      ),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const maior = dados?.itens[0];

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'compras-por-fornecedor.csv',
      ['fornecedor', 'notas', 'itens', 'unidades', 'valor', 'participacao', 'prazo_medio_dias'],
      dados.itens.map((i) => [
        i.fornecedor,
        i.notas,
        i.itens,
        i.unidades,
        i.valor,
        i.participacao,
        i.prazoMedio ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Compras por fornecedor"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Compras por fornecedor
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              Só notas <strong className="font-semibold text-neutral-900">recebidas</strong> — o que
              foi lançado e não entrou está em “notas a receber”
            </p>
          </div>

          <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '90')}>
            {PERIODOS.map((d) => (
              <option key={d} value={d}>
                {rotuloPeriodo(d)}
              </option>
            ))}
          </Selecao>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Somando por fornecedor…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível montar o relatório"
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
                rotulo="Comprado no período"
                valor={`R$ ${brl(dados.total)}`}
                nota={`${String(dados.totalNotas)} ${dados.totalNotas === 1 ? 'nota' : 'notas'} recebidas`}
              />
              <Indicador
                rotulo="Fornecedores"
                valor={String(dados.fornecedores)}
                nota="com pelo menos uma nota recebida"
              />
              {/*
                Concentração é risco, e só aparece quando alguém diz em voz
                alta: um fornecedor com 80% do volume é um fornecedor que pode
                parar a loja sozinho.
              */}
              <Indicador
                rotulo="Maior fornecedor"
                valor={maior ? `${brl(maior.participacao)}%` : '—'}
                nota={maior ? maior.fornecedor : 'nenhuma compra no período'}
                tom={maior && Number(maior.participacao) > 60 ? 'atencao' : 'normal'}
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[920px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma compra recebida no período"
                      descricao="Aumente o período, ou receba uma nota em Compras."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.fornecedorId} item={i} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 lg:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    {dados.fornecedores} {dados.fornecedores === 1 ? 'fornecedor' : 'fornecedores'}{' '}
                    · {rotuloPeriodo(dias)}
                  </span>
                  <span className="flex-1" />
                  <span className="font-mono text-[14px] font-semibold tabular-nums text-neutral-900">
                    R$ {brl(dados.total)}
                  </span>
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'lg:grid-cols-[minmax(200px,1fr)_72px_72px_96px_140px_120px_110px]';

function Cabecalho() {
  const colunas = ['Fornecedor', 'Notas', 'Itens', 'Unidades', 'Valor', 'Participação', 'Prazo'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i >= 1 && i <= 4 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaFornecedor }) {
  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 lg:grid',
        GRADE,
      )}
    >
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        <span className="block truncate text-[13px] text-neutral-900">{item.fornecedor}</span>
        <span className="block text-[11.5px] text-neutral-500">
          {item.ultimaCompra
            ? `última em ${new Date(item.ultimaCompra).toLocaleDateString('pt-BR')}`
            : 'sem recebimento datado'}
        </span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 lg:text-right">{item.notas}</span>
      <span className="font-mono text-[12.5px] text-neutral-600 lg:text-right">{item.itens}</span>
      <span className="font-mono text-[12.5px] text-neutral-600 lg:text-right">
        {Number(item.unidades).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
      </span>

      <span className="font-mono text-[13px] font-medium tabular-nums text-neutral-900 lg:text-right">
        R$ {brl(item.valor)}
      </span>

      <span className="flex items-center gap-2">
        <span className="hidden h-1.5 w-full max-w-[56px] overflow-hidden rounded-full bg-neutral-100 lg:block">
          <span
            className="block h-full rounded-full bg-primary-500"
            style={{ width: `${item.participacao}%` }}
          />
        </span>
        <span className="font-mono text-[12px] tabular-nums text-neutral-600">
          {brl(item.participacao)}%
        </span>
      </span>

      {/*
        Sem data de emissão não há prazo. Zero diria "chegou no mesmo dia", que
        é uma afirmação — e falsa.
      */}
      <span
        className={juntar(
          'font-mono text-[12.5px] tabular-nums',
          item.prazoMedio === null ? 'text-neutral-400' : 'text-neutral-700',
        )}
      >
        {item.prazoMedio === null
          ? 'sem emissão'
          : `${item.prazoMedio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`}
      </span>
    </div>
  );
}
