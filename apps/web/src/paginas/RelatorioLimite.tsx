import { type LinhaLimite, type RelatorioLimite } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

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

const TIPOS: Record<string, string> = {
  PAGAMENTO_VENDA: 'Venda no balcão',
  VENDA_A_PRAZO: 'Venda a prazo',
  TAXA: 'Taxa',
  AJUSTE_DEBITO: 'Ajuste de débito',
  ESTORNO_CREDITO: 'Estorno de crédito',
};

/**
 * Acima do limite.
 *
 * `excedeu_limite` é gravado no movimento porque passar do limite é permitido
 * quando autorizado, nunca silencioso. Esta tela é a contrapartida disso: a
 * autorização existe para ser revista depois, por alguém que não estava lá.
 */
export function RelatorioLimiteTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const dias = Number(parametrosUrl.get('dias') ?? 90);

  function trocar(valor: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === '90') limpos.delete('dias');
    else limpos.set('dias', valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'carteira', 'limite', dias],
    queryFn: () =>
      pedir<RelatorioLimite>(`/relatorios/carteira/limite?dias=${String(dias)}&limite=200`),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'acima-do-limite.csv',
      [
        'quando',
        'cliente',
        'tipo',
        'valor',
        'saldo_depois',
        'limite',
        'excedeu_em',
        'autorizado_por',
        'justificativa',
      ],
      dados.itens.map((i) => [
        dataHora(i.em),
        i.cliente,
        TIPOS[i.tipo] ?? i.tipo,
        i.valor,
        i.saldoPosterior,
        i.limiteCredito,
        i.excedeuEm,
        i.autorizadoPor ?? '',
        i.justificativa ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Acima do limite"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Acima do limite
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · quem passou do crédito concedido, e com que autorização
                </>
              ) : (
                'Carregando…'
              )}
            </p>
          </div>

          <Selecao rotulo="Período" valor={String(dias)} aoMudar={trocar}>
            {PERIODOS.map((d) => (
              <option key={d} value={d}>
                {rotuloPeriodo(d)}
              </option>
            ))}
          </Selecao>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Procurando as autorizações…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar as autorizações"
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
                rotulo="Autorizações no período"
                valor={String(dados.autorizacoes)}
                nota={`R$ ${brl(dados.valorAutorizado)} liberados acima do limite`}
                tom={dados.autorizacoes > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="Clientes envolvidos"
                valor={String(dados.clientesAfetados)}
                nota="tiveram ao menos uma liberação"
              />
              {/*
                Histórico e dívida viva são coisas diferentes: alguém pode ter
                passado do limite em março e já ter quitado.
              */}
              <Indicador
                rotulo="Acima do limite hoje"
                valor={String(dados.acimaAgora)}
                nota="dívida viva, não histórico"
                tom={dados.acimaAgora > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Sem justificativa escrita"
                valor={String(dados.semJustificativa)}
                nota="a liberação existe e ninguém sabe por quê"
                tom={dados.semJustificativa > 0 ? 'perigo' : 'normal'}
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1080px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Ninguém passou do limite"
                      descricao="Nenhum débito acima do crédito concedido no período."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.id} item={i} />)
                  )}
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'sm:grid-cols-[116px_minmax(150px,1fr)_120px_110px_110px_100px_130px_150px]';

function Cabecalho() {
  const colunas = [
    'Quando',
    'Cliente',
    'Tipo',
    'Valor',
    'Saldo depois',
    'Passou em',
    'Autorizado por',
    'Justificativa',
  ];

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
            ['Valor', 'Saldo depois', 'Passou em'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaLimite }) {
  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
        item.justificativa === null && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.cliente}
      </span>

      <span className="truncate text-[12.5px] text-neutral-600">
        {TIPOS[item.tipo] ?? item.tipo}
      </span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        R$ {brl(item.valor)}
      </span>

      <span className="font-mono text-[12.5px] text-[var(--color-perigo)] sm:text-right">
        R$ {brl(item.saldoPosterior)}
      </span>

      <span className="font-mono text-[12.5px] font-medium text-[var(--color-atencao)] sm:text-right">
        R$ {brl(item.excedeuEm)}
      </span>

      <span className="truncate text-[12.5px] text-neutral-600">{item.autorizadoPor ?? '—'}</span>

      {/* Sem justificativa é aviso visível: é o silêncio que o desenho proíbe. */}
      <span className="min-w-0 truncate text-[12.5px]" title={item.justificativa ?? ''}>
        {item.justificativa ?? (
          <span className="font-medium text-[var(--color-perigo)]">não registrada</span>
        )}
      </span>
    </div>
  );
}
