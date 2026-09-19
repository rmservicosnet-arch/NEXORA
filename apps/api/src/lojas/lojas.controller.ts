import { Controller, Get, Inject, Param } from '@nestjs/common';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';

import { PrincipalAtual, EscopoLoja, Permissoes } from '../comum/decoradores';
import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

interface LojaResumo {
  readonly id: string;
  readonly nome: string;
  readonly codigo: string;
  readonly locais: number;
}

@Controller('lojas')
export class LojasController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Lojas da empresa.
   *
   * Note que não há `where: { tenantId }` em lugar nenhum. O escopo vem do
   * contexto aberto pelo interceptor e é aplicado pelo PostgreSQL. Esquecer
   * um filtro aqui não vaza nada — é a razão de o RLS existir.
   */
  @Get()
  async listar(@PrincipalAtual() principal: Principal): Promise<LojaResumo[]> {
    const lojas = await comEscopoAtual(this.prisma, async (tx) =>
      tx.loja.findMany({
        where: { status: 'ATIVO' },
        include: { _count: { select: { locais: true } } },
        orderBy: { nome: 'asc' },
      }),
    );

    // O RLS já garantiu a empresa. O vínculo de loja é outra pergunta, e a
    // resposta é esta: o usuário lista apenas as lojas às quais pertence.
    return lojas
      .filter((l) => principal.lojaIds.has(l.id))
      .map((l) => ({
        id: l.id,
        nome: l.nome,
        codigo: l.codigo,
        locais: l._count.locais,
      }));
  }

  /**
   * Resumo de uma loja.
   *
   * `@EscopoLoja` confere o vínculo; `@Permissoes` confere o direito. São
   * perguntas diferentes: *onde* e *o quê*.
   */
  @Get(':lojaId')
  @EscopoLoja('lojaId')
  @Permissoes('estoque.visualizar')
  async detalhar(@Param('lojaId') lojaId: string): Promise<LojaResumo | null> {
    const loja = await comEscopoAtual(this.prisma, async (tx) =>
      tx.loja.findUnique({
        where: { id: lojaId },
        include: { _count: { select: { locais: true } } },
      }),
    );

    if (!loja) {
      return null;
    }

    return {
      id: loja.id,
      nome: loja.nome,
      codigo: loja.codigo,
      locais: loja._count.locais,
    };
  }
}
