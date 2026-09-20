import {
  type LinhaFechamento,
  type LojaPainel,
  type RelatorioFechamentos,
} from '@estoque/contracts';
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

const STATUS: Record<string, { nome: string; classe: string }> = {
  ABERTO: { nome: 'Aberto', classe: 'bg-[#fdf3e3] text-[var(--color-atencao)]' },
  FECHADO: { nome: 'Fechado', classe: 'bg-neutral-100 text-neutral-600' },
  CONFERIDO: { nome: 'Conferido', classe: 'bg-[#e8f3ec] text-[var(--color-sucesso)]' },
};

/**
 * Fechamento de caixa.
 *
 * A diferença é `contado − esperado` e nunca é ajustada em silêncio: fica
 * registrada como é. Esta tela é o lugar onde alguém olha para ela — e por
 * isso falta e sobra são contadas separadamente. Somadas, duzentos reais de
 * falta e duzentos de sobra dariam zero numa loja onde dois operadores erram
 * todo dia em direções opostas.
 */
export function RelatorioFechamentosTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 30);
  const lojaId = parametrosUrl.get('lojaId') ?? '';
  const apenasComDiferenca = parametrosUrl.get('recorte') === 'diferenca';

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
    queryKey: ['relatorios', 'fechamentos', dias, lojaId, apenasComDiferenca],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      if (apenasComDiferenca) p.set('apenasComDiferenca', 'true');
      return pedir<RelatorioFechamentos>(`/relatorios/fechamento-caixa?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'fechamento-de-caixa.csv',
      [
        'caixa',
        'loja',
        'operador',
        'aberto_em',
        'fechado_em',
        'status',
        'abertura',
        'esperado',
        'contado',
        'diferenca',
        'conferido_por',
      ],
      dados.itens.map((i) => [
        i.numero,
        i.loja,
        i.operador,
        dataHora(i.abertoEm),
        i.fechadoEm ? dataHora(i.fechadoEm) : '',
        STATUS[i.status]?.nome ?? i.status,
        i.valorAbertura,
        i.valorEsperado ?? '',
        i.valorContado ?? '',
        i.diferenca ?? '',
        i.conferidoPor ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Fechamento de caixa"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Fechamento de caixa
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · a diferença fica registrada como é, nunca ajustada
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

            <Selecao
              rotulo="Recorte"
              valor={apenasComDiferenca ? 'diferenca' : ''}
              aoMudar={(v) => trocar('recorte', v, '')}
            >
              <option value="">Todos os caixas</option>
              <option value="diferenca">Só os que não bateram</option>
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Conferindo a gaveta…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível ler os fechamentos"
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
              {/*
                Falta e sobra separadas: somadas, R$ 200 de cada dariam zero
                numa loja onde dois operadores erram em direções opostas.
              */}
              <Indicador
                rotulo="Faltou na gaveta"
                valor={`R$ ${brl(dados.faltas)}`}
                nota="contado a menos que o esperado"
                tom={Number(dados.faltas) < 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Sobrou na gaveta"
                valor={`R$ ${brl(dados.sobras)}`}
                nota="contado a mais que o esperado"
                tom={Number(dados.sobras) > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="Caixas que não bateram"
                valor={String(dados.comDiferenca)}
                nota={`de ${dados.fechados} fechados`}
                tom={dados.comDiferenca > 0 ? 'atencao' : 'normal'}
                aoClicar={() => trocar('recorte', apenasComDiferenca ? '' : 'diferenca', '')}
              />
              {/*
                Fechado sem conferência é fechamento com uma assinatura só.
              */}
              <Indicador
                rotulo="Sem conferência"
                valor={String(dados.semConferencia)}
                nota="fechados e nunca conferidos por outra pessoa"
                tom={dados.semConferencia > 0 ? 'atencao' : 'normal'}
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1080px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo={apenasComDiferenca ? 'Todos bateram' : 'Nenhum caixa no período'}
                      descricao={
                        apenasComDiferenca
                          ? 'Nenhum caixa fechou com diferença.'
                          : 'Aumente o período ou troque a loja.'
                      }
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

const GRADE = 'sm:grid-cols-[64px_minmax(140px,1fr)_130px_124px_110px_110px_110px_96px]';

function Cabecalho() {
  const colunas = [
    'Caixa',
    'Operador',
    'Loja',
    'Fechado em',
    'Esperado',
    'Contado',
    'Diferença',
    'Situação',
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
            ['Esperado', 'Contado', 'Diferença', 'Situação'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaFechamento }) {
  const diferenca = item.diferenca === null ? null : Number(item.diferenca);
  const falta = diferenca !== null && diferenca < 0;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
        falta && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[12px] text-neutral-600">#{item.numero}</span>

      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.operador}
        {item.conferidoPor ? (
          <span className="block truncate text-[11.5px] font-normal text-neutral-400">
            conferido por {item.conferidoPor}
          </span>
        ) : null}
      </span>

      <span className="truncate text-[12.5px] text-neutral-500">{item.loja}</span>

      <span className="font-mono text-[11.5px] text-neutral-500">
        {item.fechadoEm ? dataHora(item.fechadoEm) : '—'}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        {item.valorEsperado === null ? '—' : `R$ ${brl(item.valorEsperado)}`}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-700 sm:text-right">
        {item.valorContado === null ? '—' : `R$ ${brl(item.valorContado)}`}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-semibold sm:text-right',
          diferenca === null
            ? 'text-neutral-300'
            : diferenca === 0
              ? 'text-neutral-400'
              : falta
                ? 'text-[var(--color-perigo)]'
                : 'text-[var(--color-atencao)]',
        )}
      >
        {diferenca === null
          ? '—'
          : diferenca === 0
            ? 'bateu'
            : `${falta ? '− ' : '+ '}R$ ${brl(diferenca)}`}
      </span>

      <span className="sm:text-right">
        <span
          className={juntar(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
            STATUS[item.status]?.classe ?? 'bg-neutral-100 text-neutral-600',
          )}
        >
          {STATUS[item.status]?.nome ?? item.status}
        </span>
      </span>
    </div>
  );
}
