import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AlteracaoProduto,
  ApoioProduto,
  FiltroProdutos,
  NovoProduto,
  PaginaProdutos,
  ProdutoLista,
} from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import { comEscopoAtual, exigirContexto, type ClienteEmTransacao, type PrismaClient } from '@estoque/db';

import { AuditoriaService } from '../comum/auditoria.service';
import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

interface Agregado {
  saldo: Dec;
  valor: Dec;
  negativo: boolean;
}

@Injectable()
export class ProdutosService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Listagem
  // -------------------------------------------------------------------------

  /**
   * Lista produtos.
   *
   * `podeVerCusto` decide se as chaves `custoMedio` e `valorEstoque` **entram
   * na resposta**. Não é filtro de tela: sem a permissão, os campos não
   * existem no JSON. Ver docs/REPORTS.md §6.
   */
  async listar(filtro: FiltroProdutos, podeVerCusto: boolean): Promise<PaginaProdutos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.categoriaId ? { categoriaId: filtro.categoriaId } : {}),
        ...(filtro.marcaId ? { marcaId: filtro.marcaId } : {}),
        ...(filtro.busca
          ? {
              OR: [
                { nome: { contains: filtro.busca, mode: 'insensitive' as const } },
                { skuBase: { contains: filtro.busca, mode: 'insensitive' as const } },
                {
                  variacoes: {
                    some: {
                      OR: [
                        { sku: { contains: filtro.busca, mode: 'insensitive' as const } },
                        { codigoBarras: filtro.busca },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };

      const total = await tx.produto.count({ where: onde });

      // Cursor, não offset: com dado mudando sob os pés, offset repete e pula
      // registros. Ver docs/REPORTS.md §5.
      const produtos = await tx.produto.findMany({
        where: onde,
        orderBy: { id: 'asc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: {
          categoria: { select: { nome: true } },
          marca: { select: { nome: true } },
          _count: { select: { variacoes: true } },
          // `_count` de imagens contaria as excluídas e as que falharam no
          // envio — e o produto apareceria "com foto" sem ter nenhuma
          // utilizável. Aqui só entram as vivas e prontas.
          imagens: {
            where: { excluidoEm: null, status: 'PRONTA' },
            select: { id: true, principal: true },
            orderBy: [{ principal: 'desc' }, { ordem: 'asc' }],
          },
        },
      });

      const temMais = produtos.length > filtro.limite;
      const pagina = temMais ? produtos.slice(0, filtro.limite) : produtos;
      const ids = pagina.map((p) => p.id);

      const [agregados, precos] = await Promise.all([
        this.agregarEstoque(tx, ids),
        this.menorPreco(tx, ids),
      ]);

      let itens: ProdutoLista[] = pagina.map((p) => {
        const agregado = agregados.get(p.id) ?? {
          saldo: dec(0),
          valor: dec(0),
          negativo: false,
        };

        const base: ProdutoLista = {
          id: p.id,
          skuBase: p.skuBase,
          nome: p.nome,
          status: p.status,
          categoria: p.categoria?.nome ?? null,
          marca: p.marca?.nome ?? null,
          totalVariacoes: p._count.variacoes,
          totalFotos: p.imagens.length,
          imagemPrincipalId: p.imagens.find((i) => i.principal)?.id ?? null,
          publicadoNoCatalogo: p.publicadoNoCatalogo,
          precoMinimo: precos.get(p.id)?.toFixed(2) ?? null,
          saldoTotal: agregado.saldo.toFixed(0),
          temSaldoNegativo: agregado.negativo,
        };

        if (!podeVerCusto) {
          return base;
        }

        // Custo médio da carteira do produto = valor ÷ saldo. Com saldo zero
        // a divisão não existe — e inventar zero faria o relatório mentir.
        const custoMedio = agregado.saldo.isZero()
          ? null
          : agregado.valor.dividedBy(agregado.saldo).toFixed(6);

        // A chave vai SEMPRE que a permissão existe, ainda que com `null`:
        // é assim que quem lê distingue "não posso ver" de "não há custo".
        return {
          ...base,
          custoMedio,
          valorEstoque: agregado.valor.toFixed(2),
        };
      });

      if (filtro.apenasDivergencia) {
        itens = itens.filter((i) => i.temSaldoNegativo);
      }

      return {
        itens,
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        total,
      };
    });
  }

  private async agregarEstoque(
    tx: ClienteEmTransacao,
    produtoIds: readonly string[],
  ): Promise<Map<string, Agregado>> {
    if (produtoIds.length === 0) {
      return new Map();
    }

    const saldos = await tx.saldoEstoque.findMany({
      where: { variacao: { produtoId: { in: [...produtoIds] } } },
      select: {
        quantidade: true,
        custoMedio: true,
        variacao: { select: { produtoId: true } },
      },
    });

    const mapa = new Map<string, Agregado>();

    for (const linha of saldos) {
      const produtoId = linha.variacao.produtoId;
      const atual = mapa.get(produtoId) ?? { saldo: dec(0), valor: dec(0), negativo: false };

      // Os valores chegam do Prisma como Decimal; passam por `dec` via texto
      // para entrar no mesmo tipo configurado do `core`.
      const quantidade = dec(linha.quantidade.toString());
      const custo = dec(linha.custoMedio.toString());

      mapa.set(produtoId, {
        saldo: atual.saldo.plus(quantidade),
        // Saldo negativo entra com sinal e REDUZ o valor. Somar só os
        // positivos mentiria sobre o patrimônio. Ver docs/REPORTS.md §2.
        valor: atual.valor.plus(quantidade.times(custo)),
        negativo: atual.negativo || quantidade.isNegative(),
      });
    }

    return mapa;
  }

  private async menorPreco(
    tx: ClienteEmTransacao,
    produtoIds: readonly string[],
  ): Promise<Map<string, Dec>> {
    if (produtoIds.length === 0) {
      return new Map();
    }

    const precos = await tx.precoItem.findMany({
      where: {
        tabelaPreco: { padrao: true },
        variacao: { produtoId: { in: [...produtoIds] } },
      },
      select: { preco: true, variacao: { select: { produtoId: true } } },
    });

    const mapa = new Map<string, Dec>();
    for (const linha of precos) {
      const produtoId = linha.variacao.produtoId;
      const preco = dec(linha.preco.toString());
      const atual = mapa.get(produtoId);
      if (!atual || preco.lessThan(atual)) {
        mapa.set(produtoId, preco);
      }
    }
    return mapa;
  }

  // -------------------------------------------------------------------------
  // Apoio aos formulários
  // -------------------------------------------------------------------------

  async apoio(): Promise<ApoioProduto> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const [categorias, marcas] = await Promise.all([
        tx.categoria.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
        tx.marca.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      ]);
      return { categorias, marcas };
    });
  }

  // -------------------------------------------------------------------------
  // Criação
  // -------------------------------------------------------------------------

  /**
   * Cria produto com variações e preços.
   *
   * O preço entra apenas na tabela **padrão**. A resolução de preço faz
   * fallback para ela quando a tabela específica do cliente não tem entrada —
   * então um produto novo já é vendável em todas as tabelas, e a loja ajusta
   * o preço de Professor ou Revendedor quando quiser.
   *
   * Tudo numa transação: produto sem preço, ou com metade das variações, é
   * um estado que não deve existir nem por um instante.
   */
  async criar(dados: NovoProduto, principal: Principal): Promise<{ id: string }> {
    const contexto = exigirContexto();

    const criado = await comEscopoAtual(this.prisma, async (tx) => {
      const jaExiste = await tx.produto.findFirst({
        where: { skuBase: dados.skuBase },
        select: { id: true },
      });

      if (jaExiste) {
        throw new ConflictException({
          codigo: 'SKU_BASE_DUPLICADO',
          mensagem: `Já existe um produto com o SKU base "${dados.skuBase}".`,
        });
      }

      const skusRepetidos = dados.variacoes
        .map((v) => v.sku.toUpperCase())
        .filter((sku, i, todos) => todos.indexOf(sku) !== i);

      if (skusRepetidos.length > 0) {
        throw new ConflictException({
          codigo: 'SKU_VARIACAO_DUPLICADO',
          mensagem: `SKU repetido entre as variações: ${[...new Set(skusRepetidos)].join(', ')}.`,
        });
      }

      const tabelaPadrao = await tx.tabelaPreco.findFirst({
        where: { padrao: true },
        select: { id: true },
      });

      const produto = await tx.produto.create({
        data: {
          tenantId: contexto.tenantId,
          skuBase: dados.skuBase.toUpperCase(),
          nome: dados.nome,
          descricao: dados.descricao ?? null,
          unidade: dados.unidade,
          categoriaId: dados.categoriaId ?? null,
          marcaId: dados.marcaId ?? null,
          status: 'ATIVO',
          variacoes: {
            create: dados.variacoes.map((v) => ({
              tenantId: contexto.tenantId,
              sku: v.sku.toUpperCase(),
              descricao: v.descricao,
              codigoBarras: v.codigoBarras ?? null,
              estoqueMinimo: v.estoqueMinimo,
            })),
          },
        },
        include: { variacoes: { select: { id: true, sku: true } } },
      });

      if (tabelaPadrao) {
        for (const variacao of produto.variacoes) {
          const entrada = dados.variacoes.find((v) => v.sku.toUpperCase() === variacao.sku);
          if (!entrada) {
            continue;
          }
          await tx.precoItem.create({
            data: {
              tenantId: contexto.tenantId,
              tabelaPrecoId: tabelaPadrao.id,
              variacaoId: variacao.id,
              preco: entrada.precoPadrao,
            },
          });
        }
      }

      return produto;
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'PRODUTO_CRIADO',
      entidade: 'produto',
      entidadeId: criado.id,
      atorNome: principal.nome,
      depois: {
        skuBase: criado.skuBase,
        nome: criado.nome,
        variacoes: criado.variacoes.length,
      },
    });

    return { id: criado.id };
  }

  // -------------------------------------------------------------------------
  // Alteração
  // -------------------------------------------------------------------------

  async alterar(
    id: string,
    dados: AlteracaoProduto,
    principal: Principal,
  ): Promise<{ id: string }> {
    const contexto = exigirContexto();

    const resultado = await comEscopoAtual(this.prisma, async (tx) => {
      const antes = await tx.produto.findUnique({
        where: { id },
        include: {
          // Contagem filtrada: foto excluída ou que falhou no envio não
          // habilita publicação. Sem o `where`, bastava excluir a única foto
          // e publicar em seguida — a linha continuaria lá.
          _count: {
            select: { imagens: { where: { excluidoEm: null, status: 'PRONTA' } } },
          },
        },
      });

      // 404, não 403: recurso de outra empresa simplesmente não existe para
      // quem pergunta. Ver docs/TENANCY.md §5.
      if (!antes) {
        throw new NotFoundException({
          codigo: 'PRODUTO_NAO_ENCONTRADO',
          mensagem: 'Produto não encontrado.',
        });
      }

      // Regra de docs/MEDIA.md §5: sem foto, não vai para o catálogo. Um
      // catálogo com quadrado cinza é pior do que um produto a menos.
      if (dados.publicadoNoCatalogo === true && antes._count.imagens === 0) {
        throw new ConflictException({
          codigo: 'PRODUTO_SEM_FOTO',
          mensagem: 'Um produto sem foto não pode ser publicado no catálogo.',
        });
      }

      const depois = await tx.produto.update({
        where: { id },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.descricao !== undefined ? { descricao: dados.descricao } : {}),
          ...(dados.categoriaId !== undefined ? { categoriaId: dados.categoriaId } : {}),
          ...(dados.marcaId !== undefined ? { marcaId: dados.marcaId } : {}),
          ...(dados.status !== undefined ? { status: dados.status } : {}),
          ...(dados.publicadoNoCatalogo !== undefined
            ? { publicadoNoCatalogo: dados.publicadoNoCatalogo }
            : {}),
        },
      });

      return { antes, depois };
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'PRODUTO_ALTERADO',
      entidade: 'produto',
      entidadeId: id,
      atorNome: principal.nome,
      antes: {
        nome: resultado.antes.nome,
        status: resultado.antes.status,
        publicadoNoCatalogo: resultado.antes.publicadoNoCatalogo,
      },
      depois: {
        nome: resultado.depois.nome,
        status: resultado.depois.status,
        publicadoNoCatalogo: resultado.depois.publicadoNoCatalogo,
      },
    });

    return { id };
  }
}
