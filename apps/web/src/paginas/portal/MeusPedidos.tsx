import type { PaginaPedidos, Pedido, StatusPedido } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../../ui/Estados';
import { juntar } from '../../ui/juntar';

/**
 * O que o status significa PARA O CLIENTE.
 *
 * Deliberadamente diferente dos rótulos da equipe. "Confirmado parcialmente"
 * descreve o trabalho de quem confirmou; quem comprou precisa saber que parte
 * do pedido não vem. O vocabulário segue quem lê.
 */
const ROTULO: Record<StatusPedido, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_CONFIRMACAO: 'A loja está conferindo',
  AGUARDANDO_ACEITE_CLIENTE: 'Esperando você',
  CONFIRMADO: 'Confirmado',
  CONFIRMADO_PARCIALMENTE: 'Confirmado em parte',
  DEVOLVIDO: 'Devolvido para você',
  RECUSADO: 'Recusado',
  FATURADO: 'Faturado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
};

/** Âmbar = precisa de VOCÊ. É a única cor que pede ação de quem olha. */
const TOM: Record<StatusPedido, string> = {
  RASCUNHO: 'bg-neutral-100 text-neutral-600',
  AGUARDANDO_CONFIRMACAO: 'bg-primary-50 text-primary-700',
  AGUARDANDO_ACEITE_CLIENTE: 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
  CONFIRMADO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CONFIRMADO_PARCIALMENTE: 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
  DEVOLVIDO: 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
  RECUSADO: 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
  FATURADO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CONCLUIDO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CANCELADO: 'bg-neutral-100 text-neutral-600',
  EXPIRADO: 'bg-neutral-100 text-neutral-600',
};

export function SeloStatusCliente({ status }: { readonly status: StatusPedido }) {
  return (
    <span
      className={juntar(
        'w-fit rounded px-2 py-0.5 text-[11px] font-semibold',
        TOM[status] ?? 'bg-neutral-100 text-neutral-600',
      )}
    >
      {ROTULO[status] ?? status}
    </span>
  );
}

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

/**
 * Os recortes, com a contagem que o servidor realmente devolve.
 *
 * Cada um lista EXATAMENTE o que a contagem ao lado conta — `statusEm` aqui e
 * o `count` de lá cobrem os mesmos status. Rótulo, número e consulta que
 * discordam é a armadilha que já mordeu na fila da equipe.
 *
 * "Todos" fica sem número de propósito: nenhuma contagem do servidor inclui
 * cancelado e expirado, então qualquer soma seria menor do que a lista que a
 * pílula abre.
 */
const RECORTES = [
  { chave: 'todos', rotulo: 'Todos', statusEm: null, contagem: null },
  {
    chave: 'voce',
    rotulo: 'Esperando você',
    statusEm: 'AGUARDANDO_ACEITE_CLIENTE',
    contagem: 'comOCliente',
  },
  {
    chave: 'loja',
    rotulo: 'Na loja',
    statusEm: 'AGUARDANDO_CONFIRMACAO',
    contagem: 'aguardando',
  },
  {
    chave: 'confirmados',
    rotulo: 'Confirmados',
    statusEm: 'CONFIRMADO,CONFIRMADO_PARCIALMENTE',
    contagem: 'confirmados',
  },
  {
    chave: 'faturados',
    rotulo: 'Faturados',
    statusEm: 'FATURADO,CONCLUIDO',
    contagem: 'faturados',
  },
  {
    chave: 'naoAtendidos',
    rotulo: 'Não atendidos',
    statusEm: 'DEVOLVIDO,RECUSADO',
    contagem: 'devolvidos',
  },
] as const;

type Chave = (typeof RECORTES)[number]['chave'];

export function PortalMeusPedidos() {
  const navegar = useNavigate();
  const local = useLocation();
  const mensagem = (local.state as { mensagem?: string } | null)?.mensagem ?? null;

  const [recorte, setRecorte] = useState<Chave>('todos');
  const atual = RECORTES.find((r) => r.chave === recorte) ?? RECORTES[0];

  const consulta = useQuery({
    queryKey: ['portal', 'pedidos', recorte],
    queryFn: () =>
      pedir<PaginaPedidos>(
        `/portal/pedidos?limite=40${atual.statusEm ? `&statusEm=${atual.statusEm}` : ''}`,
      ),
    placeholderData: keepPreviousData,
  });

  /**
   * Os que esperam o cliente, por fora do recorte.
   *
   * Consulta própria porque o aviso não pode sumir quando ele filtra por
   * outra coisa: é justamente o pedido que precisa de um toque, e numa lista
   * uniforme de doze ele se perde entre onze que não precisam de nada.
   */
  const esperando = useQuery({
    queryKey: ['portal', 'pedidos', 'esperando'],
    queryFn: () =>
      pedir<PaginaPedidos>('/portal/pedidos?limite=1&statusEm=AGUARDANDO_ACEITE_CLIENTE'),
  });

  const contagens = consulta.data?.contagens ?? esperando.data?.contagens;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[22px] font-bold text-neutral-900">Meus pedidos</h1>
        <p className="text-[13px] text-neutral-500">Do mais recente · toque para ver os itens</p>
      </div>

      {mensagem ? <Aviso tom="sucesso">{mensagem}</Aviso> : null}

      {/*
        Um aviso, nunca uma pilha deles.

        Quem tem um pedido parado vê o comparativo inteiro e decide dali. Quem
        tem sessenta e nove não precisa de sessenta e nove faixas âmbar — isso
        é a parede de avisos de novo, e uma parede não chama atenção para nada.
        Acima de um, o aviso conta e leva ao recorte.
      */}
      {recorte !== 'voce' && contagens && contagens.comOCliente > 0 ? (
        contagens.comOCliente === 1 && esperando.data?.itens[0] ? (
          <PrecisaDeVoce pedido={esperando.data.itens[0]} />
        ) : (
          <VariosEsperando
            quantos={contagens.comOCliente}
            aoVer={() => setRecorte('voce')}
          />
        )
      ) : null}

      {contagens ? (
        <div className="flex flex-wrap items-center gap-2">
          {RECORTES.map((r) => (
            <button
              key={r.chave}
              type="button"
              onClick={() => setRecorte(r.chave)}
              className={juntar(
                'flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px]',
                recorte === r.chave
                  ? 'border-primary-600 bg-primary-600 font-semibold text-white'
                  : 'border-neutral-200 bg-white text-neutral-700',
              )}
            >
              {r.rotulo}
              {r.contagem ? (
                <span className="font-mono text-[11.5px]">{contagens[r.contagem]}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {consulta.isPending ? <EstadoCarregando titulo="Carregando seus pedidos…" /> : null}

      {consulta.isError ? (
        <EstadoErro
          titulo="Não foi possível carregar"
          descricao={
            consulta.error instanceof ErroRequisicao
              ? consulta.error.corpo.mensagem
              : 'Tente novamente em instantes.'
          }
        />
      ) : null}

      {consulta.data?.itens.length === 0 ? (
        <EstadoVazio
          titulo={recorte === 'todos' ? 'Nenhum pedido ainda' : 'Nada neste recorte'}
          descricao={
            recorte === 'todos'
              ? 'Quando você enviar um pedido, ele aparece aqui com o andamento.'
              : 'Escolha outro recorte para ver os demais pedidos.'
          }
          acao={
            recorte === 'todos' ? (
              <Botao variante="primario" onClick={() => void navegar('/portal')}>
                Ver catálogo
              </Botao>
            ) : undefined
          }
        />
      ) : null}

      {consulta.data && consulta.data.itens.length > 0 ? (
        <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {consulta.data.itens.map((pedido) => (
            <LinhaPedido key={pedido.id} pedido={pedido} />
          ))}
        </section>
      ) : null}
    </>
  );
}

/** Muitos parados: o número e o caminho até eles. O detalhe fica na lista. */
function VariosEsperando({
  quantos,
  aoVer,
}: {
  readonly quantos: number;
  readonly aoVer: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border border-[#ebd6a8] bg-[var(--color-atencao-fundo)] px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/70">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-atencao)"
          strokeWidth="2.3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <path d="M12 16.5h.01" />
        </svg>
      </span>

      <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-neutral-800">
        <strong className="font-semibold">
          {quantos} pedidos esperam sua resposta.
        </strong>{' '}
        A loja alterou o que você pediu e cada um precisa do seu aceite para seguir.
      </p>

      <button
        type="button"
        onClick={aoVer}
        className="h-9 shrink-0 rounded-md bg-primary-600 px-4 text-[13px] font-semibold text-white"
      >
        Ver os {quantos}
      </button>
    </section>
  );
}

/**
 * O pedido que espera um toque do cliente, no alto e por extenso.
 *
 * A loja mexeu no que ele enviou e o total subiu. O comparativo vem junto
 * porque "aceita?" sem os dois números é um pedido de assinatura em branco.
 */
function PrecisaDeVoce({ pedido }: { readonly pedido: Pedido }) {
  const aumento = Number(pedido.diferenca);
  const vence = pedido.validoAte ? new Date(pedido.validoAte) : null;

  return (
    <section className="rounded-md border border-[#ebd6a8] bg-[var(--color-atencao-fundo)] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/70">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-atencao)"
            strokeWidth="2.3"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5" />
            <path d="M12 16.5h.01" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-bold text-neutral-900">
            A loja alterou o pedido #{pedido.numero} e espera você
          </p>

          {pedido.resumoAlteracao ? (
            <p className="mt-1 text-[12.5px] leading-[18px] text-neutral-700">
              “{pedido.resumoAlteracao}”
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-baseline gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1">
              <span className="text-[11px] text-neutral-500">você pediu</span>
              <span className="font-mono text-[12.5px] text-neutral-500 line-through">
                R$ {brl(pedido.valorSolicitado)}
              </span>
            </span>

            <span className="text-[var(--color-atencao)]">→</span>

            <span className="inline-flex items-baseline gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1">
              <span className="text-[11px] text-neutral-500">a loja confirma</span>
              <span className="font-mono text-[13.5px] font-medium text-neutral-900">
                R$ {brl(pedido.valorConfirmado)}
              </span>
            </span>

            {aumento !== 0 ? (
              <span className="font-mono text-[12.5px] font-semibold text-[var(--color-atencao)]">
                {aumento > 0 ? '+ ' : '− '}R$ {brl(Math.abs(aumento))}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1">
          <Link
            to={`/portal/pedidos/${pedido.id}`}
            className="flex h-10 items-center justify-center rounded-md bg-primary-600 px-4 text-[13px] font-semibold text-white no-underline"
          >
            Ver o que mudou
          </Link>
          {vence ? (
            <span className="text-center text-[10.5px] text-neutral-500">
              aceite até {vence.toLocaleDateString('pt-BR')},{' '}
              {vence.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function LinhaPedido({ pedido }: { readonly pedido: Pedido }) {
  const enviado = pedido.enviadoEm ? new Date(pedido.enviadoEm) : null;
  const precisaDeVoce = pedido.status === 'AGUARDANDO_ACEITE_CLIENTE';
  const aumento = Number(pedido.diferenca);

  /** O que tem dentro, em uma linha: "Kimono Trançado e mais 3". */
  const primeiro = pedido.itens[0];
  const resto = pedido.itens.length - 1;

  return (
    /*
      No celular, uma grade de duas colunas e duas linhas: identidade e valor
      em cima, o que tem dentro e a data embaixo. A partir de `sm` a linha
      volta a ser uma só, e o bloco de identidade devolve suas colunas com
      `sm:contents` em vez de virar uma caixa dentro da caixa.
    */
    <Link
      to={`/portal/pedidos/${pedido.id}`}
      className={juntar(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-3 no-underline last:border-0 hover:bg-neutral-25 sm:flex sm:gap-3',
        precisaDeVoce && 'bg-[var(--color-atencao-fundo)]',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5 sm:contents">
        <span className="font-mono text-[13px] font-medium text-neutral-600">#{pedido.numero}</span>
        <SeloStatusCliente status={pedido.status} />
      </span>

      <span className="text-right sm:order-last sm:ml-auto">
        <span className="block font-mono text-[13.5px] font-semibold text-neutral-900">
          R$ {brl(pedido.valorConfirmado)}
        </span>
        {precisaDeVoce && aumento !== 0 ? (
          <span className="block font-mono text-[11px] text-[var(--color-atencao)]">
            {aumento > 0 ? '+ ' : '− '}R$ {brl(Math.abs(aumento))}
          </span>
        ) : null}
      </span>

      {/*
        O que tem dentro. "1 item" não ajuda ninguém a reconhecer o pedido de
        três dias atrás; o nome do primeiro produto ajuda.
      */}
      <span className="min-w-0 truncate text-[12.5px] text-neutral-600 sm:flex-1">
        {primeiro
          ? `${primeiro.produto}${resto > 0 ? ` e mais ${String(resto)}` : ''}`
          : 'sem itens'}
      </span>

      <span className="shrink-0 text-right text-[12px] text-neutral-500 sm:text-left">
        {enviado ? enviado.toLocaleDateString('pt-BR') : 'não enviado'}
      </span>
    </Link>
  );
}
