import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AlteracaoPerfil, NovoPerfil, Perfil, Permissao } from '@estoque/contracts';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import { chaveDe } from '@estoque/core';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Perfis e permissões.
 *
 * Um perfil é uma **lista explícita** de permissões. Nunca um curinga de
 * grupo: "todo o grupo carteira" passaria a conceder cada permissão que
 * aparecesse ali depois, sem ninguém decidir — foi assim que o perfil
 * FINANCEIRO ganhou `carteira.ajustar` duas vezes. A tela pode oferecer
 * "marcar o grupo"; o que chega aqui é a lista de hoje, uma a uma.
 *
 * Perfil de SISTEMA é só leitura. `npm run db:sync-perfis` reescreve as
 * permissões deles a partir de `docs/`, e uma edição feita na tela voltaria
 * atrás na próxima sincronização sem ninguém entender por quê.
 */
@Injectable()
export class PerfisService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** O catálogo inteiro. Tabela global, sem `tenant_id`. */
  async permissoes(): Promise<Permissao[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.permissao.findMany({ orderBy: [{ grupo: 'asc' }, { chave: 'asc' }] });
      return linhas.map((p) => ({ chave: p.chave, grupo: p.grupo, descricao: p.descricao }));
    });
  }

  async listar(): Promise<Perfil[]> {
    return comEscopoAtual(this.prisma, async (tx) => this.carregar(tx));
  }

  async criar(dados: NovoPerfil): Promise<Perfil> {
    const contexto = exigirContexto();

    return comEscopoAtual(this.prisma, async (tx) => {
      const chave = chaveDe(dados.nome);

      if (!chave) {
        throw new ConflictException({
          codigo: 'NOME_SEM_CHAVE',
          mensagem: 'O nome precisa ter letras ou números.',
        });
      }

      const repetido = await tx.perfil.findFirst({ where: { chave }, select: { nome: true } });
      if (repetido) {
        throw new ConflictException({
          codigo: 'PERFIL_JA_EXISTE',
          mensagem: `Já existe um perfil com esta chave: ${repetido.nome}.`,
        });
      }

      await this.exigirPermissoesConhecidas(tx, dados.permissoes);

      const perfil = await tx.perfil.create({
        data: {
          tenantId: contexto.tenantId,
          nome: dados.nome,
          chave,
          ...(dados.descricao ? { descricao: dados.descricao } : {}),
          permissoes: {
            create: dados.permissoes.map((permissaoChave) => ({
              tenantId: contexto.tenantId,
              permissaoChave,
            })),
          },
        },
        select: { id: true },
      });

      const todos = await this.carregar(tx);
      const criado = todos.find((p) => p.id === perfil.id);
      if (!criado) throw new NotFoundException({ codigo: 'PERFIL_NAO_ENCONTRADO', mensagem: '' });
      return criado;
    });
  }

  async alterar(id: string, dados: AlteracaoPerfil): Promise<Perfil> {
    const contexto = exigirContexto();

    return comEscopoAtual(this.prisma, async (tx) => {
      const atual = await tx.perfil.findFirst({
        where: { id },
        select: { id: true, sistema: true, nome: true },
      });

      if (!atual) {
        throw new NotFoundException({
          codigo: 'PERFIL_NAO_ENCONTRADO',
          mensagem: 'Perfil não encontrado.',
        });
      }

      if (atual.sistema) {
        throw new ConflictException({
          codigo: 'PERFIL_DE_SISTEMA',
          mensagem: `${atual.nome} é um perfil de sistema e é reescrito por \`db:sync-perfis\`. Duplique e ajuste a cópia.`,
        });
      }

      if (dados.permissoes) {
        await this.exigirPermissoesConhecidas(tx, dados.permissoes);

        /*
          Troca por SUBSTITUIÇÃO: apaga e recria. A tabela de junção não tem
          história — quem quer saber o que mudou lê a auditoria, que registra
          antes e depois. Somar sem apagar deixaria permissão revogada valendo.
        */
        await tx.perfilPermissao.deleteMany({ where: { perfilId: id } });
        await tx.perfilPermissao.createMany({
          data: dados.permissoes.map((permissaoChave) => ({
            tenantId: contexto.tenantId,
            perfilId: id,
            permissaoChave,
          })),
        });
      }

      await tx.perfil.update({
        where: { id },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.descricao !== undefined ? { descricao: dados.descricao } : {}),
        },
      });

      const todos = await this.carregar(tx);
      const alterado = todos.find((p) => p.id === id);
      if (!alterado) throw new NotFoundException({ codigo: 'PERFIL_NAO_ENCONTRADO', mensagem: '' });
      return alterado;
    });
  }

  /**
   * Duplicar é o caminho para mexer num perfil de sistema.
   *
   * A cópia nasce com as mesmas permissões e SEM a marca de sistema, então
   * `db:sync-perfis` não a toca.
   */
  async duplicar(id: string, nome: string): Promise<Perfil> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const origem = await tx.perfil.findFirst({
        where: { id },
        include: { permissoes: { select: { permissaoChave: true } } },
      });

      if (!origem) {
        throw new NotFoundException({
          codigo: 'PERFIL_NAO_ENCONTRADO',
          mensagem: 'Perfil não encontrado.',
        });
      }

      return this.criar({
        nome,
        ...(origem.descricao ? { descricao: origem.descricao } : {}),
        permissoes: origem.permissoes.map((p) => p.permissaoChave),
      });
    });
  }

  async excluir(id: string): Promise<void> {
    await comEscopoAtual(this.prisma, async (tx) => {
      const perfil = await tx.perfil.findFirst({
        where: { id },
        select: { id: true, nome: true, sistema: true, _count: { select: { usuarios: true } } },
      });

      if (!perfil) {
        throw new NotFoundException({
          codigo: 'PERFIL_NAO_ENCONTRADO',
          mensagem: 'Perfil não encontrado.',
        });
      }

      if (perfil.sistema) {
        throw new ConflictException({
          codigo: 'PERFIL_DE_SISTEMA',
          mensagem: `${perfil.nome} é um perfil de sistema e não se exclui.`,
        });
      }

      /*
        Excluir perfil em uso deixaria gente sem perfil nenhum — que entra e
        não vê menu algum, sem erro em lugar nenhum. Recusar e dizer quantos
        são é melhor do que produzir o problema em silêncio.
      */
      if (perfil._count.usuarios > 0) {
        throw new ConflictException({
          codigo: 'PERFIL_EM_USO',
          mensagem: `${String(perfil._count.usuarios)} ${perfil._count.usuarios === 1 ? 'pessoa usa' : 'pessoas usam'} este perfil. Troque o perfil delas antes.`,
        });
      }

      await tx.perfil.delete({ where: { id } });
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async carregar(tx: ClienteEmTransacao): Promise<Perfil[]> {
    const linhas = await tx.perfil.findMany({
      orderBy: [{ sistema: 'desc' }, { nome: 'asc' }],
      include: {
        permissoes: { select: { permissaoChave: true } },
        _count: { select: { usuarios: true } },
      },
    });

    return linhas.map((p) => ({
      id: p.id,
      nome: p.nome,
      chave: p.chave,
      descricao: p.descricao,
      sistema: p.sistema,
      permissoes: p.permissoes.map((x) => x.permissaoChave).sort(),
      usuarios: p._count.usuarios,
    }));
  }

  /**
   * Permissão que não existe no catálogo não entra.
   *
   * Sem esta conferência, um erro de digitação viraria uma linha que nunca
   * casa com nenhum `@Permissoes()` — o perfil pareceria conceder algo e não
   * concederia nada.
   */
  private async exigirPermissoesConhecidas(
    tx: ClienteEmTransacao,
    chaves: readonly string[],
  ): Promise<void> {
    const existem = await tx.permissao.findMany({
      where: { chave: { in: [...chaves] } },
      select: { chave: true },
    });

    const conhecidas = new Set(existem.map((p) => p.chave));
    const invalidas = chaves.filter((c) => !conhecidas.has(c));

    if (invalidas.length > 0) {
      throw new ConflictException({
        codigo: 'PERMISSAO_DESCONHECIDA',
        mensagem: `Estas permissões não existem: ${invalidas.join(', ')}.`,
      });
    }
  }
}
