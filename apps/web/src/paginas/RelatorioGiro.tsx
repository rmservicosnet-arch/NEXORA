import {
  type ApoioProduto,
  type LinhaGiro,
  type LojaPainel,
  type RelatorioGiro,
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
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

type Ordem = 'giro' | 'parado';

/**
 * O mesmo relatório com dois nomes no índice.
 *
 * "Giro e cobertura" lê da frente: o que puxa a loja. "Sem movimento" lê de
 * trás: onde o dinheiro está dormindo. Duas telas seriam duas consultas que
 * precisam concordar sobre o que é girar — e elas divergiriam.
 */
const TITULOS: Record<Ordem, string> = {
  giro: 'Giro e cobertura',
  parado: 'Sem movimento',
};

export function RelatorioGiroTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const daUrl = parametrosUrl.get('ordem');
  const ordem: Ordem = daUrl === 'parado' ? 'parado' : 'giro';
  const dias = Number(parametrosUrl.get('dias') ?? 30);
  const lojaId = parametrosUrl.get('lojaId') ?? '';
  const categoriaId = parametrosUrl.get('categoriaId') ?? '';

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

  const apoio = useQuery({
    queryKey: ['produtos', 'apoio'],
    queryFn: () => pedir<ApoioProduto>('/produtos/apoio'),
  });

  const consulta = useQuery({
    queryKey: ['relatorios', 'giro', dias, lojaId, categoriaId, ordem],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '80', dias: String(dias), ordem });
      if (lojaId) p.set('lojaId', lojaId);
      if (categoriaId) p.set('categoriaId', categoriaId);
      return pedir<RelatorioGiro>(`/relatorios/giro?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const comCusto = dados?.valorEncalhado !== undefined;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      ordem === 'parado' ? 'sem-movimento.csv' : 'giro-e-cobertura.csv',
      [
        'sku',
        'produto',
        'variacao',
        'categoria',
        'saldo',
        'vendidas',
        'giro',
        'cobertura_dias',
        'parado_ha_dias',
        ...(comCusto ? ['valor_em_estoque'] : []),
      ],
      dados.itens.map((i) => [
        i.sku,
        i.produto,
        i.descricaoVariacao,
        i.categoria ?? '',
        i.saldo,
        i.vendidas,
        i.giro ?? '',
        i.cobertura ?? '',
        i.diasParado ?? '',
        ...(comCusto ? [i.valorEmEstoque ?? ''] : []),
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo={TITULOS[ordem]}
        comCusto={comCusto}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              {TITULOS[ordem]}
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · giro é o que saiu por venda dividido pelo saldo de hoje
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
              rotulo="Categoria"
              valor={categoriaId}
              aoMudar={(v) => trocar('categoriaId', v, '')}
            >
              <option value="">Todas</option>
              {(apoio.data?.categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>

            <Selecao rotulo="Ordem" valor={ordem} aoMudar={(v) => trocar('ordem', v, 'giro')}>
              <option value="giro">Maior giro primeiro</option>
              <option value="parado">Mais parado primeiro</option>
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Medindo o giro…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível medir o giro"
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
            <div
              className={juntar(
                'grid shrink-0 auto-rows-fr gap-3',
                comCusto ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
              )}
            >
              <Indicador
                rotulo="Sem venda no período"
                valor={String(dados.semVenda)}
                nota={`variações que não saíram em ${rotuloPeriodo(dados.dias)}`}
                tom={dados.semVenda > 0 ? 'atencao' : 'normal'}
                aoClicar={() => trocar('ordem', 'parado', 'giro')}
              />
              <Indicador
                rotulo="Sem movimento nenhum"
                valor={String(dados.semMovimento)}
                nota="nem entrada, nem saída, nem ajuste"
                tom={dados.semMovimento > 0 ? 'perigo' : 'normal'}
                aoClicar={() => trocar('ordem', 'parado', 'giro')}
              />
              {comCusto ? (
                <Indicador
                  rotulo="Dinheiro parado"
                  valor={`R$ ${brl(dados.valorEncalhado ?? 0)}`}
                  nota="custo do que não se moveu no período"
                  tom={Number(dados.valorEncalhado ?? 0) > 0 ? 'perigo' : 'normal'}
                />
              ) : null}
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[1120px]">
                <Cabecalho comCusto={comCusto} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nada neste recorte"
                      descricao="Ajuste o período, a loja ou a categoria."
                    />
                  ) : (
                    dados.itens.map((i) => (
                      <Linha key={i.variacaoId} item={i} comCusto={comCusto} dias={dados.dias} />
                    ))
                  )}
                </div>

                <div
                  className={juntar(
                    'hidden shrink-0 items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 sm:grid',
                    comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
                  )}
                >
                  <span className="col-span-3 text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length}{' '}
                    {dados.itens.length === 1 ? 'variação' : 'variações'} ·{' '}
                    {ordem === 'parado' ? 'do mais parado ao que mais girou' : 'do maior giro'}
                  </span>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  {comCusto ? (
                    <span className="text-right font-mono text-[14px] font-semibold text-neutral-900">
                      R$ {brl(dados.itens.reduce((s, i) => s + Number(i.valorEmEstoque ?? 0), 0))}
                    </span>
                  ) : null}
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE_COM_CUSTO =
  'sm:grid-cols-[128px_minmax(200px,1fr)_140px_74px_80px_64px_96px_96px_116px]';
const GRADE_SEM_CUSTO = 'sm:grid-cols-[128px_minmax(200px,1fr)_140px_74px_80px_64px_96px_96px]';

function Cabecalho({ comCusto }: { readonly comCusto: boolean }) {
  const colunas = [
    'SKU',
    'Variação',
    'Categoria',
    'Saldo',
    'Vendidas',
    'Giro',
    'Cobertura',
    'Parado há',
    ...(comCusto ? ['Valor em estoque'] : []),
  ];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
      )}
    >
      {colunas.map((c, i) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            i >= 3 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/** Abaixo disso o item acaba antes de a reposição chegar. */
const COBERTURA_CURTA = 15;
/** Acima disso não é lentidão: é encalhe. */
const PARADO_DEMAIS = 90;

function Linha({
  item,
  comCusto,
  dias,
}: {
  readonly item: LinhaGiro;
  readonly comCusto: boolean;
  readonly dias: number;
}) {
  const cobertura = item.cobertura === null ? null : Number(item.cobertura);
  const parado = item.diasParado;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        comCusto ? GRADE_COM_CUSTO : GRADE_SEM_CUSTO,
        parado !== null && parado >= PARADO_DEMAIS && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-600">{item.sku}</span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 sm:flex-none">
        {item.produto}
        <span className="text-neutral-500"> · {item.descricaoVariacao}</span>
      </span>

      <span className="truncate text-[12px] text-neutral-500">{item.categoria ?? '—'}</span>

      <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
        {item.saldo}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        {item.vendidas}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-medium sm:text-right',
          item.giro === null ? 'text-neutral-300' : 'text-neutral-900',
        )}
        title={item.giro === null ? 'Sem saldo para girar' : `${item.vendidas} em ${dias} dias`}
      >
        {item.giro ?? '—'}
      </span>

      {/*
        Cobertura sem venda não é "infinita": é a ausência de giro. Escrever
        um número grande ali faria o comprador acreditar que está coberto.
      */}
      <span
        className={juntar(
          'text-[12.5px] sm:text-right',
          cobertura === null
            ? 'text-neutral-400'
            : cobertura < COBERTURA_CURTA
              ? 'font-mono font-medium text-[var(--color-atencao)]'
              : 'font-mono text-neutral-700',
        )}
      >
        {cobertura === null ? 'sem giro' : `${cobertura} d`}
      </span>

      <span
        className={juntar(
          'text-[12.5px] sm:text-right',
          parado === null
            ? 'text-neutral-400'
            : parado >= PARADO_DEMAIS
              ? 'font-mono font-medium text-[var(--color-perigo)]'
              : 'font-mono text-neutral-600',
        )}
      >
        {parado === null ? 'nunca moveu' : `${parado} d`}
      </span>

      {comCusto ? (
        <span className="font-mono text-[13px] font-medium text-neutral-900 sm:text-right">
          R$ {brl(item.valorEmEstoque ?? 0)}
        </span>
      ) : null}
    </div>
  );
}
