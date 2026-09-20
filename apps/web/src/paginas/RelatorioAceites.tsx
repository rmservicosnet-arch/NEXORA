import { type LinhaAceite, type LojaPainel, type RelatorioAceites } from '@estoque/contracts';
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

const DESFECHOS: Record<LinhaAceite['desfecho'], { nome: string; classe: string }> = {
  ACEITO: { nome: 'Aceitou', classe: 'bg-[#e8f3ec] text-[var(--color-sucesso)]' },
  RECUSADO: { nome: 'Recusou', classe: 'bg-[#fdecec] text-[var(--color-perigo)]' },
  PENDENTE: { nome: 'Esperando', classe: 'bg-neutral-100 text-neutral-600' },
};

/**
 * Aceites de cliente.
 *
 * Quando a edição da equipe aumenta o total, o pedido para e espera o toque
 * do cliente. Pendente não é recusa: a taxa se mede sobre os respondidos, ou
 * um aumento enviado há uma hora faria a equipe achar que o cliente rejeita
 * tudo.
 */
export function RelatorioAceitesTela() {
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
    queryKey: ['relatorios', 'aceites', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioAceites>(`/relatorios/pedidos/aceites?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'aceites-de-cliente.csv',
      [
        'pedido',
        'cliente',
        'loja',
        'pedido_em',
        'solicitado',
        'confirmado',
        'aumento',
        'desfecho',
        'horas',
      ],
      dados.itens.map((i) => [
        i.numero,
        i.cliente,
        i.loja,
        dataHora(i.pedidoEm),
        i.valorSolicitado,
        i.valorConfirmado,
        i.aumento,
        DESFECHOS[i.desfecho].nome,
        i.horasAte ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Aceites de cliente"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Aceites de cliente
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · edições da equipe que aumentaram o total
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

        {consulta.isPending ? <EstadoCarregando titulo="Buscando os aceites…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar os aceites"
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
                rotulo="Taxa de aceite"
                valor={`${dados.taxaAceite}%`}
                nota={`de ${dados.aceitos + dados.recusados} respondidos`}
                tom={Number(dados.taxaAceite) < 60 ? 'atencao' : 'sucesso'}
              />
              {/*
                Pendente fora da taxa, e dito por extenso: sem isso o número
                pareceria estar escondendo aumento recusado.
              */}
              <Indicador
                rotulo="Esperando resposta"
                valor={String(dados.pendentes)}
                nota="fora da taxa: ainda não responderam"
                tom={dados.pendentes > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="Aumento aceito"
                valor={`R$ ${brl(dados.aumentoAceito)}`}
                nota="a mais que o pedido original"
                tom="sucesso"
              />
              <Indicador
                rotulo="Tempo até responder"
                valor={dados.horasMedias === null ? '—' : `${dados.horasMedias} h`}
                nota="média dos que aceitaram"
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1060px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhum aceite pedido no período"
                      descricao="Nenhuma edição da equipe aumentou o total de um pedido."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.id} item={i} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length} de {dados.pedidosDeAceite} · aceitos{' '}
                    {dados.aceitos} · recusados {dados.recusados} · esperando {dados.pendentes}
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

const GRADE = 'sm:grid-cols-[70px_minmax(160px,1fr)_116px_110px_110px_110px_96px_80px]';

function Cabecalho() {
  const colunas = [
    'Pedido',
    'Cliente',
    'Pedido em',
    'Solicitado',
    'Confirmado',
    'Aumento',
    'Desfecho',
    'Em',
  ];

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
            i > 2 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAceite }) {
  const aumento = Number(item.aumento);

  return (
    <Link
      to={`/pedidos/${item.id}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 no-underline hover:bg-neutral-25 sm:grid',
        GRADE,
        item.desfecho === 'PENDENTE' && 'bg-[#fdfaf6]',
      )}
    >
      <span className="font-mono text-[12px] text-neutral-600">#{item.numero}</span>

      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.cliente}
        {item.resumoAlteracao ? (
          <span className="block truncate text-[11.5px] font-normal text-neutral-400">
            {item.resumoAlteracao}
          </span>
        ) : null}
      </span>

      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.pedidoEm)}</span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        R$ {brl(item.valorSolicitado)}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-700 sm:text-right">
        R$ {brl(item.valorConfirmado)}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-semibold sm:text-right',
          aumento > 0 ? 'text-[var(--color-atencao)]' : 'text-neutral-400',
        )}
      >
        {aumento > 0 ? '+ ' : ''}R$ {brl(item.aumento)}
      </span>

      <span className="sm:text-right">
        <span
          className={juntar(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
            DESFECHOS[item.desfecho].classe,
          )}
        >
          {DESFECHOS[item.desfecho].nome}
        </span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-500 sm:text-right">
        {item.horasAte === null ? '—' : `${item.horasAte} h`}
      </span>
    </Link>
  );
}
