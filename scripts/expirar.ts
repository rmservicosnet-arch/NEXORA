/**
 * Expira reservas e pedidos vencidos.
 *
 *   npm run expirar
 *
 * Feito para rodar por cron (ou Agendador de Tarefas), de hora em hora. NAO e
 * um agendador dentro da API de proposito: com duas instancias no ar, um
 * `setInterval` em cada uma roda a rotina duas vezes, e as duas disputam as
 * mesmas linhas. Quem agenda e o sistema operacional, que sabe rodar uma vez.
 *
 * Isto arruma o DADO. A resposta ja esta certa sem ele: `disponivel()` ignora
 * reserva vencida ao calcular. Se esta rotina nunca rodar, o catalogo continua
 * correto — so a tabela fica com linhas ATIVA que deveriam estar EXPIRADA, e
 * as consultas ficam mais pesadas do que precisam.
 *
 * O que ele toca:
 *   - `estoque_reserva` ATIVA com `expira_em` no passado  -> EXPIRADA
 *   - `pedido` aguardando com `valido_ate` no passado     -> EXPIRADO
 *
 * O que ele NAO toca, nunca:
 *   - pedido ja confirmado, faturado, cancelado ou recusado;
 *   - `movimento_estoque` — reserva nao e movimentacao, e expirar uma tambem
 *     nao e. Nada se moveu, nada entra no razao.
 */

import { criarPrisma } from '../packages/db/src/client';
import { comEscopo } from '../packages/db/src/escopo';
import { contextoDeSistema } from '../packages/db/src/contexto';

/** Os unicos status em que um pedido ainda pode vencer sozinho. */
const AGUARDANDO = ['AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_ACEITE_CLIENTE'] as const;

async function main(): Promise<void> {
  const url = process.env['DIRECT_URL'];
  if (!url) {
    throw new Error('DIRECT_URL nao definida.');
  }

  const prisma = criarPrisma({ url, permitirPapelPrivilegiado: true });
  const agora = new Date();

  try {
    const cliente = await prisma;
    const tenants = await cliente.tenant.findMany({ select: { id: true, nome: true } });

    let totalReservas = 0;
    let totalPedidos = 0;

    for (const tenant of tenants) {
      await comEscopo(cliente, contextoDeSistema(tenant.id), async (tx) => {
        const reservas = await tx.estoqueReserva.updateMany({
          where: { status: 'ATIVA', expiraEm: { lt: agora } },
          data: { status: 'EXPIRADA' },
        });

        /**
         * O pedido vence DEPOIS da reserva, e a ordem importa.
         *
         * Vencer o pedido primeiro deixaria as reservas dele orfas: ATIVA,
         * ligadas a um pedido EXPIRADO, segurando estoque que ninguem mais
         * vai buscar.
         */
        const vencidos = await tx.pedido.findMany({
          where: {
            status: { in: [...AGUARDANDO] },
            validoAte: { lt: agora },
          },
          select: { id: true, numero: true, status: true },
        });

        for (const pedido of vencidos) {
          await tx.estoqueReserva.updateMany({
            where: { pedidoId: pedido.id, status: 'ATIVA' },
            data: { status: 'EXPIRADA' },
          });

          await tx.pedido.update({
            where: { id: pedido.id },
            data: { status: 'EXPIRADO' },
          });

          // `pedido_evento` e append-only e e a historia do pedido. Um pedido
          // que muda de status sem deixar linha aqui some da linha do tempo, e
          // o cliente ve o status mudar sem explicacao.
          await tx.pedidoEvento.create({
            data: {
              tenantId: tenant.id,
              pedidoId: pedido.id,
              deStatus: pedido.status,
              paraStatus: 'EXPIRADO',
              atorTipo: 'SISTEMA',
              motivo: 'Prazo de validade do pedido vencido.',
            },
          });
        }

        if (reservas.count > 0 || vencidos.length > 0) {
          console.log(
            `  ${tenant.nome}: ${reservas.count} reserva(s), ${vencidos.length} pedido(s)`,
          );
        }

        totalReservas += reservas.count;
        totalPedidos += vencidos.length;
      });
    }

    if (totalReservas === 0 && totalPedidos === 0) {
      console.log('  Nada vencido.');
    } else {
      console.log(`\n  ${totalReservas} reserva(s) e ${totalPedidos} pedido(s) expirados.`);
    }
  } finally {
    await (await prisma).$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
