import { PERM } from '@estoque/contracts';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { useSessao } from '../auth/sessao';
import { juntar } from '../ui/juntar';

/**
 * O índice dos relatórios.
 *
 * Os 36 aparecem todos, inclusive os que ainda não existem. Listar só o que
 * está pronto faria a tela parecer completa — e quem precisa do relatório de
 * ruptura ficaria procurando onde ele está, sem descobrir que ele não está
 * em lugar nenhum. O que existe leva a algum lugar; o resto diz a fase.
 */
interface Relatorio {
  readonly nome: string;
  readonly descricao: string;
  /** Mostra custo ou margem: exige `relatorio.ver_custo`. */
  readonly restrito?: boolean;
  /** Para onde vai, quando já existe. */
  readonly para?: string;
}

interface Grupo {
  readonly nome: string;
  readonly itens: readonly Relatorio[];
  /** Módulo que ainda não foi construído — o grupo inteiro espera por ele. */
  readonly fase?: string;
}

const GRUPOS: readonly Grupo[] = [
  {
    nome: 'Estoque',
    itens: [
      {
        nome: 'Posição de estoque',
        descricao: 'Saldo, custo médio e valor total',
        restrito: true,
        para: '/relatorios/estoque',
      },
      {
        nome: 'Saldo negativo',
        descricao: 'O que está abaixo de zero, e quanto tira do patrimônio',
        para: '/relatorios/estoque?recorte=negativos',
      },
      {
        nome: 'Abaixo do mínimo',
        descricao: 'O que repor, pelo saldo do local',
        para: '/relatorios/estoque?recorte=abaixoDoMinimo',
      },
      {
        nome: 'Razão de movimentações',
        descricao: 'Todo entra e sai, com saldo e custo',
        para: '/estoque',
      },
      {
        nome: 'Curva ABC',
        descricao: 'Os itens que concentram o valor, de A a C',
        restrito: true,
        para: '/relatorios/estoque',
      },
      {
        nome: 'Giro e cobertura',
        descricao: 'Quantas vezes girou, quantos dias cobre',
        restrito: true,
        para: '/relatorios/giro',
      },
      {
        nome: 'Sem movimento',
        descricao: 'Encalhe: dinheiro parado há N dias',
        restrito: true,
        para: '/relatorios/giro?ordem=parado',
      },
      {
        nome: 'Divergências de inventário',
        descricao: 'Contado contra sistema',
        para: '/relatorios/inventario',
      },
      {
        nome: 'Transferências',
        descricao: 'Enviado, recebido, em trânsito',
        para: '/relatorios/transferencias',
      },
    ],
  },
  {
    nome: 'Vendas',
    itens: [
      {
        nome: 'Vendas no período',
        descricao: 'Faturamento por dia, ticket médio',
        para: '/relatorios/vendas',
      },
      {
        nome: 'Ranking por vendedor',
        descricao: 'Valor, nº de vendas e margem',
        para: '/relatorios/vendas?dimensao=vendedor',
      },
      {
        nome: 'Ranking por produto',
        descricao: 'O que mais sai, em valor e quantidade',
        para: '/relatorios/vendas?dimensao=produto',
      },
      {
        nome: 'Ranking por cliente',
        descricao: 'Quem compra mais, com recorrência',
        para: '/relatorios/vendas?dimensao=cliente',
      },
      {
        nome: 'Ranking por tabela de preço',
        descricao: 'Professor, Aluno, Revendedor',
        para: '/relatorios/vendas?dimensao=tabela',
      },
      {
        nome: 'Ranking por categoria e marca',
        descricao: 'Onde está o faturamento',
        para: '/relatorios/vendas?dimensao=categoria',
      },
      {
        nome: 'Margem por dimensão',
        descricao: 'Margem bruta e % em qualquer corte',
        restrito: true,
        para: '/relatorios/vendas',
      },
      { nome: 'Formas de pagamento', descricao: 'Distribuição e prazo de recebimento' },
      { nome: 'Descontos concedidos', descricao: 'Por vendedor. Controle, não curiosidade' },
      { nome: 'Cancelamentos e devoluções', descricao: 'Volume, motivo e impacto' },
      { nome: 'Comparativo entre lojas', descricao: 'Mesma métrica, lojas lado a lado' },
    ],
  },
  {
    nome: 'Pedidos',
    itens: [
      { nome: 'Fila e tempo de confirmação', descricao: 'Quanto o pedido espera. Onde trava' },
      { nome: 'Taxa de confirmação', descricao: 'Confirmado, parcial, devolvido, recusado' },
      { nome: 'Ruptura', descricao: 'Venda perdida por falta de estoque' },
      { nome: 'Alterações pela equipe', descricao: 'O que foi incluído e removido, por quem' },
      { nome: 'Aceites de cliente', descricao: 'Aumentos aceitos e recusados' },
    ],
  },
  {
    nome: 'Carteira',
    itens: [
      { nome: 'Saldos em aberto', descricao: 'Quem deve, quanto e há quanto tempo' },
      {
        nome: 'Extrato por cliente',
        descricao: 'Todo crédito e débito, com saldo',
        para: '/carteiras',
      },
      { nome: 'Acima do limite', descricao: 'Quem passou do limite e com que autorização' },
      {
        nome: 'Ajustes e bonificações',
        descricao: 'Os lançamentos que criam dinheiro',
        restrito: true,
      },
    ],
  },
  {
    nome: 'Auditoria',
    itens: [
      { nome: 'Trilha por entidade', descricao: 'Tudo que aconteceu com um registro' },
      { nome: 'Ações sensíveis', descricao: 'Preço, ajuste, cancelamento, estorno' },
      { nome: 'Acessos e exportações', descricao: 'Quem levou dado de custo ou de cliente' },
    ],
  },
  {
    nome: 'Financeiro e caixa',
    fase: 'Fase 5',
    itens: [
      { nome: 'Contas a receber por vencimento', descricao: 'Aging: a vencer, 1–30, 31–60, 60+' },
      { nome: 'Contas a pagar por vencimento', descricao: 'Idem, do outro lado' },
      { nome: 'Fluxo de caixa realizado', descricao: 'Entrou e saiu, por período' },
      { nome: 'Fechamento de caixa', descricao: 'Conferência e diferenças' },
      { nome: 'Comissões apuradas', descricao: 'Por vendedor, com status de pagamento' },
    ],
  },
  {
    nome: 'Compras',
    fase: 'Fase 5',
    itens: [
      { nome: 'Compras por fornecedor', descricao: 'Volume, valor, prazo de entrega' },
      {
        nome: 'Evolução do custo de aquisição',
        descricao: 'Quanto o custo subiu, por item',
        restrito: true,
      },
      { nome: 'Pedidos de compra em aberto', descricao: 'Pedido e ainda não chegou' },
    ],
  },
];

const TOTAL = GRUPOS.reduce((soma, g) => soma + g.itens.length, 0);

/** Sem acento e em minúsculas: quem procura "razao" acha "Razão". */
function comparavel(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function Relatorios() {
  const { pode } = useSessao();
  const [busca, setBusca] = useState('');
  const podeVerCusto = pode(PERM.relatorio.verCusto);

  const grupos = useMemo(() => {
    const alvo = comparavel(busca.trim());
    if (!alvo) return GRUPOS;

    return GRUPOS.map((g) => ({
      ...g,
      itens: g.itens.filter(
        (r) => comparavel(r.nome).includes(alvo) || comparavel(r.descricao).includes(alvo),
      ),
    })).filter((g) => g.itens.length > 0);
  }, [busca]);

  const achados = grupos.reduce((soma, g) => soma + g.itens.length, 0);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar relatório…"
          aria-label="Buscar relatório"
          className="h-[34px] w-full max-w-[280px] rounded-md border border-neutral-200 bg-neutral-25 px-3 text-[13.5px]"
        />

        <div className="flex-1" />

        <span className="inline-flex h-7 items-center gap-2 rounded-full bg-neutral-50 px-3 text-[12px] font-medium text-neutral-600">
          <Cadeado />
          Cadeado = exige permissão de custo
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Relatórios
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            {TOTAL} relatórios · custo e margem só aparecem para quem tem permissão · toda
            exportação fica registrada na auditoria
          </p>
        </div>

        {busca.trim() ? (
          <p className="text-[12.5px] text-neutral-500">
            {achados === 0
              ? `Nenhum relatório com "${busca.trim()}".`
              : `${achados} ${achados === 1 ? 'relatório' : 'relatórios'} para "${busca.trim()}".`}
          </p>
        ) : null}

        {/* Três colunas de cartões, como no desenho. O navegador distribui;
            agrupar à mão travaria a ordem em telas estreitas. */}
        <div className="columns-1 gap-4 lg:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {grupos.map((g) => (
            <section
              key={g.nome}
              className="overflow-hidden rounded-lg border border-neutral-100 bg-white shadow-sm"
            >
              <div
                className={juntar(
                  'flex items-center gap-2.5 border-b border-neutral-100 px-3.5 py-2.5',
                  g.fase ? 'bg-neutral-25' : 'bg-primary-50',
                )}
              >
                <h2
                  className={juntar(
                    'flex-1 font-display text-[14px] font-semibold',
                    g.fase ? 'text-neutral-600' : 'text-primary-800',
                  )}
                >
                  {g.nome}
                </h2>
                {g.fase ? (
                  <span className="inline-flex h-5 items-center rounded-full border border-neutral-200 bg-white px-2 text-[10.5px] font-semibold text-neutral-500">
                    {g.fase}
                  </span>
                ) : null}
                <span className="font-mono text-[11.5px] text-neutral-500">{g.itens.length}</span>
              </div>

              {g.itens.map((r) => (
                <ItemRelatorio key={r.nome} relatorio={r} podeVerCusto={podeVerCusto} />
              ))}
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

/**
 * Uma linha do índice.
 *
 * O que não existe não vira link morto: fica legível, com a razão ao lado.
 * O restrito que a pessoa não pode ver diz isso — some seria pior, porque
 * ela ouviria falar do relatório e não o acharia.
 */
function ItemRelatorio({
  relatorio,
  podeVerCusto,
}: {
  readonly relatorio: Relatorio;
  readonly podeVerCusto: boolean;
}) {
  const bloqueado = relatorio.restrito === true && !podeVerCusto;
  const interno = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={juntar(
            'block text-[12.5px] font-medium leading-[17px]',
            relatorio.para && !bloqueado ? 'text-neutral-900' : 'text-neutral-600',
          )}
        >
          {relatorio.nome}
        </span>
        <span className="block truncate text-[11px] leading-[15px] text-neutral-400">
          {bloqueado ? 'Exige a permissão relatorio.ver_custo' : relatorio.descricao}
        </span>
      </span>

      {relatorio.restrito ? (
        <span className="shrink-0 text-neutral-400" aria-label="Exige permissão de custo">
          <Cadeado />
        </span>
      ) : null}

      {relatorio.para && !bloqueado ? (
        <span className="shrink-0 text-primary-600" aria-hidden="true">
          <Seta />
        </span>
      ) : (
        <span className="shrink-0 rounded bg-neutral-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-400">
          {bloqueado ? 'sem acesso' : 'a construir'}
        </span>
      )}
    </>
  );

  if (relatorio.para && !bloqueado) {
    return (
      <Link
        to={relatorio.para}
        className="flex items-center gap-2.5 border-b border-neutral-50 px-3.5 py-2 no-underline last:border-0 hover:bg-neutral-25"
      >
        {interno}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2.5 border-b border-neutral-50 px-3.5 py-2 last:border-0">
      {interno}
    </div>
  );
}

function Cadeado() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Seta() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}
