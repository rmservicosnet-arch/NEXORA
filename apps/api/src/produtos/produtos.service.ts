import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AlteracaoProduto,
  ApoioProduto,
  Opcao,
  FiltroProdutos,
  NovoProduto,
  PaginaProdutos,
  ProdutoDetalhe,
  ProdutoLista,
} from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

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
        ...(filtro.publicado !== undefined ? { publicadoNoCatalogo: filtro.publicado } : {}),
        // "Sem foto" é ausência de imagem VIVA e PRONTA: excluída não conta,
        // e a que falhou no envio também não — senão o produto apareceria
        // resolvido sem ter foto nenhuma utilizável.
        ...(filtro.semFoto
          ? { imagens: { none: { excluidoEm: null, status: 'PRONTA' as const } } }
          : {}),
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

      /**
       * O total e os três números do cabeçalho, sobre o MESMO filtro.
       *
       * Um "3 sem foto" que ignorasse a busca mandaria o operador procurar
       * item que não está na tela. `variacoes` conta as ativas: variação
       * desligada não é trabalho a fazer.
       */
      const [total, variacoes, semFoto, comDivergencia] = await Promise.all([
        tx.produto.count({ where: onde }),
        tx.variacao.count({ where: { status: 'ATIVO', produto: onde } }),
        tx.produto.count({
          where: { ...onde, imagens: { none: { excluidoEm: null, status: 'PRONTA' } } },
        }),
        tx.produto.count({
          where: { ...onde, variacoes: { some: { saldos: { some: { quantidade: { lt: 0 } } } } } },
        }),
      ]);

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
        this.menorPreco(tx, ids, filtro.tabelaPrecoId),
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
        resumo: { variacoes, semFoto, comDivergencia },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Detalhe
  // -------------------------------------------------------------------------

  /**
   * Um produto, com variações e saldo por local.
   *
   * Existe porque a tela do produto buscava a listagem inteira e procurava o
   * seu item nela — o que funciona enquanto a empresa tem menos produtos do
   * que a primeira página comporta, e quebra em silêncio depois disso.
   */
  async detalhe(id: string, podeVerCusto: boolean): Promise<ProdutoDetalhe> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const produto = await tx.produto.findFirst({
        where: { id },
        include: {
          categoria: { select: { id: true, nome: true } },
          marca: { select: { id: true, nome: true } },
          imagens: {
            where: { excluidoEm: null, status: 'PRONTA' },
            select: { id: true, principal: true },
            orderBy: [{ principal: 'desc' }, { ordem: 'asc' }],
          },
          variacoes: {
            orderBy: { sku: 'asc' },
            include: {
              precos: {
                where: { tabelaPreco: { padrao: true } },
                select: { preco: true },
                take: 1,
              },
              saldos: {
                include: {
                  local: {
                    select: {
                      id: true,
                      nome: true,
                      loja: { select: { id: true, nome: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      // 404, não 403: produto de outra empresa não existe para quem pergunta.
      if (!produto) {
        throw new NotFoundException({
          codigo: 'PRODUTO_NAO_ENCONTRADO',
          mensagem: 'Produto não encontrado.',
        });
      }

      let saldoTotal = dec(0);
      let valorTotal = dec(0);
      let algumNegativo = false;

      const variacoes = produto.variacoes.map((v) => {
        let saldo = dec(0);
        let valor = dec(0);

        const saldosPorLocal = v.saldos.map((s) => {
          const quantidade = dec(s.quantidade.toString());
          const custo = dec(s.custoMedio.toString());

          saldo = saldo.plus(quantidade);
          valor = valor.plus(quantidade.times(custo));

          return {
            localId: s.local.id,
            local: s.local.nome,
            lojaId: s.local.loja.id,
            loja: s.local.loja.nome,
            quantidade: quantidade.toFixed(0),
            ...(podeVerCusto ? { custoMedio: custo.toFixed(6) } : {}),
          };
        });

        saldoTotal = saldoTotal.plus(saldo);
        valorTotal = valorTotal.plus(valor);
        algumNegativo = algumNegativo || saldo.isNegative();

        const minimo = dec(v.estoqueMinimo.toString());

        return {
          id: v.id,
          sku: v.sku,
          descricao: v.descricao,
          codigoBarras: v.codigoBarras,
          estoqueMinimo: minimo.toFixed(0),
          status: v.status,
          precoPadrao: v.precos[0] ? dec(v.precos[0].preco.toString()).toFixed(2) : null,
          saldo: saldo.toFixed(0),
          // Mínimo zero não é alerta: significa que ninguém configurou mínimo.
          abaixoDoMinimo: minimo.greaterThan(0) && saldo.lessThan(minimo),
          ...(podeVerCusto
            ? { custoMedio: saldo.isZero() ? null : valor.dividedBy(saldo).toFixed(6) }
            : {}),
          saldosPorLocal,
        };
      });

      return {
        id: produto.id,
        skuBase: produto.skuBase,
        nome: produto.nome,
        descricao: produto.descricao,
        unidade: produto.unidade,
        status: produto.status,
        publicadoNoCatalogo: produto.publicadoNoCatalogo,
        categoria: produto.categoria,
        marca: produto.marca,
        totalFotos: produto.imagens.length,
        imagemPrincipalId: produto.imagens.find((i) => i.principal)?.id ?? null,
        saldoTotal: saldoTotal.toFixed(0),
        temSaldoNegativo: algumNegativo,
        ...(podeVerCusto ? { valorEstoque: valorTotal.toFixed(2) } : {}),
        variacoes,
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
    tabelaPrecoId?: string,
  ): Promise<Map<string, Dec>> {
    if (produtoIds.length === 0) {
      return new Map();
    }

    const precos = await tx.precoItem.findMany({
      where: {
        // Sem tabela informada, a padrão. Com ela, a pré-visualização do que
        // aquele tipo de cliente enxerga — item sem preço na tabela dele fica
        // sem `precoMinimo`, que é exatamente o que acontece no catálogo.
        ...(tabelaPrecoId ? { tabelaPrecoId } : { tabelaPreco: { padrao: true } }),
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
      /*
        O `_count` vem junto para a tela saber o que PODE excluir.

        Sem ele, "Excluir" apareceria em todas e a maioria responderia 409 —
        oferecer caminho que falha é o contrário do que o controle serve. Com
        o número, a que tem produtos mostra quantos, em texto visível.
      */
      const [categorias, marcas] = await Promise.all([
        tx.categoria.findMany({
          select: {
            id: true,
            nome: true,
            status: true,
            _count: { select: { produtos: true } },
          },
          orderBy: { nome: 'asc' },
        }),
        tx.marca.findMany({
          select: {
            id: true,
            nome: true,
            status: true,
            _count: { select: { produtos: true } },
          },
          orderBy: { nome: 'asc' },
        }),
      ]);

      /*
        Devolve ATIVAS e DESATIVADAS, com a bandeira.

        Filtrar as desativadas aqui faria a categoria do produto que está
        sendo editado sumir do campo — o valor continuaria gravado e a tela
        mostraria "Não definida". Quem decide o que oferecer é a tela: ela
        lista as ativas e mantém a escolhida, marcada.
      */
      const comUso = (o: {
        id: string;
        nome: string;
        status: string;
        _count: { produtos: number };
      }) => ({
        id: o.id,
        nome: o.nome,
        produtos: o._count.produtos,
        ativo: o.status === 'ATIVO',
      });

      return { categorias: categorias.map(comUso), marcas: marcas.map(comUso) };
    });
  }

  /**
   * Cria uma categoria ou uma marca.
   *
   * As duas só existiam pelo seed: `apoio` as listava e nada as criava. Numa
   * empresa nova — e a plataforma cria empresas vazias — os dois campos do
   * cadastro de produto ficavam presos em "Não definida" para sempre.
   *
   * O nome é único por empresa. Traduzir a colisão aqui evita um P2002 cru
   * chegando à tela como erro de banco, e diz a coisa útil: já existe.
   */
  async criarOpcao(tipo: 'categoria' | 'marca', nome: string): Promise<Opcao> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const contexto = exigirContexto();
      const limpo = nome.trim();

      const existente =
        tipo === 'categoria'
          ? await tx.categoria.findFirst({
              where: { nome: { equals: limpo, mode: 'insensitive' } },
            })
          : await tx.marca.findFirst({ where: { nome: { equals: limpo, mode: 'insensitive' } } });

      if (existente) {
        throw new ConflictException({
          codigo: tipo === 'categoria' ? 'CATEGORIA_JA_EXISTE' : 'MARCA_JA_EXISTE',
          mensagem: `Já existe ${tipo === 'categoria' ? 'a categoria' : 'a marca'} "${existente.nome}".`,
        });
      }

      const criada =
        tipo === 'categoria'
          ? await tx.categoria.create({ data: { tenantId: contexto.tenantId, nome: limpo } })
          : await tx.marca.create({ data: { tenantId: contexto.tenantId, nome: limpo } });

      return { id: criada.id, nome: criada.nome };
    });
  }

  /**
   * Exclui uma categoria ou marca que NINGUÉM usa.
   *
   * Criar sem poder desfazer prende um engano de digitação para sempre — foi
   * o mesmo defeito do perfil sem exclusão e da empresa sem exclusão. Com
   * produto apontando para ela a resposta é recusar e dizer quantos: apagar
   * silenciosamente deixaria os produtos sem categoria, e quem olhasse depois
   * não saberia que já tiveram uma.
   */
  async excluirOpcao(tipo: 'categoria' | 'marca', id: string): Promise<void> {
    await comEscopoAtual(this.prisma, async (tx) => {
      const usos = await tx.produto.count({
        where: tipo === 'categoria' ? { categoriaId: id } : { marcaId: id },
      });

      if (usos > 0) {
        throw new ConflictException({
          codigo: tipo === 'categoria' ? 'CATEGORIA_EM_USO' : 'MARCA_EM_USO',
          mensagem:
            `${usos} ${usos === 1 ? 'produto usa' : 'produtos usam'} ` +
            `${tipo === 'categoria' ? 'esta categoria' : 'esta marca'}. ` +
            'Troque a deles antes de excluir.',
        });
      }

      if (tipo === 'categoria') {
        const filhos = await tx.categoria.count({ where: { paiId: id } });
        if (filhos > 0) {
          throw new ConflictException({
            codigo: 'CATEGORIA_TEM_FILHAS',
            mensagem: `Esta categoria tem ${String(filhos)} subcategoria(s). Exclua as filhas primeiro.`,
          });
        }
        await tx.categoria.delete({ where: { id } });
      } else {
        await tx.marca.delete({ where: { id } });
      }
    });
  }

  /**
   * Renomeia.
   *
   * Faltava, e a falta prendia um erro de digitação para sempre: a saída
   * seria criar outra e trocar a de todos os produtos, um a um. A mesma
   * conferência de nome repetido da criação — ignorando a própria linha,
   * senão renomear para o mesmo nome se recusaria.
   */
  async renomearOpcao(tipo: 'categoria' | 'marca', id: string, nome: string): Promise<Opcao> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const limpo = nome.trim();

      const colidente =
        tipo === 'categoria'
          ? await tx.categoria.findFirst({
              where: { nome: { equals: limpo, mode: 'insensitive' }, id: { not: id } },
            })
          : await tx.marca.findFirst({
              where: { nome: { equals: limpo, mode: 'insensitive' }, id: { not: id } },
            });

      if (colidente) {
        throw new ConflictException({
          codigo: tipo === 'categoria' ? 'CATEGORIA_JA_EXISTE' : 'MARCA_JA_EXISTE',
          mensagem: `Já existe ${tipo === 'categoria' ? 'a categoria' : 'a marca'} "${colidente.nome}".`,
        });
      }

      const alterada =
        tipo === 'categoria'
          ? await tx.categoria.update({ where: { id }, data: { nome: limpo } })
          : await tx.marca.update({ where: { id }, data: { nome: limpo } });

      return { id: alterada.id, nome: alterada.nome };
    });
  }

  /**
   * Desativa ou reativa.
   *
   * É a saída para a que TEM vínculo: excluir apagaria a categoria de
   * produtos que já a usam, e quem olhasse depois não saberia que eles já
   * tiveram uma. Desativar some das escolhas novas e não mexe no passado —
   * o mesmo raciocínio de suspender uma empresa em vez de apagá-la.
   */
  async mudarSituacaoOpcao(
    tipo: 'categoria' | 'marca',
    id: string,
    ativo: boolean,
  ): Promise<Opcao> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const status = ativo ? 'ATIVO' : 'INATIVO';

      const alterada =
        tipo === 'categoria'
          ? await tx.categoria.update({ where: { id }, data: { status } })
          : await tx.marca.update({ where: { id }, data: { status } });

      return { id: alterada.id, nome: alterada.nome };
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
