import { type PaginaPedidos, type Pedido, type StatusPedido } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

export const ROTULO_STATUS: Record<StatusPedido, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_CONFIRMACAO: 'Aguardando confirmação',
  AGUARDANDO_ACEITE_CLIENTE: 'Esperando o cliente',
  CONFIRMADO: 'Confirmado',
  CONFIRMADO_PARCIALMENTE: 'Confirmado em parte',
  DEVOLVIDO: 'Devolvido',
  RECUSADO: 'Recusado',
  FATURADO: 'Faturado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
};

/**
 * A cor diz o que o status PEDE, não o que ele é.
 *
 * Âmbar = a equipe precisa agir. Azul = a bola está com o cliente. Verde =
 * andou. Cinza = acabou. Quem abre a fila procura o que fazer, não um
 * inventário de estados.
 */
const TOM_STATUS: Record<StatusPedido, string> = {
  RASCUNHO: 'bg-neutral-100 text-neutral-600',
  AGUARDANDO_CONFIRMACAO: 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
  AGUARDANDO_ACEITE_CLIENTE: 'bg-primary-50 text-primary-700',
  CONFIRMADO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CONFIRMADO_PARCIALMENTE: 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
  DEVOLVIDO: 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
  RECUSADO: 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
  FATURADO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CONCLUIDO: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  CANCELADO: 'bg-neutral-100 text-neutral-600',
  EXPIRADO: 'bg-neutral-100 text-neutral-600',
};

export function SeloStatus({ status }: { readonly status: StatusPedido }) {
  return (
    <span
      className={juntar(
        'w-fit whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold',
        TOM_STATUS[status] ?? 'bg-neutral-100 text-neutral-600',
      )}
    >
      {ROTULO_STATUS[status] ?? status}
    </span>
  );
}

/**
 * Cada aba lista EXATAMENTE o que a contagem dela conta.
 *
 * A primeira usava `apenasFila=true`, que inclui confirmado e confirmado em
 * parte — a aba dizia "Aguardando confirmação" e abria pedido já confirmado,
 * sem os controles de conferência. O número ao lado, esse, contava só os
 * aguardando: rótulo, contagem e lista discordavam entre si.
 */
const ABAS = [
  {
    chave: 'fila',
    rotulo: 'Aguardando confirmação',
    query: '?statusEm=AGUARDANDO_CONFIRMACAO&limite=60',
  },
  {
    chave: 'cliente',
    rotulo: 'Com o cliente',
    query: '?statusEm=AGUARDANDO_ACEITE_CLIENTE&limite=60',
  },
  {
    chave: 'confirmados',
    rotulo: 'Confirmados',
    query: '?statusEm=CONFIRMADO,CONFIRMADO_PARCIALMENTE&limite=60',
  },
  {
    chave: 'devolvidos',
    rotulo: 'Devolvidos',
    query: '?statusEm=DEVOLVIDO,RECUSADO&limite=60',
  },
  {
    chave: 'faturados',
    rotulo: 'Faturados',
    query: '?statusEm=FATURADO,CONCLUIDO&limite=60',
  },
] as const;

type Aba = (typeof ABAS)[number]['chave'];

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

/**
 * Quantos itens do pedido estão sem saldo no local dele.
 *
 * `disponivelAgora` só vem para a equipe — no portal a chave nem existe.
 * Por isso a conta é feita aqui e não no servidor: é informação de quem
 * confere, e o cliente nunca deve recebê-la.
 */
function semSaldo(pedido: Pedido): number {
  return pedido.itens.filter((i) => {
    if (i.status === 'REMOVIDO' || i.status === 'CANCELADO') return false;
    if (i.disponivelAgora === undefined) return false;
    const pedida = Number(i.quantidadeSolicitada) || Number(i.quantidadeConfirmada);
    return Number(i.disponivelAgora) < pedida;
  }).length;
}

function venceu(pedido: Pedido): boolean {
  return pedido.validoAte !== null && new Date(pedido.validoAte).getTime() < Date.now();
}

/** "há 2 h", "ontem", "há 3 dias" — quanto tempo o cliente está esperando. */
function desde(iso: string | null): string {
  if (!iso) return '—';
  const horas = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (horas < 1) return 'agora';
  if (horas < 24) return `há ${String(horas)} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `há ${String(dias)} dias`;
}

export function Pedidos() {
  const [aba, setAba] = useState<Aba>('fila');
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = useQuery({
    queryKey: ['pedidos', 'fila', aba],
    queryFn: () =>
      pedir<PaginaPedidos>(
        `/pedidos${ABAS.find((a) => a.chave === aba)?.query ?? '?apenasFila=true&limite=60'}`,
      ),
    // A fila muda sem a pessoa fazer nada: pedido novo chega do portal.
    refetchInterval: 30_000,
  });

  const contagens = consulta.data?.contagens;
  const quantos: Record<Aba, number | undefined> = {
    fila: contagens ? contagens.aguardando : undefined,
    cliente: contagens?.comOCliente,
    confirmados: contagens?.confirmados,
    devolvidos: contagens?.devolvidos,
    faturados: contagens?.faturados,
  };

  const todos = consulta.data?.itens ?? [];
  const visiveis = busca
    ? todos.filter(
        (p) =>
          String(p.numero).includes(busca) ||
          p.cliente.toLowerCase().includes(busca) ||
          (p.solicitante ?? '').toLowerCase().includes(busca),
      )
    : todos;

  const comFalta = visiveis.filter((p) => semSaldo(p) > 0).length;
  const vencidos = visiveis.filter(venceu).length;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <h1 className="font-display text-[15px] font-semibold text-neutral-900">Pedidos</h1>
        <input
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Número do pedido ou cliente…"
          aria-label="Buscar na fila"
          className="h-9 min-w-[180px] flex-1 rounded-md border border-neutral-200 bg-white px-3 text-[13px] sm:max-w-[320px]"
        />
        <div className="hidden flex-1 sm:block" />
        {contagens ? (
          <span className="text-[12.5px] text-neutral-500">
            <strong className="font-mono font-semibold text-neutral-900">
              {contagens.aguardando}
            </strong>{' '}
            aguardando a equipe
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[22px] font-bold text-neutral-900">Fila de pedidos</h2>
          {/*
            O subtítulo conta o que EXIGE decisão, não o total. Pedido em
            espera não reserva estoque; a reserva nasce na confirmação.
          */}
          <p className="text-[13px] text-neutral-500">
            {visiveis.length} {visiveis.length === 1 ? 'pedido' : 'pedidos'}
            {comFalta > 0 ? ` · ${String(comFalta)} com item sem saldo` : ''}
            {vencidos > 0 ? ` · ${String(vencidos)} com validade vencida` : ''}
            {comFalta === 0 && vencidos === 0 ? ' · nada travado' : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ABAS.map((a) => (
            <button
              key={a.chave}
              type="button"
              onClick={() => setAba(a.chave)}
              className={juntar(
                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px]',
                aba === a.chave
                  ? 'border-primary-600 bg-primary-600 font-medium text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50',
              )}
            >
              {a.rotulo}
              {quantos[a.chave] !== undefined ? (
                <span
                  className={juntar(
                    'rounded-full px-1.5 font-mono text-[11px]',
                    aba === a.chave ? 'bg-white text-primary-700' : 'bg-neutral-100',
                  )}
                >
                  {quantos[a.chave]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Carregando pedidos…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar a fila"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
          />
        ) : null}

        {consulta.isSuccess && visiveis.length === 0 ? (
          <EstadoVazio
            titulo={busca ? 'Nada encontrado' : 'Nenhum pedido aqui'}
            descricao={
              busca
                ? 'Tente outro número ou outro nome.'
                : 'Quando um cliente enviar um pedido, ele aparece nesta fila.'
            }
          />
        ) : null}

        {visiveis.length > 0 ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-x-auto rounded-md border border-neutral-100 bg-white shadow-sm">
            {/*
              Largura mínima da grade: 92+1fr+104+54+124+104+88+92+92 mais os
              vãos passa de 940px. Sem o mínimo, as colunas se espremem uma
              sobre a outra em vez de a tabela rolar — foi o que aconteceu.
            */}
            <div className="hidden shrink-0 grid-cols-[92px_minmax(160px,1fr)_104px_54px_124px_104px_88px_92px_92px] items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 lg:grid lg:min-w-[1000px]">
              {[
                'Pedido',
                'Cliente',
                'Tabela',
                'Itens',
                'Disponibilidade',
                'Valor',
                'Enviado',
                'Validade',
                '',
              ].map((t, i) => (
                <span
                  key={t || `c${String(i)}`}
                  className={juntar(
                    'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500',
                    (i === 3 || i === 5) && 'text-right',
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto lg:min-w-[1000px]">
              {visiveis.map((p) => (
                <LinhaPedido key={p.id} pedido={p} />
              ))}
            </div>
          </section>
        ) : null}

        {/*
          O aviso de notificação some quando elas existirem de verdade. Hoje
          a fila se atualiza sozinha a cada 30 s — dizer isso é honesto;
          prometer push que não existe não é.
        */}
        {visiveis.length > 0 ? (
          <Aviso tom="info">
            Esta fila se atualiza sozinha a cada 30 segundos. Notificação no aparelho ainda não
            existe.
          </Aviso>
        ) : null}
      </main>
    </>
  );
}

function LinhaPedido({ pedido }: { readonly pedido: Pedido }) {
  const falta = semSaldo(pedido);
  const vencido = venceu(pedido);
  const diferenca = Number(pedido.diferenca);
  const itens = pedido.itens.filter((i) => i.status !== 'REMOVIDO' && i.status !== 'CANCELADO');

  return (
    <Link
      to={`/pedidos/${pedido.id}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-3 no-underline last:border-0 hover:bg-neutral-25',
        'lg:grid lg:grid-cols-[92px_minmax(160px,1fr)_104px_54px_124px_104px_88px_92px_92px] lg:py-0',
        'lg:h-[62px]',
        // A linha inteira muda de fundo quando algo nela trava o pedido.
        (falta > 0 || vencido) && 'bg-[#fdfaf5] hover:bg-[#fcf6ec]',
      )}
    >
      <span className="order-1 font-mono text-[12.5px] font-medium text-neutral-600 lg:order-none">
        #{pedido.numero}
      </span>

      <div className="order-3 w-full min-w-0 lg:order-none lg:w-auto">
        <p className="truncate text-[13.5px] font-medium text-neutral-900">{pedido.cliente}</p>
        <p className="truncate text-[11.5px] text-neutral-400">{pedido.solicitante ?? '—'}</p>
      </div>

      <span className="order-4 text-[12.5px] text-neutral-600 lg:order-none">
        <span className="mr-1 text-[10.5px] uppercase text-neutral-400 lg:hidden">tabela</span>
        {pedido.tabelaPreco ?? '—'}
      </span>

      <span className="order-5 text-right font-mono text-[13px] text-neutral-900 lg:order-none">
        {itens.length}
        <span className="ml-1 font-sans text-[10.5px] text-neutral-400 lg:hidden">
          {itens.length === 1 ? 'item' : 'itens'}
        </span>
      </span>

      {/* Disponibilidade: a pergunta que decide se o pedido segue sozinho. */}
      <span className="order-2 lg:order-none">
        {falta > 0 ? (
          <span className="inline-flex h-[23px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-atencao-fundo)] px-2.5 text-[11.5px] font-semibold text-[var(--color-atencao)]">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 8v5" />
              <path d="M12 16.5v.01" />
            </svg>
            {falta} sem saldo
          </span>
        ) : (
          <span className="inline-flex h-[23px] items-center whitespace-nowrap rounded-full bg-[var(--color-sucesso-fundo)] px-2.5 text-[11.5px] font-semibold text-[var(--color-sucesso)]">
            Tudo disponível
          </span>
        )}
      </span>

      <span className="order-6 text-right lg:order-none">
        <span className="block whitespace-nowrap font-mono text-[13.5px] font-medium tabular-nums text-neutral-900">
          R$ {brl(pedido.valorConfirmado)}
        </span>
        {/* A diferença contra o enviado decide se precisa de aceite. */}
        {diferenca !== 0 ? (
          <span
            className={juntar(
              'block whitespace-nowrap font-mono text-[11px]',
              diferenca > 0 ? 'text-[var(--color-perigo)]' : 'text-[var(--color-sucesso)]',
            )}
          >
            {diferenca > 0 ? '+' : '−'} R$ {brl(Math.abs(diferenca))}
          </span>
        ) : null}
      </span>

      <span className="order-7 text-[12.5px] text-neutral-600 lg:order-none">
        {desde(pedido.enviadoEm)}
      </span>

      <span
        className={juntar(
          'order-8 text-[12.5px] lg:order-none',
          vencido ? 'font-semibold text-[var(--color-perigo)]' : 'text-neutral-600',
        )}
      >
        {pedido.validoAte
          ? vencido
            ? 'Vencido'
            : new Date(pedido.validoAte).toLocaleDateString('pt-BR')
          : '—'}
      </span>

      <span className="order-9 ml-auto flex items-center justify-end lg:order-none lg:ml-0">
        <span className="inline-flex h-8 items-center gap-1 rounded-md bg-primary-600 px-2.5 text-[12.5px] font-medium text-white">
          Conferir
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
            <path d="M5 12h13" />
            <path d="m13 6 6 6-6 6" />
          </svg>
        </span>
      </span>
    </Link>
  );
}
