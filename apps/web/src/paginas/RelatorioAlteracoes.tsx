import { type LinhaAlteracao, type LojaPainel, type RelatorioAlteracoes } from '@estoque/contracts';
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

/**
 * Alterações pela equipe.
 *
 * Remoção é lógica: o item sai da conta e permanece na linha do tempo, com
 * autor e motivo. Remoção sem motivo escrito aparece contada à parte — o
 * acordo com o cliente existiu, mas ninguém consegue mais dizer qual foi.
 */
export function RelatorioAlteracoesTela() {
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
    queryKey: ['relatorios', 'alteracoes', dias, lojaId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias) });
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<RelatorioAlteracoes>(`/relatorios/pedidos/alteracoes?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const semMotivo = dados?.porAutor.reduce((s, a) => s + a.semMotivo, 0) ?? 0;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'alteracoes-pela-equipe.csv',
      [
        'pedido',
        'cliente',
        'em',
        'acao',
        'sku',
        'produto',
        'quantidade',
        'valor',
        'motivo',
        'autor',
      ],
      dados.itens.map((i) => [
        i.numero,
        i.cliente,
        dataHora(i.em),
        i.acao === 'INCLUSAO' ? 'inclusão' : 'remoção',
        i.sku,
        `${i.produto} · ${i.descricaoVariacao}`,
        i.quantidade,
        i.valor,
        i.motivo ?? '',
        i.autor ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Alterações pela equipe"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Alterações pela equipe
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · o que foi incluído e retirado do pedido do cliente
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

        {consulta.isPending ? <EstadoCarregando titulo="Lendo a linha do tempo…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar as alterações"
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
                rotulo="Itens incluídos"
                valor={String(dados.inclusoes)}
                nota={`R$ ${brl(dados.valorIncluido)} somados ao pedido`}
                tom={dados.inclusoes > 0 ? 'sucesso' : 'normal'}
              />
              <Indicador
                rotulo="Itens retirados"
                valor={String(dados.remocoes)}
                nota={`R$ ${brl(dados.valorRemovido)} tirados do pedido`}
                tom={dados.remocoes > 0 ? 'atencao' : 'normal'}
              />
              {/*
                Remoção sem motivo é o que o suporte não consegue explicar
                depois. Fica em vermelho porque é uma falha de registro, não
                uma estatística.
              */}
              <Indicador
                rotulo="Sem motivo escrito"
                valor={String(semMotivo)}
                nota="ninguém consegue dizer o que foi acordado"
                tom={semMotivo > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Pedidos tocados"
                valor={String(dados.pedidosTocados)}
                nota="saíram diferentes do que o cliente enviou"
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[800px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Nenhuma alteração no período"
                        descricao="Os pedidos saíram como o cliente enviou."
                      />
                    ) : (
                      dados.itens.map((i) => <Linha key={i.id} item={i} />)
                    )}
                  </div>
                </div>
              </Painel>

              <PorAutor dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function PorAutor({ dados }: { readonly dados: RelatorioAlteracoes }) {
  return (
    <section className="w-full shrink-0 self-start rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[300px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">Por quem alterou</h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Alterar não é falha. Alterar sem registrar o acordo é.
      </p>

      {dados.porAutor.length === 0 ? (
        <p className="mt-4 text-[13px] text-neutral-400">Nenhuma alteração no período.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3">
          {dados.porAutor.map((a) => (
            <div
              key={a.autor}
              className="border-t border-neutral-50 pt-2.5 first:border-t-0 first:pt-0"
            >
              <p className="truncate text-[13px] font-medium text-neutral-900">{a.autor}</p>

              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
                <span className="text-[var(--color-sucesso)]">
                  +{a.inclusoes} <span className="font-mono">R$ {brl(a.valorIncluido)}</span>
                </span>
                <span className="text-[var(--color-atencao)]">
                  −{a.remocoes} <span className="font-mono">R$ {brl(a.valorRemovido)}</span>
                </span>
              </div>

              {a.semMotivo > 0 ? (
                <p className="mt-0.5 text-[11.5px] font-medium text-[var(--color-perigo)]">
                  {a.semMotivo} {a.semMotivo === 1 ? 'remoção' : 'remoções'} sem motivo
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const GRADE = 'sm:grid-cols-[70px_116px_84px_minmax(170px,1fr)_60px_104px_128px]';

function Cabecalho() {
  const colunas = ['Pedido', 'Quando', 'Ação', 'Item', 'Qtd.', 'Valor', 'Motivo'];

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
            ['Qtd.', 'Valor'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAlteracao }) {
  const inclusao = item.acao === 'INCLUSAO';

  return (
    <Link
      to={`/pedidos/${item.pedidoId}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 no-underline hover:bg-neutral-25 sm:grid',
        GRADE,
      )}
    >
      <span className="font-mono text-[12px] text-neutral-600">#{item.numero}</span>

      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span>
        <span
          className={juntar(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
            inclusao
              ? 'bg-[#e8f3ec] text-[var(--color-sucesso)]'
              : 'bg-[#fdf3e3] text-[var(--color-atencao)]',
          )}
        >
          {inclusao ? 'Incluiu' : 'Retirou'}
        </span>
      </span>

      <span className="min-w-0 truncate text-[13px] text-neutral-900">
        {item.produto}
        <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
        <span className="block truncate text-[11.5px] text-neutral-400">
          {item.cliente}
          {item.autor ? ` · por ${item.autor}` : ''}
        </span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        {item.quantidade}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-medium sm:text-right',
          inclusao ? 'text-[var(--color-sucesso)]' : 'text-[var(--color-atencao)]',
        )}
      >
        {inclusao ? '+' : '−'} R$ {brl(item.valor)}
      </span>

      {/* Sem motivo é elemento visível, não célula vazia: célula vazia parece
          dado que não carregou. */}
      <span className="min-w-0 truncate text-[12.5px] text-neutral-600" title={item.motivo ?? ''}>
        {item.motivo ?? <span className="text-[var(--color-perigo)]">não registrado</span>}
      </span>
    </Link>
  );
}
