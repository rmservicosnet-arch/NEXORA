/**
 * Reconstroi o troco de vendas fechadas antes de o campo passar a ser gravado.
 *
 *   npm run corrigir:troco -- --aplicar
 *
 * Sem `--aplicar` ele so MOSTRA o que faria. Rodar duas vezes nao faz efeito
 * duas vezes: a segunda execucao nao encontra mais divergencia.
 *
 * ## O que aconteceu
 *
 * `venda.troco` nasceu na migracao do caixa. As vendas fechadas entre o
 * deploy do schema e o da aplicacao gravaram `0.00` por default enquanto o
 * PDV ja mostrava o troco na tela para o operador. O resultado e uma venda em
 * que o cliente entregou R$ 100,00 por R$ 87,50 de mercadoria e o sistema
 * afirma que nada voltou — R$ 12,50 que o relatorio de formas de pagamento
 * contaria como dinheiro na gaveta.
 *
 * A reconstrucao e `pago - total`, que e exatamente a conta que o PDV fez e
 * exibiu na hora. Nao e adivinhacao: e o numero que o operador leu.
 *
 * ## O que ele NAO toca
 *
 * - Venda ligada a um CAIXA. O fechamento ja calculou `valorEsperado` com o
 *   troco que existia; mudar o troco agora faria a conferencia assinada
 *   deixar de bater com uma recontagem. Essas ficam listadas e intocadas.
 * - Venda em que a sobra nao foi paga em DINHEIRO. So dinheiro devolve troco;
 *   sobra em cartao ou PIX e erro de digitacao, e erro de digitacao nao se
 *   conserta adivinhando.
 * - `venda_pagamento`, `movimento_estoque` e qualquer razao. O que o cliente
 *   entregou continua gravado como foi.
 *
 * Cada correcao deixa uma linha em `audit_log`. Corrigir dinheiro em silencio
 * seria trocar uma inconsistencia visivel por uma invisivel.
 */

import { dec } from '../packages/core/src/index';
import { criarPrisma } from '../packages/db/src/client';
import { contextoDeSistema } from '../packages/db/src/contexto';
import { comEscopo } from '../packages/db/src/escopo';

/** A acao gravada na trilha. Estavel: relatorio de auditoria le por ela. */
const ACAO = 'VENDA_TROCO_RECONSTRUIDO';

interface Divergente {
  readonly id: string;
  readonly numero: number;
  readonly total: string;
  readonly troco: string;
  readonly pago: string;
  readonly em_dinheiro: string;
  readonly tem_caixa: boolean;
}

async function main(): Promise<void> {
  const url = process.env['DIRECT_URL'];
  if (!url) {
    throw new Error('DIRECT_URL nao definida.');
  }

  const aplicar = process.argv.includes('--aplicar');
  const prisma = criarPrisma({ url, permitirPapelPrivilegiado: true });

  try {
    const cliente = await prisma;
    const tenants = await cliente.tenant.findMany({ select: { id: true, nome: true } });

    let candidatas = 0;
    let corrigidas = 0;
    let recusadas = 0;

    for (const tenant of tenants) {
      await comEscopo(cliente, contextoDeSistema(tenant.id), async (tx) => {
        const divergentes = await tx.$queryRawUnsafe<Divergente[]>(`
          SELECT v.id,
                 v.numero,
                 v.total::text,
                 v.troco::text,
                 p.pago::text,
                 coalesce(p.em_dinheiro, 0)::text AS em_dinheiro,
                 (v.caixa_id IS NOT NULL) AS tem_caixa
            FROM venda v
            JOIN (
              SELECT venda_id,
                     sum(valor) AS pago,
                     sum(valor) FILTER (WHERE forma = 'DINHEIRO') AS em_dinheiro
                FROM venda_pagamento
               GROUP BY venda_id
            ) p ON p.venda_id = v.id
           WHERE v.status = 'CONCLUIDA'
             AND p.pago <> v.total + v.troco
           ORDER BY v.numero
        `);

        for (const d of divergentes) {
          const sobra = dec(d.pago).minus(dec(d.total)).minus(dec(d.troco));
          const emDinheiro = dec(d.em_dinheiro);

          const motivoRecusa = d.tem_caixa
            ? 'ligada a um caixa ja conferido'
            : sobra.lessThanOrEqualTo(0)
              ? 'a diferenca nao e sobra de pagamento'
              : sobra.greaterThan(emDinheiro)
                ? 'a sobra nao foi paga em dinheiro'
                : null;

          if (motivoRecusa !== null) {
            recusadas += 1;
            console.log(`  #${String(d.numero)} intocada — ${motivoRecusa}`);
            continue;
          }

          candidatas += 1;
          const novo = dec(d.troco).plus(sobra);
          console.log(
            `  #${String(d.numero)}: pago ${d.pago} por ${d.total} · ` +
              `troco ${d.troco} -> ${novo.toFixed(2)}`,
          );

          if (!aplicar) {
            continue;
          }

          await tx.venda.update({
            where: { id: d.id },
            data: { troco: novo.toFixed(2) },
          });

          // Dinheiro nao se conserta em silencio.
          await tx.auditLog.create({
            data: {
              tenantId: tenant.id,
              atorTipo: 'SISTEMA',
              acao: ACAO,
              entidade: 'venda',
              entidadeId: d.id,
              motivo:
                'Venda fechada antes de a aplicacao passar a gravar o troco: ' +
                'reconstruido como pago menos total.',
              antes: { troco: d.troco },
              depois: { troco: novo.toFixed(2), pago: d.pago, total: d.total },
            },
          });

          corrigidas += 1;
        }
      });
    }

    if (candidatas === 0 && recusadas === 0) {
      console.log('  Nada divergente: pago = total + troco em todas as vendas.');
    } else if (aplicar) {
      console.log(`\n  ${String(corrigidas)} corrigida(s), ${String(recusadas)} intocada(s).`);
    } else {
      console.log(
        `\n  Simulacao: ${String(candidatas)} a corrigir, ${String(recusadas)} intocada(s). ` +
          'Rode com --aplicar para gravar.',
      );
    }
  } finally {
    await (await prisma).$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
