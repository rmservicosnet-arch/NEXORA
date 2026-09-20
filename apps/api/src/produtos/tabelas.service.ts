import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AlteracaoTabelaPreco, NovaTabelaPreco, TabelaPreco } from '@estoque/contracts';
import { comEscopoAtual, type ClienteEmTransacao, type PrismaClient } from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Deriva a chave a partir do nome.
 *
 * "Revendedor Atacado" → REVENDEDOR_ATACADO. Acentos caem, porque a chave é
 * identificador e vai aparecer em log, em `where` e em conversa de suporte.
 */
function chaveDe(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * As tabelas de preço.
 *
 * Existiam só no seed: quatro, fixas, sem como criar a quinta nem aposentar
 * nenhuma. Toda a política de "quem paga quanto" dependia de uma lista que a
 * aplicação não sabia editar.
 */
@Injectable()
export class TabelasService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async listar(): Promise<TabelaPreco[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.tabelaPreco.findMany({
        orderBy: [{ padrao: 'desc' }, { status: 'asc' }, { nome: 'asc' }],
        include: { _count: { select: { precos: true, clientes: true } } },
      });

      return linhas.map((t) => this.paraContrato(t));
    });
  }

  async criar(dados: NovaTabelaPreco, principal: Principal): Promise<{ id: string }> {
    const chave = dados.chave ?? chaveDe(dados.nome);

    if (chave.length < 2) {
      throw new ConflictException({
        codigo: 'CHAVE_INVALIDA',
        mensagem: 'O nome não produz uma chave válida. Informe a chave.',
      });
    }

    return comEscopoAtual(this.prisma, async (tx) => {
      const repetida = await tx.tabelaPreco.findFirst({ where: { chave } });
      if (repetida) {
        throw new ConflictException({
          codigo: 'CHAVE_JA_EXISTE',
          mensagem: `Já existe uma tabela com a chave ${chave}: ${repetida.nome}.`,
        });
      }

      // Nasce ATIVA e VAZIA — e vazia significa catálogo vazio para quem for
      // vinculado a ela. A tela avisa; aqui não se inventa preço nenhum.
      const criada = await tx.tabelaPreco.create({
        data: { tenantId: principal.tenantId, nome: dados.nome, chave, padrao: false },
        select: { id: true },
      });

      return criada;
    });
  }

  async alterar(id: string, dados: AlteracaoTabelaPreco): Promise<{ id: string }> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const atual = await this.exigir(tx, id);

      if (dados.status === 'INATIVO') {
        await this.conferirAposentadoria(tx, atual);
      }

      if (dados.padrao) {
        /**
         * Padrão é um só.
         *
         * Rebaixar a anterior na MESMA transação: duas padrão ao mesmo tempo
         * fariam `findFirst({ padrao: true })` — que é como o resto do
         * sistema a encontra — devolver qualquer uma das duas, e a resposta
         * mudaria de requisição para requisição.
         */
        await tx.tabelaPreco.updateMany({ where: { padrao: true }, data: { padrao: false } });
      }

      await tx.tabelaPreco.update({
        where: { id },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.status !== undefined ? { status: dados.status } : {}),
          ...(dados.padrao ? { padrao: true, status: 'ATIVO' as const } : {}),
        },
      });

      return { id };
    });
  }

  /**
   * Aposentar tabela em uso deixa gente sem catálogo.
   *
   * O vínculo do cliente continua apontando para ela, e o catálogo lê
   * `cliente.tabelaPrecoId` sem conferir status — então o cliente não veria
   * erro nenhum, veria uma loja vazia. Recusar dizendo QUANTOS são é mais
   * útil do que deixar acontecer e esperar o telefonema.
   */
  private async conferirAposentadoria(
    tx: ClienteEmTransacao,
    tabela: { id: string; padrao: boolean; nome: string },
  ): Promise<void> {
    if (tabela.padrao) {
      throw new ConflictException({
        codigo: 'TABELA_PADRAO_NAO_INATIVA',
        mensagem: 'A tabela padrão não pode ser desativada. Promova outra primeiro.',
      });
    }

    const clientes = await tx.cliente.count({
      where: { tabelaPrecoId: tabela.id, status: 'ATIVO' },
    });

    if (clientes > 0) {
      throw new ConflictException({
        codigo: 'TABELA_EM_USO',
        mensagem:
          `${String(clientes)} ${clientes === 1 ? 'cadastro usa' : 'cadastros usam'} ` +
          `a tabela ${tabela.nome}. Mova ${clientes === 1 ? 'ele' : 'eles'} antes de desativar.`,
      });
    }
  }

  private async exigir(
    tx: ClienteEmTransacao,
    id: string,
  ): Promise<{ id: string; padrao: boolean; nome: string }> {
    const tabela = await tx.tabelaPreco.findUnique({
      where: { id },
      select: { id: true, padrao: true, nome: true },
    });

    if (!tabela) {
      throw new NotFoundException({
        codigo: 'TABELA_NAO_ENCONTRADA',
        mensagem: 'Tabela de preço não encontrada.',
      });
    }

    return tabela;
  }

  private paraContrato(t: {
    id: string;
    nome: string;
    chave: string;
    padrao: boolean;
    status: string;
    criadoEm: Date;
    _count: { precos: number; clientes: number };
  }): TabelaPreco {
    return {
      id: t.id,
      nome: t.nome,
      chave: t.chave,
      padrao: t.padrao,
      status: t.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      itensComPreco: t._count.precos,
      clientes: t._count.clientes,
      criadoEm: t.criadoEm.toISOString(),
    };
  }
}
