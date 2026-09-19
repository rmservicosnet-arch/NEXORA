import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AlteracaoPrecos, PrecosDoProduto } from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, exigirContexto, type PrismaClient } from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Precos por tabela.
 *
 * O cadastro de produto define so o preco da tabela PADRAO. Sem uma forma de
 * preencher as demais, um cliente vinculado a tabela Professor simplesmente
 * nao enxerga o produto: sem preco na tabela dele, o item nao existe para ele.
 * Era um buraco — o catalogo do portal ficava vazio para metade dos clientes.
 */
@Injectable()
export class PrecosService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  async doProduto(produtoId: string): Promise<PrecosDoProduto> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const produto = await tx.produto.findFirst({
        where: { id: produtoId },
        include: {
          variacoes: {
            orderBy: { sku: 'asc' },
            include: { precos: { select: { tabelaPrecoId: true, preco: true } } },
          },
        },
      });

      if (!produto) {
        throw new NotFoundException({
          codigo: 'PRODUTO_NAO_ENCONTRADO',
          mensagem: 'Produto nao encontrado.',
        });
      }

      const tabelas = await tx.tabelaPreco.findMany({
        where: { status: 'ATIVO' },
        orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
        select: { id: true, nome: true, chave: true, padrao: true },
      });

      return {
        produtoId: produto.id,
        nome: produto.nome,
        variacoes: produto.variacoes.map((v) => ({
          variacaoId: v.id,
          sku: v.sku,
          descricao: v.descricao,
          // Toda tabela aparece, mesmo sem preco. `null` e a informacao que
          // importa: e exatamente onde o cliente daquela tabela nao ve o item.
          precos: tabelas.map((t) => {
            const preco = v.precos.find((p) => p.tabelaPrecoId === t.id);
            return {
              tabelaPrecoId: t.id,
              tabela: t.nome,
              chave: t.chave,
              padrao: t.padrao,
              preco: preco ? dec(preco.preco.toString()).toFixed(2) : null,
            };
          }),
        })),
      };
    });
  }

  /**
   * Grava precos, registrando o historico.
   *
   * `preco_historico` e append-only: mudanca de preco nao apaga o anterior.
   * Uma venda antiga continua explicavel — "por que este item saiu a 380?" tem
   * resposta.
   */
  async alterar(
    produtoId: string,
    dados: AlteracaoPrecos,
    principal: Principal,
  ): Promise<PrecosDoProduto> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      for (const linha of dados.precos) {
        const variacao = await tx.variacao.findFirst({
          where: { id: linha.variacaoId, produtoId },
          select: { id: true },
        });

        if (!variacao) {
          throw new NotFoundException({
            codigo: 'VARIACAO_NAO_ENCONTRADA',
            mensagem: 'Uma das variacoes nao pertence a este produto.',
          });
        }

        const atual = await tx.precoItem.findFirst({
          where: { tabelaPrecoId: linha.tabelaPrecoId, variacaoId: linha.variacaoId },
        });

        if (linha.preco === null) {
          if (atual) {
            await tx.precoItem.delete({ where: { id: atual.id } });
          }
          continue;
        }

        const novo = dec(linha.preco);

        if (atual) {
          await tx.precoItem.update({
            where: { id: atual.id },
            data: { preco: novo.toFixed(2) },
          });

          await tx.precoHistorico.create({
            data: {
              tenantId: contexto.tenantId,
              precoItemId: atual.id,
              precoAnterior: dec(atual.preco.toString()).toFixed(2),
              precoNovo: novo.toFixed(2),
              alteradoPorId: principal.id,
            },
          });
        } else {
          const criado = await tx.precoItem.create({
            data: {
              tenantId: contexto.tenantId,
              tabelaPrecoId: linha.tabelaPrecoId,
              variacaoId: linha.variacaoId,
              preco: novo.toFixed(2),
            },
          });

          await tx.precoHistorico.create({
            data: {
              tenantId: contexto.tenantId,
              precoItemId: criado.id,
              precoNovo: novo.toFixed(2),
              alteradoPorId: principal.id,
            },
          });
        }
      }
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'PRECOS_ALTERADOS',
      entidade: 'produto',
      entidadeId: produtoId,
      atorNome: principal.nome,
      depois: { linhas: dados.precos.length },
    });

    return this.doProduto(produtoId);
  }
}
