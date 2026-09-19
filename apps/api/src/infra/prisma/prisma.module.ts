import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { criarPrisma, type PrismaClient } from '@estoque/db';

import type { Ambiente } from '../../configuracao';

/**
 * Token do cliente Prisma **com escopo obrigatório**.
 *
 * Quem recebe este cliente não deve consultá-lo direto: toda leitura e
 * escrita de dado de empresa passa por `comEscopo`, que abre a transação e
 * define `app.tenant_id`. Ver docs/TENANCY.md §2.
 */
export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Ambiente, true>): Promise<PrismaClient> => {
        // `criarPrisma` recusa conectar com papel privilegiado. Se alguém
        // apontar DATABASE_URL para o usuário de migração, a aplicação não
        // sobe — em vez de subir sem isolamento.
        const ambiente = config.get('NODE_ENV', { infer: true });

        return criarPrisma({
          url: config.get('DATABASE_URL', { infer: true }),
          registrarConsultas: ambiente === 'development',
          maxConexoes: config.get('DATABASE_POOL_MAX', { infer: true }) ?? (ambiente === 'test' ? 4 : 10),
        });
      },
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
