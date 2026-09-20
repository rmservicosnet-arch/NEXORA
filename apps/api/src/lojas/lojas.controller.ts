import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  alteracaoLojaSchema,
  novaLojaSchema,
  PERM,
  type AlteracaoLoja,
  type LojaPainel,
  type NovaLoja,
} from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, exigirContexto, type PrismaClient } from '@estoque/db';

import { PrincipalAtual, EscopoLoja, Permissoes } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Deriva o codigo a partir do nome.
 *
 * "Loja Shopping" vira LOJA_SHOPPING. Acentos caem: o codigo e identificador
 * e vai aparecer em log, em `where` e em conversa de suporte.
 */
function codigoDe(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

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
   * Abre uma loja, com o local padrao de venda junto.
   *
   * O local nasce na mesma transacao de proposito: sem ele o PDV nao sabe de
   * onde baixar o estoque, e a loja ficaria cadastrada e sem vender. Criar um
   * e "depois lembrar de criar o local" e exatamente o passo que se esquece.
   *
   * Quem abre fica vinculado a ela. Sem isso a loja nasce invisivel para o
   * proprio autor — a lista mostra apenas as lojas as quais se tem vinculo, e
   * o efeito seria um botao que aparentemente nao faz nada.
   */
  @Post()
  @Permissoes(PERM.loja.criar)
  async criar(
    @Body(new ZodPipe(novaLojaSchema)) dados: NovaLoja,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ id: string }> {
    const codigo = dados.codigo ?? codigoDe(dados.nome);

    if (codigo.length < 2) {
      throw new ConflictException({
        codigo: 'CODIGO_INVALIDO',
        mensagem: 'O nome nao produz um codigo valido. Informe o codigo.',
      });
    }

    return comEscopoAtual(this.prisma, async (tx) => {
      const repetido = await tx.loja.findFirst({ where: { codigo }, select: { nome: true } });
      if (repetido) {
        throw new ConflictException({
          codigo: 'CODIGO_JA_EXISTE',
          mensagem: `O codigo ${codigo} ja e da loja ${repetido.nome}.`,
        });
      }

      const contexto = exigirContexto();

      const loja = await tx.loja.create({
        data: { tenantId: contexto.tenantId, nome: dados.nome, codigo },
        select: { id: true },
      });

      if (dados.compartilharCom) {
        // Estoque compartilhado: a loja nova nao ganha local proprio, ela
        // passa a vender do local de venda da outra. A mercadoria continua
        // onde esta — e essa e a diferenca para transferir.
        const emprestado = await tx.localEstoque.findFirst({
          where: { lojaId: dados.compartilharCom, padraoVenda: true, status: 'ATIVO' },
          select: { id: true },
        });

        if (!emprestado) {
          throw new ConflictException({
            codigo: 'LOJA_SEM_LOCAL_PADRAO',
            mensagem: 'A loja escolhida nao tem local padrao de venda para compartilhar.',
          });
        }

        await tx.localEstoqueLoja.create({
          data: {
            tenantId: contexto.tenantId,
            localId: emprestado.id,
            lojaId: loja.id,
            padraoVenda: true,
          },
        });
      } else {
        await tx.localEstoque.create({
          data: {
            tenantId: contexto.tenantId,
            lojaId: loja.id,
            nome: dados.localPadrao,
            codigo: codigoDe(dados.localPadrao).slice(0, 30),
            padraoVenda: true,
          },
        });
      }

      await tx.usuarioLojaAcesso.create({
        data: { tenantId: contexto.tenantId, lojaId: loja.id, usuarioId: principal.id },
      });

      return { id: loja.id };
    });
  }

  /**
   * Renomear ou desativar.
   *
   * Desativar nao apaga: venda, pedido e movimento antigos continuam
   * apontando para esta loja. Ela some do PDV e dos seletores, e o estoque
   * dela continua onde esta — inclusive para ser transferido.
   */
  @Patch(':lojaId')
  @Permissoes(PERM.loja.editar)
  async alterar(
    @Param('lojaId') lojaId: string,
    @Body(new ZodPipe(alteracaoLojaSchema)) dados: AlteracaoLoja,
  ): Promise<{ id: string }> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const loja = await tx.loja.findFirst({ where: { id: lojaId }, select: { id: true } });

      if (!loja) {
        throw new NotFoundException({
          codigo: 'LOJA_NAO_ENCONTRADA',
          mensagem: 'Loja nao encontrada.',
        });
      }

      await tx.loja.update({
        where: { id: lojaId },
        data: {
          ...(dados.nome ? { nome: dados.nome } : {}),
          ...(dados.status ? { status: dados.status } : {}),
        },
      });

      return { id: lojaId };
    });
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
          // Locais de OUTRAS lojas que esta tambem usa.
          locaisUsados: {
            where: { local: { status: 'ATIVO' } },
            orderBy: { padraoVenda: 'desc' },
            select: {
              padraoVenda: true,
              local: {
                select: {
                  id: true,
                  nome: true,
                  codigo: true,
                  loja: { select: { nome: true } },
                },
              },
            },
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
          const proprios = loja.locais.map((o) => ({
            id: o.id,
            nome: o.nome,
            codigo: o.codigo,
            padraoVenda: o.padraoVenda,
            compartilhado: false,
            dono: null as string | null,
          }));

          const emprestados = loja.locaisUsados.map((u) => ({
            id: u.local.id,
            nome: u.local.nome,
            codigo: u.local.codigo,
            padraoVenda: u.padraoVenda,
            compartilhado: true,
            dono: u.local.loja.nome,
          }));

          const todos = [...proprios, ...emprestados];

          // O saldo negativo e as contagens somam o que a loja VENDE — o
          // compartilhado entra, porque e de la que o PDV dela baixa.
          const idsDosLocais = todos.map((o) => o.id);

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
            locais: todos.map((o) => ({
              ...o,
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
