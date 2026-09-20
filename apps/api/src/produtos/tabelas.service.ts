import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AlteracaoTabelaPreco,
  FiltroItensTabela,
  GravacaoPrecosTabela,
  ItemDaTabela,
  NovaTabelaPreco,
  PaginaItensTabela,
  TabelaPreco,
} from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * As tabelas de preco.
   *
   * Inativas ficam de fora por padrao. Uma base de teste juntou 140 tabelas
   * desativadas e elas empurravam as quatro de verdade para fora da tela — a
   * mesma armadilha ja registrada para lojas. `incluirInativas` traz todas.
   */
  async listar(incluirInativas = false): Promise<TabelaPreco[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.tabelaPreco.findMany({
        ...(incluirInativas ? {} : { where: { status: 'ATIVO' as const } }),
        orderBy: [{ padrao: 'desc' }, { status: 'asc' }, { nome: 'asc' }],
        include: { _count: { select: { precos: true, clientes: true } } },
      });

      /*
        Quantos faltam, em DUAS consultas e nao em N.

        Era uma contagem pesada por tabela: com 144 tabelas, 144 varreduras de
        variacao a cada abertura da tela, e o teste que lista tres vezes
        estourava o prazo. Agora e o total de ativas menos as que ja tem preco
        em cada tabela.

        Contar `_count.precos` nao serviria: ele inclui linha de variacao
        INATIVA, e a subtracao daria negativo no dia em que alguem desativar
        uma variacao — por isso o agrupamento filtra a variacao ativa.
      */
      const [ativas, comPreco] = await Promise.all([
        tx.variacao.count({ where: { status: 'ATIVO' } }),
        tx.precoItem.groupBy({
          by: ['tabelaPrecoId'],
          where: { variacao: { status: 'ATIVO' } },
          _count: { variacaoId: true },
        }),
      ]);

      const porTabela = new Map(comPreco.map((g) => [g.tabelaPrecoId, g._count.variacaoId]));

      return linhas.map((t) => this.paraContrato(t, ativas - (porTabela.get(t.id) ?? 0)));
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

  /**
   * As variações vistas de dentro de uma tabela.
   *
   * É a tela onde se preenche preço: cada linha traz o custo médio (para quem
   * pode vê-lo), o preço da tabela padrão como referência e o preço desta
   * tabela. O filtro `semPreco` é a fila de trabalho real — item sem preço
   * aqui simplesmente não existe para quem compra por esta tabela.
   */
  async itens(
    tabelaId: string,
    filtro: FiltroItensTabela,
    podeVerCusto: boolean,
  ): Promise<PaginaItensTabela> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const tabela = await tx.tabelaPreco.findFirst({
        where: { id: tabelaId },
        include: { _count: { select: { precos: true, clientes: true } } },
      });

      if (!tabela) {
        throw new NotFoundException({
          codigo: 'TABELA_NAO_ENCONTRADA',
          mensagem: 'Tabela de preço não encontrada.',
        });
      }

      const padrao = await tx.tabelaPreco.findFirst({
        where: { padrao: true, status: 'ATIVO' },
        select: { id: true },
      });

      const recorte = {
        status: 'ATIVO' as const,
        ...(filtro.busca
          ? {
              OR: [
                { sku: { contains: filtro.busca, mode: 'insensitive' as const } },
                { codigoBarras: filtro.busca },
                { descricao: { contains: filtro.busca, mode: 'insensitive' as const } },
                {
                  produto: { nome: { contains: filtro.busca, mode: 'insensitive' as const } },
                },
              ],
            }
          : {}),
        ...(filtro.categoriaId ? { produto: { categoriaId: filtro.categoriaId } } : {}),
        // `none` em vez de comparar com null: o preço é uma LINHA que existe
        // ou não existe, não um campo vazio.
        ...(filtro.semPreco ? { precos: { none: { tabelaPrecoId: tabelaId } } } : {}),
      };

      /*
        Sem busca nem categoria, o recorte E um dos dois totais que ja estao
        sendo contados. Uma terceira contagem ali seria a mesma resposta paga
        duas vezes, em toda abertura da tela.
      */
      const recortado = Boolean(filtro.busca || filtro.categoriaId);

      const [total, semPreco, filtrados, linhas] = await Promise.all([
        tx.variacao.count({ where: { status: 'ATIVO' } }),
        tx.variacao.count({
          where: { status: 'ATIVO', precos: { none: { tabelaPrecoId: tabelaId } } },
        }),
        // O mesmo `recorte` da listagem: o rodape conta o que a lista mostra.
        recortado ? tx.variacao.count({ where: recorte }) : Promise.resolve(null),
        tx.variacao.findMany({
          where: recorte,
          orderBy: [{ produto: { nome: 'asc' } }, { sku: 'asc' }],
          take: filtro.limite + 1,
          ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
          include: {
            produto: { select: { nome: true, categoria: { select: { nome: true } } } },
            precos: {
              where: {
                tabelaPrecoId: { in: [tabelaId, ...(padrao ? [padrao.id] : [])] },
              },
              select: { tabelaPrecoId: true, preco: true },
            },
            saldos: { select: { custoMedio: true, quantidade: true } },
          },
        }),
      ]);

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      let somaMargem = dec(0);
      let comMargem = 0;

      const itens: ItemDaTabela[] = pagina.map((v) => {
        const aqui = v.precos.find((p) => p.tabelaPrecoId === tabelaId);
        const naPadrao = padrao ? v.precos.find((p) => p.tabelaPrecoId === padrao.id) : undefined;

        const preco = aqui ? dec(aqui.preco.toString()) : null;
        const custo = podeVerCusto ? this.custoMedio(v.saldos) : null;

        // Margem só com os dois números. Com custo zero — item nunca comprado
        // — a conta daria 100%, que é mentira, não margem.
        const margem =
          preco && custo && preco.greaterThan(0) && custo.greaterThan(0)
            ? preco.minus(custo).dividedBy(preco).times(100)
            : null;

        if (margem) {
          somaMargem = somaMargem.plus(margem);
          comMargem += 1;
        }

        return {
          variacaoId: v.id,
          sku: v.sku,
          produto: v.produto.nome,
          descricaoVariacao: v.descricao,
          categoria: v.produto.categoria?.nome ?? null,
          preco: preco ? preco.toFixed(2) : null,
          precoPadrao: naPadrao ? dec(naPadrao.preco.toString()).toFixed(2) : null,
          ...(podeVerCusto ? { custoMedio: (custo ?? dec(0)).toFixed(2) } : {}),
          ...(podeVerCusto ? { margem: margem ? margem.toFixed(1) : null } : {}),
        };
      });

      return {
        tabela: this.paraContrato(tabela, semPreco),
        itens,
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        total,
        semPreco,
        totalFiltrado: filtrados ?? (filtro.semPreco ? semPreco : total),
        margemMedia:
          podeVerCusto && comMargem > 0 ? somaMargem.dividedBy(comMargem).toFixed(1) : null,
      };
    });
  }

  /**
   * Grava os preços desta tabela.
   *
   * `preco_historico` é append-only: trocar um preço não apaga o anterior, e
   * a venda de março continua explicável. Apagar a linha (preço `null`) tira
   * o item do catálogo desta tabela — é decisão, não limpeza.
   */
  async gravarPrecos(
    tabelaId: string,
    dados: GravacaoPrecosTabela,
    principal: Principal,
  ): Promise<{ gravados: number; removidos: number }> {
    const contexto = exigirContexto();

    return comEscopoAtual(this.prisma, async (tx) => {
      const tabela = await tx.tabelaPreco.findFirst({
        where: { id: tabelaId },
        select: { id: true, nome: true, status: true },
      });

      if (!tabela) {
        throw new NotFoundException({
          codigo: 'TABELA_NAO_ENCONTRADA',
          mensagem: 'Tabela de preço não encontrada.',
        });
      }

      if (tabela.status !== 'ATIVO') {
        throw new ConflictException({
          codigo: 'TABELA_INATIVA',
          mensagem: 'Tabela inativa não recebe preço. Reative-a antes.',
        });
      }

      let gravados = 0;
      let removidos = 0;

      for (const linha of dados.precos) {
        const variacao = await tx.variacao.findFirst({
          where: { id: linha.variacaoId },
          select: { id: true },
        });

        if (!variacao) {
          throw new NotFoundException({
            codigo: 'VARIACAO_NAO_ENCONTRADA',
            mensagem: 'Uma das variações não existe.',
          });
        }

        const atual = await tx.precoItem.findFirst({
          where: { tabelaPrecoId: tabelaId, variacaoId: linha.variacaoId },
        });

        if (linha.preco === null) {
          if (atual) {
            await tx.precoItem.delete({ where: { id: atual.id } });
            removidos += 1;
          }
          continue;
        }

        const novo = dec(linha.preco);

        if (atual) {
          if (dec(atual.preco.toString()).equals(novo)) continue;

          await tx.precoItem.update({ where: { id: atual.id }, data: { preco: novo.toFixed(2) } });
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
              tabelaPrecoId: tabelaId,
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

        gravados += 1;
      }

      await this.auditoria.registrar({
        contexto,
        acao: 'PRECOS_DA_TABELA_ALTERADOS',
        entidade: 'tabela_preco',
        entidadeId: tabelaId,
        atorNome: principal.nome,
        depois: { tabela: tabela.nome, gravados, removidos },
      });

      return { gravados, removidos };
    });
  }

  /**
   * Custo médio ponderado pelos saldos.
   *
   * Um item em três locais tem três custos médios; a média simples entre eles
   * mentiria quando 90% do saldo está num local só.
   */
  private custoMedio(
    saldos: { custoMedio: { toString(): string }; quantidade: { toString(): string } }[],
  ): Dec {
    let valor = dec(0);
    let quantidade = dec(0);

    for (const s of saldos) {
      const q = dec(s.quantidade.toString());
      if (q.lessThanOrEqualTo(0)) continue;
      valor = valor.plus(q.times(dec(s.custoMedio.toString())));
      quantidade = quantidade.plus(q);
    }

    return quantidade.greaterThan(0) ? valor.dividedBy(quantidade) : dec(0);
  }

  private paraContrato(
    t: {
      id: string;
      nome: string;
      chave: string;
      padrao: boolean;
      status: string;
      criadoEm: Date;
      _count: { precos: number; clientes: number };
    },
    semPreco = 0,
  ): TabelaPreco {
    return {
      id: t.id,
      nome: t.nome,
      chave: t.chave,
      padrao: t.padrao,
      status: t.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      itensComPreco: t._count.precos,
      semPreco,
      clientes: t._count.clientes,
      criadoEm: t.criadoEm.toISOString(),
    };
  }
}
