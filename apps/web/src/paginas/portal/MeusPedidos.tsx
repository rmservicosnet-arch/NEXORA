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
  AGUARDANDO_CONFIRMACAO: 'Na loja, sendo conferido',
  AGUARDANDO_ACEITE_CLIENTE: 'Esperando seu aceite',
  CONFIRMADO: 'Confirmado',
  CONFIRMADO_PARCIALMENTE: 'Confirmado em parte',
  DEVOLVIDO: 'Devolvido para você',
  RECUSADO: 'Recusado por você',
  FATURADO: 'Faturado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado sem resposta',
};

/**
 * Âmbar = precisa de VOCÊ; verde = acordado; vermelho = não veio.
 *
 * O que terminou fica em cinza de propósito: faturado é desfecho normal e não
 * disputa atenção com o que ainda pede uma decisão.
 */
const TOM: Record<StatusPedido, string> = {
  RASCUNHO: 'bg-neutral-100 text-neutral-500',
  AGUARDANDO_CONFIRMACAO: 'bg-primary-100 text-primary-600',
  AGUARDANDO_ACEITE_CLIENTE: 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
  CONFIRMADO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CONFIRMADO_PARCIALMENTE: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  DEVOLVIDO: 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
  RECUSADO: 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
  FATURADO: 'bg-neutral-100 text-neutral-500',
  CONCLUIDO: 'bg-neutral-100 text-neutral-500',
  CANCELADO: 'bg-neutral-100 text-neutral-500',
  EXPIRADO: 'bg-neutral-100 text-neutral-500',
};

export function SeloStatusCliente({ status }: { readonly status: StatusPedido }) {
  return (
    <span
      className={juntar(
        'inline-block w-fit rounded-full px-2.5 py-[3px] text-[11px] font-semibold',
        TOM[status] ?? 'bg-neutral-100 text-neutral-500',
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
 * "hoje, 14:05" antes de "20/09/2026".
 *
 * O cliente reconhece o pedido pelo quando, e "hoje" e "ontem" é como ele
 * pensa nos dois dias que importam. Data cheia só quando a distância já não
 * cabe numa palavra — e com o ano, senão 20/09 do ano passado se confunde
 * com o deste.
 */
function quando(iso: string | null): string {
  if (!iso) return 'não enviado';

  const data = new Date(iso);
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Comparacao de DIAS, nao de milissegundos: subtrair instantes e dividir por
  // 86.400.000 precisa de arredondamento (que o lint bloqueia, e com razao) e
  // erra em qualquer fuso com horario de verao.
  const agora = new Date();
  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);

  if (data.toDateString() === agora.toDateString()) return `hoje, ${hora}`;
  if (data.toDateString() === ontem.toDateString()) return `ontem, ${hora}`;

  if (data.getFullYear() === agora.getFullYear()) {
    const curta = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${curta}, ${hora}`;
  }

  return data.toLocaleDateString('pt-BR');
}

/**
 * Os quatro recortes PARTICIONAM o total.
 *
 * Cada um lista exatamente o que a contagem ao lado conta, e as quatro somadas
 * dão o número de "Todos" — é por isso que `encerrados` existe no servidor:
 * cancelado e expirado não cabiam em recorte nenhum e a soma não fechava.
 */
const RECORTES = [
  { chave: 'todos', rotulo: 'Todos', statusEm: null, contagem: 'total' },
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
    chave: 'encerrados',
    rotulo: 'Encerrados',
    statusEm: 'FATURADO,CONCLUIDO,DEVOLVIDO,RECUSADO,CANCELADO,EXPIRADO',
    contagem: 'encerrados',
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
   * O que espera o cliente, por fora do recorte.
   *
   * Consulta própria porque o aviso não pode sumir quando ele filtra por outra
   * coisa: é justamente o pedido que precisa de um toque. Mesma chave da barra
   * de abas — o TanStack serve as duas com uma consulta só.
   */
  const esperando = useQuery({
    queryKey: ['portal', 'pedidos', 'esperando'],
    queryFn: () =>
      pedir<PaginaPedidos>('/portal/pedidos?limite=1&statusEm=AGUARDANDO_ACEITE_CLIENTE'),
    retry: false,
  });

  const contagens = consulta.data?.contagens ?? esperando.data?.contagens;
  const meEsperam = contagens?.comOCliente ?? 0;
  const primeiroEsperando = esperando.data?.itens[0];

  return (
    <>
      <div className="flex flex-col gap-[3px]">
        <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
          Meus pedidos
        </h1>
        <p className="text-[13.5px] text-neutral-500">
          {contagens ? `${contagens.total} pedidos · ` : ''}do mais recente
        </p>
      </div>

      {mensagem ? <Aviso tom="sucesso">{mensagem}</Aviso> : null}

      {recorte !== 'voce' && primeiroEsperando ? (
        <PrecisaDeVoce
          pedido={primeiroEsperando}
          outros={meEsperam - 1}
          aoVerTodos={() => setRecorte('voce')}
        />
      ) : null}

      {contagens ? (
        <div className="flex flex-wrap items-center gap-2">
          {RECORTES.map((r) => (
            <button
              key={r.chave}
              type="button"
              onClick={() => setRecorte(r.chave)}
              className={juntar(
                'flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px]',
                recorte === r.chave
                  ? 'border-primary-600 bg-primary-600 font-semibold text-white'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300',
              )}
            >
              {r.rotulo}
              <span className="font-mono text-[11.5px] font-normal">{contagens[r.contagem]}</span>
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
        <section className="overflow-hidden rounded-lg border border-neutral-100 bg-white">
          {/*
            O cabeçalho só aparece onde a tabela cabe. Abaixo de `lg` a linha
            vira três faixas empilhadas, e um rótulo de coluna não descreveria
            mais nada.
          */}
          <div className="hidden grid-cols-[96px_150px_minmax(0,1fr)_190px_130px_40px] items-center gap-3.5 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 lg:grid">
            <Coluna>Pedido</Coluna>
            <Coluna>Enviado</Coluna>
            <Coluna>Itens</Coluna>
            <Coluna>Situação</Coluna>
            <Coluna direita>Valor</Coluna>
            <span />
          </div>

          {consulta.data.itens.map((pedido) => (
            <LinhaPedido key={pedido.id} pedido={pedido} />
          ))}
        </section>
      ) : null}
    </>
  );
}

function Coluna({
  children,
  direita,
}: {
  readonly children: React.ReactNode;
  readonly direita?: boolean;
}) {
  return (
    <span
      className={juntar(
        'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500',
        direita && 'text-right',
      )}
    >
      {children}
    </span>
  );
}

/**
 * O pedido que espera um toque do cliente, no alto e por extenso.
 *
 * A loja mexeu no que ele enviou e o total mudou. O comparativo vem junto
 * porque "aceita?" sem os dois números é um pedido de assinatura em branco.
 *
 * Um aviso, nunca uma pilha deles: com sessenta e nove parados, sessenta e
 * nove faixas âmbar não chamam atenção para nada. O mais recente por extenso,
 * e os outros numa linha que leva ao recorte.
 */
function PrecisaDeVoce({
  pedido,
  outros,
  aoVerTodos,
}: {
  readonly pedido: Pedido;
  readonly outros: number;
  readonly aoVerTodos: () => void;
}) {
  const aumento = Number(pedido.diferenca);
  const vence = pedido.validoAte ? new Date(pedido.validoAte) : null;

  // Quem mexeu e quando: o evento que empurrou o pedido para o aceite.
  const passagem = [...pedido.eventos]
    .reverse()
    .find((e) => e.paraStatus === 'AGUARDANDO_ACEITE_CLIENTE');

  return (
    <section className="rounded-lg border border-[#ebd6a8] bg-[#fdf6ec] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#f6e6c8]">
          <svg
            width="18"
            height="18"
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
              {passagem?.ator ? (
                <span className="text-neutral-500">
                  {' '}
                  — {passagem.ator}, {quando(passagem.criadoEm)}
                </span>
              ) : null}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-baseline gap-[7px] rounded-lg border border-neutral-100 bg-white px-2.5 py-[5px]">
              <span className="text-[11px] text-neutral-500">você pediu</span>
              <span className="font-mono text-[13px] text-neutral-500 line-through">
                R$ {brl(pedido.valorSolicitado)}
              </span>
            </span>

            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-atencao)"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 12h13" />
              <path d="m13 6 6 6-6 6" />
            </svg>

            <span className="inline-flex items-baseline gap-[7px] rounded-lg border border-[#ebd6a8] bg-white px-2.5 py-[5px]">
              <span className="text-[11px] text-neutral-500">a loja confirma</span>
              <span className="font-mono text-[14px] font-medium text-neutral-900">
                R$ {brl(pedido.valorConfirmado)}
              </span>
            </span>

            {aumento !== 0 ? (
              <span className="font-mono text-[12.5px] font-medium text-[var(--color-atencao)]">
                {aumento > 0 ? '+ ' : '− '}R$ {brl(Math.abs(aumento))}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Link
            to={`/portal/pedidos/${pedido.id}`}
            className="flex h-[38px] items-center justify-center rounded-lg bg-primary-600 px-[18px] text-[13px] font-semibold text-white no-underline"
          >
            Ver o que mudou
          </Link>
          {vence ? (
            <span className="text-center text-[10.5px] text-neutral-500">
              aceite até {vence.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })},{' '}
              {vence.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
        </div>
      </div>

      {outros > 0 ? (
        <button
          type="button"
          onClick={aoVerTodos}
          className="mt-3 w-full border-t border-[#ebd6a8] pt-2.5 text-left text-[12.5px] font-medium text-primary-700 underline-offset-2 hover:underline"
        >
          e mais {outros} {outros === 1 ? 'pedido esperando' : 'pedidos esperando'} sua resposta —
          ver todos
        </button>
      ) : null}
    </section>
  );
}

function LinhaPedido({ pedido }: { readonly pedido: Pedido }) {
  const precisaDeVoce = pedido.status === 'AGUARDANDO_ACEITE_CLIENTE';
  const aumento = Number(pedido.diferenca);

  /** O que tem dentro: o nome do primeiro reconhece o pedido; "4 itens" não. */
  const primeiro = pedido.itens[0];
  const resto = pedido.itens.length - 1;

  /*
    A segunda linha do valor muda com a situação, porque o que explica o número
    muda com ela: o aumento a aceitar, o que a loja não atendeu, o motivo da
    recusa. "Sem saldo" não se afirma aqui — a devolução pode ter outro motivo,
    e quem lê decide pelo que está escrito.
  */
  const naoAtendidos = pedido.itens.filter((i) => i.status === 'DEVOLVIDO').length;

  return (
    <Link
      to={`/portal/pedidos/${pedido.id}`}
      className={juntar(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-b border-neutral-50 px-4 py-3 no-underline last:border-0 hover:bg-neutral-25 lg:grid-cols-[96px_150px_minmax(0,1fr)_190px_130px_40px] lg:py-[13px]',
        precisaDeVoce && 'bg-[#fdf6ec] hover:bg-[var(--color-atencao-fundo)]',
      )}
    >
      <span className="col-start-1 row-start-1 font-mono text-[13px] font-medium text-neutral-900 lg:col-start-auto lg:row-start-auto">
        #{pedido.numero}
      </span>

      <span className="col-start-2 row-start-2 text-right text-[12.5px] text-neutral-500 lg:col-start-auto lg:row-start-auto lg:text-left">
        {quando(pedido.enviadoEm)}
      </span>

      <span className="col-span-2 row-start-3 min-w-0 truncate text-[12.5px] text-neutral-700 lg:col-span-1 lg:col-start-auto lg:row-start-auto">
        {primeiro
          ? `${primeiro.produto}${resto > 0 ? ` e mais ${String(resto)}` : ''}`
          : 'sem itens'}
      </span>

      <span className="col-start-1 row-start-2 lg:col-start-auto lg:row-start-auto">
        <SeloStatusCliente status={pedido.status} />
      </span>

      <span className="col-start-2 row-start-1 min-w-0 text-right lg:col-start-auto lg:row-start-auto">
        <span className="block font-mono text-[13.5px] font-medium text-neutral-900">
          R$ {brl(pedido.valorConfirmado)}
        </span>

        {precisaDeVoce && aumento !== 0 ? (
          <span className="block font-mono text-[11px] text-[var(--color-atencao)]">
            {aumento > 0 ? '+ ' : '− '}R$ {brl(Math.abs(aumento))}
          </span>
        ) : pedido.status === 'CONFIRMADO_PARCIALMENTE' && naoAtendidos > 0 ? (
          <span className="block text-[11px] text-neutral-500">
            {naoAtendidos} {naoAtendidos === 1 ? 'item não atendido' : 'itens não atendidos'}
          </span>
        ) : pedido.status === 'RECUSADO' && pedido.motivo ? (
          <span className="block truncate text-[11px] text-neutral-500">“{pedido.motivo}”</span>
        ) : null}
      </span>

      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
        className="hidden justify-self-end text-neutral-400 lg:block"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}
