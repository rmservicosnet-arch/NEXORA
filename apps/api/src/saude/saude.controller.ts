import { Controller, Get, Inject } from '@nestjs/common';
import type { PrismaClient } from '@estoque/db';

import { Publico } from '../comum/decoradores';
import { PRISMA } from '../infra/prisma/prisma.module';

interface RespostaSaude {
  readonly situacao: 'ok' | 'degradado';
  readonly banco: 'ok' | 'indisponivel';
  readonly em: string;
}

/**
 * Sonda de saúde.
 *
 * Rota pública de propósito: um balanceador precisa consultá-la sem
 * credencial. Por isso ela não revela nada — nem versão, nem nome de host,
 * nem contagem de registros.
 */
@Controller('saude')
export class SaudeController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Publico()
  @Get()
  async verificar(): Promise<RespostaSaude> {
    let banco: RespostaSaude['banco'] = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      banco = 'indisponivel';
    }

    return {
      situacao: banco === 'ok' ? 'ok' : 'degradado',
      banco,
      em: new Date().toISOString(),
    };
  }
}
