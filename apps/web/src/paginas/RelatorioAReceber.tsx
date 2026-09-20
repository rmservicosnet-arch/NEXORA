import { type LinhaAReceber, type RelatorioAReceber } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import { baixarCsv, brl, CabecalhoRelatorio, Indicador, Painel } from './relatorio-pecas';

/**
 * Nota lançada e mercadoria que não entrou.
 *
 * É a fila de trabalho do depósito. O "parada há" é o que torna a tela útil:
 * uma nota de três semanas em rascunho é mercadoria perdida ou digitação
 * esquecida, e nos dois casos alguém precisa olhar.
 */
export function RelatorioAReceberTela() {
  const consulta = useQuery({
    queryKey: ['relatorios', 'a-receber'],
    queryFn: () => pedir<RelatorioAReceber>('/relatorios/compras/a-receber?limite=100'),
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'notas-a-receber.csv',
      ['nota', 'fornecedor', 'destino', 'loja', 'emissao', 'dias_parada', 'itens', 'valor'],
      dados.itens.map((i) => [
        i.numeroNota ?? '',
        i.fornecedor,
        i.local,
        i.loja,
        i.emitidaEm ? new Date(i.emitidaEm).toLocaleDateString('pt-BR') : '',
        i.diasParada ?? '',
        i.itens,
        i.valor,
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Notas a receber"
        comCusto
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="shrink-0">
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Notas a receber
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            Lançadas e ainda{' '}
            <strong className="font-semibold text-neutral-900">fora do estoque</strong> — nenhuma
            delas mexeu no custo médio
          </p>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Procurando o que não chegou…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar as notas"
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
                rotulo="Notas a receber"
                valor={String(dados.notas)}
                nota="mercadoria ainda fora do estoque"
                tom={dados.notas > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="Valor parado"
                valor={`R$ ${brl(dados.total)}`}
                nota="soma das notas em rascunho"
              />
              <Indicador
                rotulo="Paradas há mais de 15 dias"
                valor={String(dados.paradasHaMais15)}
                nota="ou a mercadoria sumiu, ou a digitação foi esquecida"
                tom={dados.paradasHaMais15 > 0 ? 'perigo' : 'normal'}
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[900px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nada parado"
                      descricao="Toda nota lançada já entrou no estoque."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.compraId} item={i} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 lg:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length} de {dados.notas} · da mais antiga
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

const GRADE = 'lg:grid-cols-[110px_minmax(180px,1fr)_180px_110px_64px_130px]';

function Cabecalho() {
  const colunas = ['Nota', 'Fornecedor', 'Destino', 'Parada há', 'Itens', 'Valor'];

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
            i >= 4 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAReceber }) {
  const velha = item.diasParada !== null && item.diasParada > 15;

  return (
    <Link
      to="/compras"
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 no-underline hover:bg-neutral-25 lg:grid',
        GRADE,
        velha && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[12.5px] font-medium text-neutral-900">
        {item.numeroNota ? `NF ${item.numeroNota}` : 'sem nota'}
      </span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 lg:flex-none">
        {item.fornecedor}
      </span>

      <span className="truncate text-[12.5px] text-neutral-600">
        {item.local} <span className="text-neutral-400">· {item.loja}</span>
      </span>

      {/*
        Sem emissão não há "parada há": a nota pode ter sido lançada hoje com
        a mercadoria de um mês atrás. Inventar o número seria pior do que
        dizer que ele não existe.
      */}
      <span
        className={juntar(
          'text-[12.5px] font-medium',
          item.diasParada === null
            ? 'text-neutral-400'
            : velha
              ? 'text-[var(--color-perigo)]'
              : 'text-neutral-600',
        )}
      >
        {item.diasParada === null ? 'sem emissão' : `${String(item.diasParada)} dias`}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 lg:text-right">{item.itens}</span>

      <span className="ml-auto font-mono text-[13px] font-medium tabular-nums text-neutral-900 lg:ml-0 lg:text-right">
        R$ {brl(item.valor)}
      </span>
    </Link>
  );
}
