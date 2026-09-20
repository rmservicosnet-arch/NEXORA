import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AlteracaoCliente,
  type ApoioCliente,
  type Cliente,
  type FiltroClientes,
  type ModoCheckout,
  type NovoCliente,
  type PaginaClientes,
} from '@estoque/contracts';
import { dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * O cadastro de cliente.
 *
 * Este módulo existia no banco e no portal, mas não na API: dava para *usar*
 * a tabela de preço de um cliente e não dava para *atribuí-la*. Um cadastro
 * novo nascia sem tabela, e sem tabela o portal mostra catálogo vazio — o
 * item sem preço na tabela dele simplesmente não existe para ele.
 */
@Injectable()
export class ClientesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async listar(filtro: FiltroClientes): Promise<PaginaClientes> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.semTabela ? { tabelaPrecoId: null } : {}),
        ...(filtro.busca
          ? {
              OR: [
                { nome: { contains: filtro.busca, mode: 'insensitive' as const } },
                { documento: { contains: filtro.busca, mode: 'insensitive' as const } },
                { email: { contains: filtro.busca, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const linhas = await tx.cliente.findMany({
        where: onde,
        orderBy: { nome: 'asc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: this.inclusao(),
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      const [total, semTabela, padrao] = await Promise.all([
        tx.cliente.count({ where: onde }),
        // Contado sempre sobre os ATIVOS, e não sobre o filtro: é um aviso da
        // tela ("há gente sem catálogo"), não o resultado da busca.
        tx.cliente.count({ where: { status: 'ATIVO', tabelaPrecoId: null } }),
        this.modoPadrao(tx),
      ]);

      return {
        itens: pagina.map((c) => this.paraContrato(c, padrao)),
        proximoCursor: temMais ? (pagina.at(-1)?.id ?? null) : null,
        total,
        semTabela,
      };
    });
  }

  async detalhe(id: string): Promise<Cliente> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const cliente = await tx.cliente.findUnique({ where: { id }, include: this.inclusao() });

      if (!cliente) {
        throw new NotFoundException({
          codigo: 'CLIENTE_NAO_ENCONTRADO',
          mensagem: 'Cadastro não encontrado.',
        });
      }

      return this.paraContrato(cliente, await this.modoPadrao(tx));
    });
  }

  /**
   * As tabelas de preço, com quantos itens cada uma tem precificado.
   *
   * A contagem não é enfeite: vincular alguém a uma tabela vazia produz um
   * catálogo vazio, e o efeito só apareceria quando o cliente reclamasse. É
   * mais barato mostrar o número na hora de escolher.
   */
  async apoio(): Promise<ApoioCliente> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const tabelas = await tx.tabelaPreco.findMany({
        where: { status: 'ATIVO' },
        orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
        include: { _count: { select: { precos: true } } },
      });

      return {
        tabelas: tabelas.map((t) => ({
          id: t.id,
          nome: t.nome,
          chave: t.chave,
          padrao: t.padrao,
          itensComPreco: t._count.precos,
        })),
        modoCheckoutPadrao: await this.modoPadrao(tx),
      };
    });
  }

  async criar(dados: NovoCliente, principal: Principal): Promise<{ id: string }> {
    return comEscopoAtual(this.prisma, async (tx) => {
      await this.conferirTabela(tx, dados.tabelaPrecoId ?? null);

      const documento = dados.documento?.trim() ? dados.documento.trim() : null;
      if (documento) {
        const repetido = await tx.cliente.findFirst({ where: { documento } });
        if (repetido) {
          throw new ConflictException({
            codigo: 'DOCUMENTO_JA_CADASTRADO',
            mensagem: `Já existe um cadastro com este documento: ${repetido.nome}.`,
          });
        }
      }

      const criado = await tx.cliente.create({
        data: {
          tenantId: principal.tenantId,
          nome: dados.nome,
          documento,
          email: dados.email?.trim() ? dados.email.trim() : null,
          telefone: dados.telefone?.trim() ? dados.telefone.trim() : null,
          perfil: dados.perfil,
          ...(dados.tabelaPrecoId ? { tabelaPrecoId: dados.tabelaPrecoId } : {}),
          ...(dados.modoCheckout ? { modoCheckout: dados.modoCheckout } : {}),
          usaCarteira: dados.usaCarteira,
        },
        select: { id: true },
      });

      if (dados.usaCarteira) {
        await this.garantirCarteira(tx, criado.id, principal.tenantId);
      }

      return criado;
    });
  }

  /**
   * Marcar `usaCarteira` CRIA a conta corrente, se ainda não houver.
   *
   * Sem isto a bandeira era promessa vazia: o cadastro dizia "usa carteira",
   * não existia carteira nenhuma, e a venda a prazo caía no outro caminho sem
   * ninguém notar. `usaCarteira` e `temCarteira` são campos separados no
   * contrato justamente porque um não garantia o outro.
   *
   * Desmarcar NÃO apaga: a carteira guarda um razão imutável, e um saldo com
   * histórico não some porque alguém desmarcou uma caixa. Ela só deixa de ser
   * usada.
   */
  private async garantirCarteira(
    tx: ClienteEmTransacao,
    clienteId: string,
    tenantId: string,
  ): Promise<void> {
    const existe = await tx.carteira.findFirst({ where: { clienteId }, select: { id: true } });
    if (existe) return;

    await tx.carteira.create({ data: { tenantId, clienteId } });
  }

  async alterar(id: string, dados: AlteracaoCliente): Promise<{ id: string }> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const atual = await tx.cliente.findUnique({ where: { id }, select: { id: true } });
      if (!atual) {
        throw new NotFoundException({
          codigo: 'CLIENTE_NAO_ENCONTRADO',
          mensagem: 'Cadastro não encontrado.',
        });
      }

      if (dados.tabelaPrecoId !== undefined) {
        await this.conferirTabela(tx, dados.tabelaPrecoId);
      }

      if (dados.documento) {
        const repetido = await tx.cliente.findFirst({
          where: { documento: dados.documento, id: { not: id } },
        });
        if (repetido) {
          throw new ConflictException({
            codigo: 'DOCUMENTO_JA_CADASTRADO',
            mensagem: `Já existe um cadastro com este documento: ${repetido.nome}.`,
          });
        }
      }

      await tx.cliente.update({
        where: { id },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.documento !== undefined ? { documento: dados.documento } : {}),
          ...(dados.email !== undefined ? { email: dados.email } : {}),
          ...(dados.telefone !== undefined ? { telefone: dados.telefone } : {}),
          ...(dados.status !== undefined ? { status: dados.status } : {}),
          ...(dados.perfil !== undefined ? { perfil: dados.perfil } : {}),
          ...(dados.tabelaPrecoId !== undefined ? { tabelaPrecoId: dados.tabelaPrecoId } : {}),
          ...(dados.modoCheckout !== undefined ? { modoCheckout: dados.modoCheckout } : {}),
          ...(dados.usaCarteira !== undefined ? { usaCarteira: dados.usaCarteira } : {}),
        },
      });

      // Ligar a bandeira cria a conta corrente; desligar não apaga nada.
      if (dados.usaCarteira === true) {
        await this.garantirCarteira(tx, id, exigirContexto().tenantId);
      }

      return { id };
    });
  }

  /**
   * A tabela precisa existir E estar ativa.
   *
   * Sem esta conferência, um id qualquer passaria pelo Zod (é um uuid) e a
   * chave estrangeira aceitaria a tabela inativa — deixando o cliente
   * vinculado a algo que a loja já aposentou.
   */
  private async conferirTabela(
    tx: ClienteEmTransacao,
    tabelaPrecoId: string | null,
  ): Promise<void> {
    if (!tabelaPrecoId) {
      return;
    }

    const tabela = await tx.tabelaPreco.findFirst({
      where: { id: tabelaPrecoId, status: 'ATIVO' },
      select: { id: true },
    });

    if (!tabela) {
      throw new NotFoundException({
        codigo: 'TABELA_NAO_ENCONTRADA',
        mensagem: 'Tabela de preço não encontrada ou inativa.',
      });
    }
  }

  private async modoPadrao(tx: ClienteEmTransacao): Promise<ModoCheckout> {
    const config = await tx.tenantConfiguracao.findFirst({ select: { modoCheckout: true } });
    return config?.modoCheckout ?? 'PEDIDO_COM_CONFIRMACAO';
  }

  private inclusao() {
    return {
      tabelaPreco: { select: { id: true, nome: true } },
      carteira: { select: { id: true, saldo: true } },
      _count: { select: { acessos: true } },
    } as const;
  }

  private paraContrato(
    c: {
      id: string;
      nome: string;
      documento: string | null;
      email: string | null;
      telefone: string | null;
      status: string;
      perfil: string;
      modoCheckout: string | null;
      usaCarteira: boolean;
      criadoEm: Date;
      tabelaPreco: { id: string; nome: string } | null;
      carteira: { id: string; saldo: { toString(): string } } | null;
      _count: { acessos: number };
    },
    padrao: ModoCheckout,
  ): Cliente {
    return {
      id: c.id,
      nome: c.nome,
      documento: c.documento,
      email: c.email,
      telefone: c.telefone,
      status: c.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      perfil: c.perfil as Cliente['perfil'],
      tabelaPrecoId: c.tabelaPreco?.id ?? null,
      tabelaPreco: c.tabelaPreco?.nome ?? null,
      modoCheckout: (c.modoCheckout as ModoCheckout | null) ?? null,
      // Herdar e escolher são coisas diferentes, e a tela mostra as duas: o
      // que está gravado e o que de fato vale.
      modoCheckoutEfetivo: (c.modoCheckout as ModoCheckout | null) ?? padrao,
      usaCarteira: c.usaCarteira,
      temCarteira: c.carteira !== null,
      saldoCarteira: c.carteira ? dec(c.carteira.saldo.toString()).toFixed(2) : null,
      acessos: c._count.acessos,
      criadoEm: c.criadoEm.toISOString(),
    };
  }
}
