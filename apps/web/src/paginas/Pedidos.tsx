import type { PaginaPedidos, Pedido, StatusPedido } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

export const ROTULO_STATUS: Record<StatusPedido, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_CONFIRMACAO: 'Aguardando confirmação',
  AGUARDANDO_ACEITE_CLIENTE: 'Aguardando o cliente',
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
 * caminho feliz andando. Cinza = encerrado. Quem abre a fila precisa ver onde
 * agir antes de ler qualquer palavra.
 */
const TOM_STATUS: Record<StatusPedido, string> = {
  RASCUNHO: 'bg-neutral-50 text-neutral-500',
  AGUARDANDO_CONFIRMACAO: 'bg-[--color-atencao-fundo] text-[--color-atencao]',
  AGUARDANDO_ACEITE_CLIENTE: 'bg-primary-50 text-primary-700',
  CONFIRMADO: 'bg-[--color-sucesso-fundo] text-[--color-sucesso]',
  CONFIRMADO_PARCIALMENTE: 'bg-[--color-sucesso-fundo] text-[--color-sucesso]',
  DEVOLVIDO: 'bg-primary-50 text-primary-700',
  RECUSADO: 'bg-[--color-perigo-fundo] text-[--color-perigo]',
  FATURADO: 'bg-neutral-100 text-neutral-700',
  CONCLUIDO: 'bg-neutral-50 text-neutral-500',
  CANCELADO: 'bg-neutral-50 text-neutral-500',
  EXPIRADO: 'bg-neutral-50 text-neutral-500',
};

export function SeloStatus({ status }: { readonly status: StatusPedido }) {
  return (
    <span
      className={juntar(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
        TOM_STATUS[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {ROTULO_STATUS[status]}
    </span>
  );
}

const FILTROS = [
  { chave: 'fila', rotulo: 'Fila', params: 'apenasFila=true' },
  { chave: 'aguardando', rotulo: 'A confirmar', params: 'status=AGUARDANDO_CONFIRMACAO' },
  { chave: 'cliente', rotulo: 'Com o cliente', params: 'status=AGUARDANDO_ACEITE_CLIENTE' },
  { chave: 'confirmados', rotulo: 'A faturar', params: 'status=CONFIRMADO' },
  { chave: 'todos', rotulo: 'Todos', params: '' },
];

export function Pedidos() {
  const [filtro, setFiltro] = useState('fila');

  const parametros = new URLSearchParams(FILTROS.find((f) => f.chave === filtro)?.params ?? '');
  parametros.set('limite', '50');

  const consulta = useQuery({
    queryKey: ['pedidos', filtro],
    queryFn: () => pedir<PaginaPedidos>(`/pedidos?${parametros.toString()}`),
    placeholderData: keepPreviousData,
    // A fila é uma tela de trabalho: fica aberta e precisa refletir o que os
    // colegas confirmaram sem ninguém apertar F5.
    refetchInterval: 30_000,
  });

  const itens = consulta.data?.itens ?? [];

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Pedidos</span>
        <div className="flex-1" />
        {consulta.data ? (
          <span className="text-[13px] text-neutral-500">
            <strong className="font-semibold text-[--color-atencao]">{consulta.data.naFila}</strong>{' '}
            aguardando a equipe
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Fila de pedidos
          </h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            Pedido em espera não reserva estoque. A reserva nasce quando você confirma.
          </p>
        </div>

        <div role="group" aria-label="Filtrar pedidos" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              aria-pressed={filtro === f.chave}
              onClick={() => setFiltro(f.chave)}
              className={juntar(
                'h-[35px] rounded-full border px-3 text-[12.5px] font-medium',
                filtro === f.chave
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-neutral-200 bg-white text-neutral-700',
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {consulta.isPending ? <EstadoCarregando titulo="Carregando pedidos…" /> : null}

          {consulta.isError ? (
            <EstadoErro
              titulo="Não foi possível carregar a fila"
              descricao={
                consulta.error instanceof ErroRequisicao
                  ? consulta.error.corpo.mensagem
                  : 'Verifique se a API está no ar.'
              }
              aoTentarNovamente={() => void consulta.refetch()}
            />
          ) : null}

          {consulta.isSuccess && itens.length === 0 ? (
            <EstadoVazio
              titulo={filtro === 'fila' ? 'Nada na fila' : 'Nenhum pedido'}
              descricao={
                filtro === 'fila'
                  ? 'Quando um cliente enviar um carrinho, ele aparece aqui.'
                  : 'Nenhum pedido neste filtro.'
              }
            />
          ) : null}

          {itens.length > 0 ? (
            <div className="min-h-0 flex-1 overflow-auto">
              {itens.map((p) => (
                <LinhaPedido key={p.id} pedido={p} />
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}

function LinhaPedido({ pedido }: { readonly pedido: Pedido }) {
  const enviado = pedido.enviadoEm ? new Date(pedido.enviadoEm) : null;
  const diferenca = Number(pedido.diferenca);
  const devolvidos = pedido.itens.filter((i) => i.status === 'DEVOLVIDO').length;

  return (
    // No celular a linha empilha: número e status em cima, cliente no meio,
    // valor e itens embaixo. A grade fixa soma mais que a largura do telefone,
    // e o que sumia era justamente o nome do cliente.
    <Link
      to={`/pedidos/${pedido.id}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-50 px-4 py-3 no-underline hover:bg-neutral-25',
        'sm:grid sm:grid-cols-[70px_minmax(0,1fr)_180px_130px_120px] sm:gap-3',
      )}
    >
      <span className="order-1 font-mono text-[13px] font-medium text-neutral-600 sm:order-none">
        #{pedido.numero}
      </span>

      <div className="order-3 w-full min-w-0 sm:order-none sm:w-auto">
        <p className="truncate text-[13.5px] font-medium text-neutral-900">{pedido.cliente}</p>
        <p className="truncate text-[11.5px] text-neutral-400">
          {pedido.solicitante ?? '—'}
          {enviado
            ? ` · ${enviado.toLocaleDateString('pt-BR')} ${enviado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </p>
      </div>

      <span className="order-2 mr-auto sm:order-none sm:mr-0">
        <SeloStatus status={pedido.status} />
      </span>

      <span className="order-4 text-left sm:order-none sm:text-right">
        <span className="block font-mono text-[13.5px] font-semibold text-neutral-900">
          R$ {Number(pedido.valorConfirmado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        {/* A diferença contra o que o cliente enviou é o que decide se o
            pedido pode seguir sozinho. Mostrar só o total esconderia isso. */}
        {diferenca !== 0 ? (
          <span
            className={juntar(
              'block font-mono text-[11px]',
              diferenca > 0 ? 'text-[--color-perigo]' : 'text-[--color-sucesso]',
            )}
          >
            {diferenca > 0 ? '+' : '−'} R${' '}
            {Math.abs(diferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        ) : null}
      </span>

      <span className="order-5 ml-auto text-right text-[12px] text-neutral-500 sm:order-none sm:ml-0">
        {pedido.itens.length} {pedido.itens.length === 1 ? 'item' : 'itens'}
        {devolvidos > 0 ? (
          <span className="block text-[11px] font-medium text-[--color-perigo]">
            {devolvidos} devolvido{devolvidos === 1 ? '' : 's'}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
