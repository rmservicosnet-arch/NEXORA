import { Inject, Injectable, Logger } from '@nestjs/common';
import { comEscopo, type Contexto, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

export interface RegistroAuditoria {
  readonly contexto: Contexto;
  readonly acao: string;
  readonly entidade: string;
  readonly entidadeId?: string;
  readonly atorNome?: string;
  readonly motivo?: string;
  readonly ip?: string;
  readonly antes?: unknown;
  readonly depois?: unknown;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Grava na trilha de auditoria.
   *
   * **Nunca derruba a operação que a chamou.** Se a auditoria falhar, o log
   * registra e a requisição segue. Perder uma linha de trilha é ruim;
   * impedir uma venda por causa dela é pior.
   */
  async registrar(registro: RegistroAuditoria): Promise<void> {
    try {
      await comEscopo(this.prisma, registro.contexto, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: registro.contexto.tenantId,
            atorTipo: registro.contexto.principalTipo,
            atorId: registro.contexto.principalId ?? null,
            atorNome: registro.atorNome ?? null,
            acao: registro.acao,
            entidade: registro.entidade,
            entidadeId: registro.entidadeId ?? null,
            motivo: registro.motivo?.slice(0, 400) ?? null,
            ip: registro.ip ?? null,
            antes: (registro.antes ?? null) as never,
            depois: (registro.depois ?? null) as never,
            correlacaoId: registro.contexto.correlacaoId ?? null,
          },
        });
      });
    } catch (erro) {
      this.logger.error(
        `Falha ao gravar auditoria de "${registro.acao}": ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }
}
