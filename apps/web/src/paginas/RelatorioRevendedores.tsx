import { type LinhaRevendedor, type RelatorioRevendedores } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

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

const PERFIL: Record<LinhaRevendedor['perfil'], string> = {
  CONSUMIDOR: 'Consumidor',
  PROFESSOR: 'Professor',
  REVENDEDOR: 'Revendedor',
};

/**
 * Quem mais COMPROU no período — professores e revendedores.
 *
 * Não "quem mais vendeu". A revenda do professor acontece fora daqui: ele
 * compra da loja e vende para os alunos dele, e o sistema não vê essa segunda
 * venda. Premiar por compra é o que dá para fazer com honestidade — e é o que
 * a loja de fato mede.
 */
export function RelatorioRevendedoresTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 90);
  const perfil = parametrosUrl.get('perfil') ?? 'TODOS';

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'revendedores', dias, perfil],
    queryFn: () =>
      pedir<RelatorioRevendedores>(
        `/relatorios/vendas/revendedores?dias=${String(dias)}&perfil=${perfil}&limite=100`,
      ),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'ranking-de-revendedores.csv',
      [
        'posicao',
        'cliente',
        'perfil',
        'tabela_preco',
        'compras',
        'itens',
        'valor',
        'ticket_medio',
        'participacao',
        'dias_sem_comprar',
      ],
      dados.itens.map((i) => [
        i.posicao,
        i.cliente,
        PERFIL[i.perfil],
        i.tabelaPreco ?? '',
        i.compras,
        i.itens,
        i.valor,
        i.ticketMedio,
        i.participacao,
        i.diasSemComprar ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Ranking de revendedores"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Ranking de revendedores
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              Quem mais <strong className="font-semibold text-neutral-900">comprou</strong> da loja
              em {rotuloPeriodo(dias)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao rotulo="Perfil" valor={perfil} aoMudar={(v) => trocar('perfil', v, 'TODOS')}>
              <option value="TODOS">Professores e revendedores</option>
              <option value="PROFESSOR">Só professores</option>
              <option value="REVENDEDOR">Só revendedores</option>
            </Selecao>

            <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '90')}>
              {PERIODOS.map((d) => (
                <option key={d} value={d}>
                  {rotuloPeriodo(d)}
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {/*
          O que o número É, dito antes de alguém premiar por ele. A revenda do
          professor não passa por aqui, e a tela não pode deixar isso
          subentendido.
        */}
        <p className="shrink-0 rounded-md border border-neutral-100 bg-neutral-25 px-3.5 py-2.5 text-[12px] leading-4 text-neutral-500">
          Mede <strong className="font-semibold text-neutral-700">compra da loja</strong>, não
          revenda: o que o professor vendeu aos alunos dele acontece fora do sistema. A base é a
          venda faturada — pedido confirmado e não faturado ainda é compromisso. O perfil vem do{' '}
          <Link to="/clientes" className="font-semibold">
            cadastro do cliente
          </Link>
          , não da tabela de preço.
        </p>

        {consulta.isPending ? <EstadoCarregando titulo="Somando por cliente…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível montar o ranking"
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
                rotulo="Comprado no período"
                valor={`R$ ${brl(dados.total)}`}
                nota={`${String(dados.compras)} ${dados.compras === 1 ? 'venda' : 'vendas'} faturadas`}
              />
              <Indicador
                rotulo="Compraram"
                valor={String(dados.revendedores)}
                nota="com ao menos uma compra no período"
              />
              <Indicador
                rotulo="Primeiro colocado"
                valor={dados.itens[0] ? `${brl(dados.itens[0].participacao)}%` : '—'}
                nota={dados.itens[0]?.cliente ?? 'ninguém comprou no período'}
                tom="sucesso"
              />
              {/*
                O número que o ranking ESCONDE: quem sumiu não aparece numa
                lista de quem comprou, e é justamente ele que um programa de
                premiação precisa enxergar.
              */}
              <Indicador
                rotulo="Sem comprar no período"
                valor={String(dados.semCompraNoPeriodo)}
                nota="cadastros com perfil de revenda e nenhuma compra"
                tom={dados.semCompraNoPeriodo > 0 ? 'atencao' : 'normal'}
              />
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[980px]">
                <Cabecalho />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma compra no período"
                      descricao="Aumente o período, ou marque o perfil dos clientes no cadastro — o ranking olha para quem está como professor ou revendedor."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.clienteId} item={i} />)
                  )}
                </div>

                <div className="hidden shrink-0 items-center border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 lg:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Exibindo {dados.itens.length} de {dados.revendedores} · do que mais comprou
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

const GRADE = 'lg:grid-cols-[52px_minmax(180px,1fr)_120px_76px_140px_120px_110px_110px]';

function Cabecalho() {
  const colunas = [
    '#',
    'Cliente',
    'Perfil',
    'Compras',
    'Comprado',
    'Ticket médio',
    'Participação',
    'Última compra',
  ];

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
            i >= 3 && i <= 5 ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaRevendedor }) {
  const podio = item.posicao <= 3;
  /* Quem comprou muito e sumiu é o caso que o ranking por valor não mostra. */
  const sumindo = item.diasSemComprar !== null && item.diasSemComprar > 45;

  return (
    <Link
      to={`/carteiras/${item.clienteId}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 no-underline hover:bg-neutral-25 lg:grid',
        GRADE,
        podio && 'bg-[#f6f8f3]',
      )}
    >
      <span
        className={juntar(
          'font-mono text-[13px] font-semibold tabular-nums',
          podio ? 'text-[var(--color-sucesso)]' : 'text-neutral-400',
        )}
      >
        {item.posicao}º
      </span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 lg:flex-none">
        {item.cliente}
        {item.tabelaPreco ? (
          <span className="block truncate text-[11px] text-neutral-400">
            tabela {item.tabelaPreco}
          </span>
        ) : null}
      </span>

      <span>
        <span className="inline-block rounded-full bg-primary-100 px-2.5 py-[3px] text-[11px] font-semibold text-primary-600">
          {PERFIL[item.perfil]}
        </span>
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 lg:text-right">{item.compras}</span>

      <span className="font-mono text-[13.5px] font-medium tabular-nums text-neutral-900 lg:text-right">
        R$ {brl(item.valor)}
      </span>

      <span className="font-mono text-[12.5px] tabular-nums text-neutral-600 lg:text-right">
        R$ {brl(item.ticketMedio)}
      </span>

      <span className="flex items-center gap-2">
        <span className="hidden h-1.5 w-full max-w-[48px] overflow-hidden rounded-full bg-neutral-100 lg:block">
          <span
            className="block h-full rounded-full bg-primary-500"
            style={{ width: `${item.participacao}%` }}
          />
        </span>
        <span className="font-mono text-[12px] tabular-nums text-neutral-600">
          {brl(item.participacao)}%
        </span>
      </span>

      <span
        className={juntar(
          'text-[12px]',
          sumindo ? 'font-medium text-[var(--color-atencao)]' : 'text-neutral-500',
        )}
      >
        {item.diasSemComprar === null
          ? '—'
          : item.diasSemComprar === 0
            ? 'hoje'
            : `há ${String(item.diasSemComprar)} dias`}
      </span>
    </Link>
  );
}
