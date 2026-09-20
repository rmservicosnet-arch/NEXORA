import { Controller, Get, Inject, Param } from '@nestjs/common';
import { PERM, type LojaPainel } from '@estoque/contracts';
import { dec } from '@estoque/core';
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
   * As lojas com o que a tela de cadastro precisa mostrar.
   *
   * Separado de `listar()` de proposito: o seletor do PDV e o da visao geral
   * pedem a lista dezenas de vezes por sessao e nao usam nada disto. Juntar
   * faria cada abertura de PDV contar saldo negativo de tres lojas.
   */
  @Get('painel')
  @Permissoes(PERM.estoque.visualizar)
  async painel(@PrincipalAtual() principal: Principal): Promise<LojaPainel[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const lojas = await tx.loja.findMany({
        orderBy: [{ status: 'asc' }, { nome: 'asc' }],
        include: {
          locais: {
            where: { status: 'ATIVO' },
            orderBy: [{ padraoVenda: 'desc' }, { nome: 'asc' }],
            select: { id: true, nome: true, codigo: true, padraoVenda: true },
          },
        },
      });

      const minhas = lojas.filter((l) => principal.lojaIds.has(l.id));

      // O dia comeca no fuso da loja, nao no do servidor: uma venda das 21h
      // em Sao Paulo cairia no dia seguinte se contada em UTC.
      const inicioDoDia = await tx.$queryRaw<{ inicio: Date }[]>`
        SELECT (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                AT TIME ZONE 'America/Sao_Paulo') AS inicio`;
      const desde = inicioDoDia[0]?.inicio ?? new Date();

      return Promise.all(
        minhas.map(async (loja) => {
          const idsDosLocais = loja.locais.map((o) => o.id);

          const [caixa, vendas, negativos, porLocal] = await Promise.all([
            tx.caixa.findFirst({
              where: { lojaId: loja.id, status: 'ABERTO' },
              select: { numero: true },
            }),
            tx.venda.aggregate({
              where: { lojaId: loja.id, status: 'CONCLUIDA', concluidaEm: { gte: desde } },
              _sum: { total: true },
            }),
            tx.saldoEstoque.count({
              where: { localId: { in: idsDosLocais }, quantidade: { lt: 0 } },
            }),
            tx.saldoEstoque.groupBy({
              by: ['localId'],
              where: { localId: { in: idsDosLocais }, quantidade: { not: 0 } },
              _count: { _all: true },
            }),
          ]);

          return {
            id: loja.id,
            nome: loja.nome,
            codigo: loja.codigo,
            status: loja.status === 'INATIVO' ? ('INATIVO' as const) : ('ATIVO' as const),
            locais: loja.locais.map((o) => ({
              id: o.id,
              nome: o.nome,
              codigo: o.codigo,
              padraoVenda: o.padraoVenda,
              itens: porLocal.find((g) => g.localId === o.id)?._count._all ?? 0,
            })),
            caixaAberto: caixa?.numero ?? null,
            vendasHoje: dec((vendas._sum.total ?? 0).toString()).toFixed(2),
            variacoesNegativas: negativos,
          };
        }),
      );
    });
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
