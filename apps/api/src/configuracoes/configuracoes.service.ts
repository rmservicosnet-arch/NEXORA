import { Inject, Injectable } from '@nestjs/common';
import type { AlteracaoConfiguracao, ConfiguracaoEmpresa } from '@estoque/contracts';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Campos que existem, são graváveis, e que NENHUM código consulta.
 *
 * `momentoCobranca`: a cobrança é sempre no faturamento (docs/ORDERS.md).
 * `pushDetalhado`: não há envio de notificação nenhum (docs/NOTIFICATIONS.md).
 *
 * A lista vai na resposta para a tela desabilitá-los. Oferecer uma chave que
 * não faz nada é pior do que não oferecer: a pessoa configura, confia, e o
 * comportamento não muda — e ela só descobre quando o dinheiro não bate.
 */
const SEM_EFEITO = ['momentoCobranca', 'pushDetalhado'] as const;

@Injectable()
export class ConfiguracoesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async ver(principal: Principal): Promise<ConfiguracaoEmpresa> {
    return comEscopoAtual(this.prisma, async (tx) => {
      /**
       * A linha pode não existir: o tenant é criado noutro fluxo e a
       * configuração tem default em toda coluna. Criar na leitura é o que
       * evita a tela de configuração morrer numa empresa nova.
       */
      const atual =
        (await tx.tenantConfiguracao.findUnique({ where: { tenantId: principal.tenantId } })) ??
        (await tx.tenantConfiguracao.create({ data: { tenantId: principal.tenantId } }));

      return this.paraContrato(atual);
    });
  }

  async alterar(dados: AlteracaoConfiguracao, principal: Principal): Promise<ConfiguracaoEmpresa> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const alterada = await tx.tenantConfiguracao.upsert({
        where: { tenantId: principal.tenantId },
        create: { tenantId: principal.tenantId, ...dados },
        update: dados,
      });

      return this.paraContrato(alterada);
    });
  }

  private paraContrato(c: {
    modoCheckout: string;
    momentoCobranca: string;
    validadePedidoHoras: number;
    prazoReservaHoras: number;
    permitirSaldoNegativo: boolean;
    exigirAceiteAumento: boolean;
    modoCaixa: string;
    pushDetalhado: boolean;
    fusoHorario: string;
    moeda: string;
    alteradoEm: Date;
  }): ConfiguracaoEmpresa {
    return {
      modoCheckout:
        c.modoCheckout === 'PAGAMENTO_IMEDIATO' ? 'PAGAMENTO_IMEDIATO' : 'PEDIDO_COM_CONFIRMACAO',
      momentoCobranca: c.momentoCobranca === 'NA_CONFIRMACAO' ? 'NA_CONFIRMACAO' : 'NO_FATURAMENTO',
      validadePedidoHoras: c.validadePedidoHoras,
      prazoReservaHoras: c.prazoReservaHoras,
      permitirSaldoNegativo: c.permitirSaldoNegativo,
      exigirAceiteAumento: c.exigirAceiteAumento,
      modoCaixa:
        c.modoCaixa === 'COMPARTILHADO_POR_LOJA' ? 'COMPARTILHADO_POR_LOJA' : 'POR_OPERADOR',
      pushDetalhado: c.pushDetalhado,
      fusoHorario: c.fusoHorario,
      moeda: c.moeda,
      alteradoEm: c.alteradoEm.toISOString(),
      semEfeito: [...SEM_EFEITO],
    };
  }
}
