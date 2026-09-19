import type { PaginaPedidos, StatusPedido } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';

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
  AGUARDANDO_ACEITE_CLIENTE: 'bg-[--color-atencao-fundo] text-[--color-atencao]',
  CONFIRMADO: 'bg-[--color-sucesso-fundo] text-[--color-sucesso]',
  CONFIRMADO_PARCIALMENTE: 'bg-[--color-atencao-fundo] text-[--color-atencao]',
  DEVOLVIDO: 'bg-[--color-perigo-fundo] text-[--color-perigo]',
  RECUSADO: 'bg-[--color-perigo-fundo] text-[--color-perigo]',
  FATURADO: 'bg-[--color-sucesso-fundo] text-[--color-sucesso]',
  CONCLUIDO: 'bg-[--color-sucesso-fundo] text-[--color-sucesso]',
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

export function PortalMeusPedidos() {
  const navegar = useNavigate();
  const local = useLocation();
  const mensagem = (local.state as { mensagem?: string } | null)?.mensagem ?? null;

  const consulta = useQuery({
    queryKey: ['portal', 'pedidos'],
    queryFn: () => pedir<PaginaPedidos>('/portal/pedidos?limite=40'),
  });

  return (
    <>
      <h1 className="font-display text-[22px] font-bold text-neutral-900">Meus pedidos</h1>

      {mensagem ? <Aviso tom="sucesso">{mensagem}</Aviso> : null}

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
          titulo="Nenhum pedido ainda"
          descricao="Quando você enviar um pedido, ele aparece aqui com o andamento."
          acao={
            <Botao variante="primario" onClick={() => void navegar('/portal')}>
              Ver catálogo
            </Botao>
          }
        />
      ) : null}

      {consulta.data && consulta.data.itens.length > 0 ? (
        <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {consulta.data.itens.map((pedido) => {
            const enviado = pedido.enviadoEm ? new Date(pedido.enviadoEm) : null;
            const precisaDeVoce = pedido.status === 'AGUARDANDO_ACEITE_CLIENTE';

            return (
              <Link
                key={pedido.id}
                to={`/portal/pedidos/${pedido.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-3 no-underline last:border-0 hover:bg-neutral-25"
              >
                <span className="order-1 font-mono text-[13px] font-medium text-neutral-600">
                  #{pedido.numero}
                </span>

                <span className="order-2 mr-auto">
                  <SeloStatusCliente status={pedido.status} />
                </span>

                <span className="order-3 w-full text-[12px] text-neutral-500 sm:order-none sm:w-auto">
                  {enviado
                    ? `${enviado.toLocaleDateString('pt-BR')} · ${String(pedido.itens.length)} ${pedido.itens.length === 1 ? 'item' : 'itens'}`
                    : `${String(pedido.itens.length)} itens`}
                </span>

                <span className="order-4 ml-auto text-right font-mono text-[13.5px] font-semibold text-neutral-900 sm:order-none">
                  R$ {brl(pedido.valorConfirmado)}
                </span>

                {precisaDeVoce ? (
                  <span className="order-5 w-full text-[12px] font-medium text-[--color-atencao]">
                    A loja alterou o pedido — toque para ver e decidir.
                  </span>
                ) : null}
              </Link>
            );
          })}
        </section>
      ) : null}
    </>
  );
}
