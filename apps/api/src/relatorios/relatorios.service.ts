import { Inject, Injectable } from '@nestjs/common';
import type {
  FiltroDescontos,
  FiltroFormas,
  FiltroGiro,
  FiltroMovimentoRelatorio,
  FiltroPosicao,
  FiltroVendasRelatorio,
  LinhaPosicao,
  LinhaRanking,
  LinhaTransferencia,
  LinhaDesconto,
  LinhaForma,
  PosicaoEstoque,
  RelatorioDescontos,
  RelatorioFormas,
  RelatorioGiro,
  RelatorioInventario,
  RelatorioTransferencias,
  RelatorioVendas,
} from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import { comEscopoAtual, type ClienteEmTransacao, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Formas cujo dinheiro só entra DEPOIS da venda.
 *
 * Crédito entra aqui mesmo em uma parcela: quem liquida é a adquirente, e o
 * sistema ainda não guarda a data dela.
 */
const FORMAS_FUTURAS = new Set(['CREDITO', 'BOLETO', 'PRAZO', 'CARTEIRA']);

/** Curva ABC: A concentra 80% do valor, B os 15% seguintes, C o resto. */
const CORTE_A = 80;
const CORTE_B = 95;

/**
 * Os dois relatórios construídos.
 *
 * Tudo agregado no BANCO. Trazer as linhas para somar em JavaScript funciona
 * com o seed e cai na primeira loja de verdade — e o `Decimal` do dinheiro
 * atravessaria a rede para virar `number` no caminho, que é exatamente o que
 * este projeto não faz.
 */
@Injectable()
export class RelatoriosService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Posição de estoque
  // -------------------------------------------------------------------------

  async posicao(filtro: FiltroPosicao, podeVerCusto: boolean): Promise<PosicaoEstoque> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const condicoes: string[] = ["v.status = 'ATIVO'"];
      const parametros: unknown[] = [];

      if (filtro.lojaId) {
        parametros.push(filtro.lojaId);
        condicoes.push(`lj.id = $${parametros.length}::uuid`);
      }
      if (filtro.localId) {
        parametros.push(filtro.localId);
        condicoes.push(`l.id = $${parametros.length}::uuid`);
      }
      if (filtro.categoriaId) {
        parametros.push(filtro.categoriaId);
        condicoes.push(`p.categoria_id = $${parametros.length}::uuid`);
      }
      if (filtro.recorte === 'negativos') {
        condicoes.push('s.quantidade < 0');
      }
      if (filtro.recorte === 'abaixoDoMinimo') {
        condicoes.push('s.quantidade >= 0 AND s.quantidade < v.estoque_minimo');
      }

      const onde = condicoes.join(' AND ');

      /**
       * A curva ABC precisa da ORDEM INTEIRA, não da página.
       *
       * Classificar pelos 60 primeiros daria "A" para todos eles — a
       * participação acumulada só significa alguma coisa contra o total do
       * relatório. Por isso a janela roda sobre o conjunto todo e só depois
       * se corta a página.
       */
      const linhas = await tx.$queryRawUnsafe<
        {
          variacao_id: string;
          sku: string;
          produto: string;
          descricao: string;
          categoria: string | null;
          loja: string;
          local: string;
          saldo: string;
          estoque_minimo: string;
          custo_medio: string;
          valor: string;
          acumulado: string;
        }[]
      >(
        `
        WITH base AS (
          SELECT v.id AS variacao_id,
                 v.sku,
                 p.nome AS produto,
                 v.descricao,
                 c.nome AS categoria,
                 lj.nome AS loja,
                 l.nome AS local,
                 s.quantidade AS saldo,
                 v.estoque_minimo,
                 s.custo_medio,
                 (s.quantidade * s.custo_medio) AS valor
            FROM saldo_estoque s
            JOIN variacao v ON v.id = s.variacao_id
            JOIN produto p ON p.id = v.produto_id
            LEFT JOIN categoria c ON c.id = p.categoria_id
            JOIN local_estoque l ON l.id = s.local_id
            JOIN loja lj ON lj.id = l.loja_id
           WHERE ${onde}
        ),
        total AS (
          SELECT NULLIF(sum(valor) FILTER (WHERE valor > 0), 0) AS positivo FROM base
        )
        SELECT b.variacao_id,
               b.sku,
               b.produto,
               b.descricao,
               b.categoria,
               b.loja,
               b.local,
               b.saldo::text,
               b.estoque_minimo::text,
               b.custo_medio::text,
               b.valor::text,
               (100 * sum(GREATEST(b.valor, 0)) OVER (ORDER BY b.valor DESC, b.sku)
                    / COALESCE((SELECT positivo FROM total), 1))::text AS acumulado
          FROM base b
         ORDER BY b.valor DESC, b.sku
         LIMIT ${String(filtro.limite)}
        `,
        ...parametros,
      );

      const resumo = await tx.$queryRawUnsafe<
        {
          variacoes: bigint;
          produtos: bigint;
          unidades: string;
          abaixo: bigint;
          negativas: bigint;
          positivo: string;
          negativo: string;
        }[]
      >(
        `
        SELECT count(*) AS variacoes,
               count(DISTINCT v.produto_id) AS produtos,
               coalesce(sum(s.quantidade), 0)::text AS unidades,
               count(*) FILTER (WHERE s.quantidade >= 0 AND s.quantidade < v.estoque_minimo) AS abaixo,
               count(*) FILTER (WHERE s.quantidade < 0) AS negativas,
               coalesce(sum(s.quantidade * s.custo_medio) FILTER (WHERE s.quantidade > 0), 0)::text AS positivo,
               coalesce(sum(s.quantidade * s.custo_medio) FILTER (WHERE s.quantidade < 0), 0)::text AS negativo
          FROM saldo_estoque s
          JOIN variacao v ON v.id = s.variacao_id
          JOIN produto p ON p.id = v.produto_id
          JOIN local_estoque l ON l.id = s.local_id
          JOIN loja lj ON lj.id = l.loja_id
         WHERE ${onde}
        `,
        ...parametros,
      );

      const r = resumo[0];
      const variacoes = Number(r?.variacoes ?? 0);
      const positivos = dec(r?.positivo ?? '0');
      const negativos = dec(r?.negativo ?? '0');

      const itens: LinhaPosicao[] = linhas.map((linha) => {
        const saldo = dec(linha.saldo);
        const minimo = dec(linha.estoque_minimo);
        const acumulado = Number(linha.acumulado);

        return {
          variacaoId: linha.variacao_id,
          sku: linha.sku,
          produto: linha.produto,
          descricaoVariacao: linha.descricao,
          categoria: linha.categoria,
          loja: linha.loja,
          local: linha.local,
          saldo: saldo.toFixed(0),
          estoqueMinimo: minimo.toFixed(0),
          abaixoDoMinimo: saldo.greaterThanOrEqualTo(0) && saldo.lessThan(minimo),
          ...(podeVerCusto
            ? {
                custoMedio: dec(linha.custo_medio).toFixed(2),
                valor: dec(linha.valor).toFixed(2),
              }
            : {}),
          // Sem custo não há curva: o A, B e C saem da participação no valor.
          abc: podeVerCusto
            ? acumulado <= CORTE_A
              ? 'A'
              : acumulado <= CORTE_B
                ? 'B'
                : 'C'
            : null,
        };
      });

      const unidadesExibidas = linhas.reduce((soma, l) => soma.plus(dec(l.saldo)), dec(0));
      const valorExibido = linhas.reduce((soma, l) => soma.plus(dec(l.valor)), dec(0));

      return {
        em: new Date().toISOString(),
        variacoes,
        produtos: Number(r?.produtos ?? 0),
        unidades: dec(r?.unidades ?? '0').toFixed(0),
        abaixoDoMinimo: Number(r?.abaixo ?? 0),
        comSaldoNegativo: Number(r?.negativas ?? 0),
        ...(podeVerCusto
          ? {
              valorPositivos: positivos.toFixed(2),
              efeitoNegativos: negativos.toFixed(2),
              valorLiquido: positivos.plus(negativos).toFixed(2),
              custoMedioDaCarteira:
                variacoes > 0 ? positivos.dividedBy(variacoes).toFixed(2) : '0.00',
            }
          : {}),
        itens,
        totalExibido: {
          unidades: unidadesExibidas.toFixed(0),
          ...(podeVerCusto ? { valor: valorExibido.toFixed(2) } : {}),
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Vendas no período
  // -------------------------------------------------------------------------

  async vendas(filtro: FiltroVendasRelatorio, podeVerCusto: boolean): Promise<RelatorioVendas> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND v.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      const [resumo, porDia, formas, porLoja, ranking] = await Promise.all([
        this.resumoDeVendas(tx, recorte, parametros),
        this.faturamentoPorDia(tx, recorte, parametros),
        this.formasDePagamento(tx, recorte, parametros),
        this.vendasPorLoja(tx, recorte, parametros),
        this.ranking(tx, filtro, recorte, parametros, podeVerCusto),
      ]);

      const total = dec(resumo.total);
      const dias = filtro.dias;

      return {
        de: this.diaISO(-(dias - 1)),
        ate: this.diaISO(0),
        total: total.toFixed(2),
        vendas: resumo.vendas,
        ticketMedio: resumo.vendas > 0 ? total.dividedBy(resumo.vendas).toFixed(2) : '0.00',
        itens: resumo.itens,
        mediaDiaria: total.dividedBy(dias).toFixed(2),
        // Custo zero não é margem de 100%: é item que nunca teve entrada com
        // custo. Dizer 100% seria inventar lucro.
        ...(podeVerCusto ? { margem: this.margem(total, dec(resumo.custo)) } : {}),
        porDia,
        formasPagamento: formas,
        porLoja,
        dimensao: filtro.dimensao,
        ranking,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Descontos concedidos
  // -------------------------------------------------------------------------

  /**
   * Quanto cada vendedor abriu mão — e quanto cobrou a mais.
   *
   * Desconto mora em dois lugares: no item e no fechamento da venda. Somar só
   * um deles daria "nenhum desconto" numa loja que desconta tudo na linha.
   *
   * O acréscimo vem junto de propósito: sem ele, dar 10% e somar 15% pareceria
   * generosidade.
   */
  async descontos(filtro: FiltroDescontos): Promise<RelatorioDescontos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND v.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      const linhas = await tx.$queryRawUnsafe<
        {
          vendedor_id: string;
          vendedor: string;
          vendas: bigint;
          com_desconto: bigint;
          bruto: string;
          desconto: string;
          acrescimo: string;
          liquido: string;
          maior_taxa: string | null;
        }[]
      >(
        `
        WITH por_venda AS (
          SELECT v.id,
                 v.vendedor_id,
                 v.total,
                 v.acrescimo,
                 /* O desconto de item vem da linha; o do fechamento, do
                    cabecalho. Os dois saem do bolso da loja. */
                 (v.desconto + coalesce(i.desconto_itens, 0)) AS desconto,
                 (v.subtotal + coalesce(i.desconto_itens, 0)) AS bruto
            FROM venda v
            LEFT JOIN (
              SELECT venda_id, sum(desconto_item) AS desconto_itens
                FROM venda_item
               GROUP BY venda_id
            ) i ON i.venda_id = v.id
           WHERE v.status = 'CONCLUIDA'
             AND (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
                 > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
             ${recorte}
        )
        SELECT pv.vendedor_id,
               u.nome AS vendedor,
               count(*) AS vendas,
               count(*) FILTER (WHERE pv.desconto > 0) AS com_desconto,
               sum(pv.bruto)::text AS bruto,
               sum(pv.desconto)::text AS desconto,
               sum(pv.acrescimo)::text AS acrescimo,
               sum(pv.total)::text AS liquido,
               (max(CASE WHEN pv.bruto > 0 THEN pv.desconto / pv.bruto END) * 100)::text
                 AS maior_taxa
          FROM por_venda pv
          JOIN usuario u ON u.id = pv.vendedor_id
         GROUP BY pv.vendedor_id, u.nome
         ORDER BY sum(pv.desconto) DESC
        `,
        ...parametros,
      );

      const vendedores: LinhaDesconto[] = linhas.map((l) => {
        const bruto = dec(l.bruto);
        const desconto = dec(l.desconto);

        return {
          vendedorId: l.vendedor_id,
          vendedor: l.vendedor,
          vendas: Number(l.vendas),
          comDesconto: Number(l.com_desconto),
          bruto: bruto.toFixed(2),
          desconto: desconto.toFixed(2),
          acrescimo: dec(l.acrescimo).toFixed(2),
          liquido: dec(l.liquido).toFixed(2),
          taxa: bruto.greaterThan(0) ? desconto.dividedBy(bruto).times(100).toFixed(1) : '0.0',
          maiorTaxa: dec(l.maior_taxa ?? '0').toFixed(1),
        };
      });

      const soma = (campo: (l: LinhaDesconto) => string): Dec =>
        vendedores.reduce((s, l) => s.plus(dec(campo(l))), dec(0));

      const bruto = soma((l) => l.bruto);
      const desconto = soma((l) => l.desconto);

      return {
        dias: filtro.dias,
        bruto: bruto.toFixed(2),
        desconto: desconto.toFixed(2),
        acrescimo: soma((l) => l.acrescimo).toFixed(2),
        liquido: soma((l) => l.liquido).toFixed(2),
        taxa: bruto.greaterThan(0) ? desconto.dividedBy(bruto).times(100).toFixed(1) : '0.0',
        vendas: vendedores.reduce((s, l) => s + l.vendas, 0),
        comDesconto: vendedores.reduce((s, l) => s + l.comDesconto, 0),
        vendedores,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Formas de pagamento
  // -------------------------------------------------------------------------

  /**
   * Como o dinheiro entrou — e quando ele entra de verdade.
   *
   * Crédito fica no balde "futuro" mesmo em uma parcela: o prazo é da
   * adquirente, e este sistema ainda não registra a data de liquidação dela.
   * Chamá-lo de à vista faria o caixa parecer ter dinheiro que não tem.
   */
  async formas(filtro: FiltroFormas): Promise<RelatorioFormas> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND v.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      const periodo = `
        v.status = 'CONCLUIDA'
        AND (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
        ${recorte}`;

      const linhas = await tx.$queryRawUnsafe<
        { forma: string; total: string; pagamentos: bigint; parcelas: string }[]
      >(
        `
        SELECT pg.forma,
               sum(pg.valor)::text AS total,
               count(*) AS pagamentos,
               /* Ponderada pelo valor: dez compras de R$ 20 em 1x não disfarçam
                  uma de R$ 3.000 em 12x. */
               (sum(pg.valor * pg.parcelas) / NULLIF(sum(pg.valor), 0))::text AS parcelas
          FROM venda_pagamento pg
          JOIN venda v ON v.id = pg.venda_id
         WHERE ${periodo}
         GROUP BY pg.forma
         ORDER BY sum(pg.valor) DESC
        `,
        ...parametros,
      );

      const parcelas = await tx.$queryRawUnsafe<
        { parcelas: number; pagamentos: bigint; total: string }[]
      >(
        `
        SELECT pg.parcelas, count(*) AS pagamentos, sum(pg.valor)::text AS total
          FROM venda_pagamento pg
          JOIN venda v ON v.id = pg.venda_id
         WHERE ${periodo}
           AND pg.forma = 'CREDITO'
         GROUP BY pg.parcelas
         ORDER BY pg.parcelas
        `,
        ...parametros,
      );

      /*
        O troco sai da gaveta.

        `venda_pagamento` guarda o que o cliente ENTREGOU: cem reais numa
        venda de oitenta e sete. Somar isso como recebido em dinheiro declara
        na gaveta um dinheiro que voltou para o cliente — e o fechamento de
        caixa, que subtrai o troco, nunca bateria com este relatório.
      */
      const [{ troco } = { troco: '0' }] = await tx.$queryRawUnsafe<{ troco: string }[]>(
        `
        SELECT coalesce(sum(v.troco), 0)::text AS troco
          FROM venda v
         WHERE ${periodo}
        `,
        ...parametros,
      );

      const devolvido = dec(troco);
      const totalCredito = parcelas.reduce((soma, l) => soma.plus(dec(l.total)), dec(0));
      const total = linhas.reduce((soma, l) => soma.plus(dec(l.total)), dec(0)).minus(devolvido);

      const formas: LinhaForma[] = linhas.map((l) => {
        const valor = l.forma === 'DINHEIRO' ? dec(l.total).minus(devolvido) : dec(l.total);
        const quantos = Number(l.pagamentos);

        return {
          forma: l.forma,
          total: valor.toFixed(2),
          participacao: total.greaterThan(0) ? valor.dividedBy(total).times(100).toFixed(1) : '0.0',
          pagamentos: quantos,
          medio: quantos > 0 ? valor.dividedBy(quantos).toFixed(2) : '0.00',
          parcelasMedias: dec(l.parcelas ?? '1').toFixed(1),
          futuro: FORMAS_FUTURAS.has(l.forma),
        };
      });

      const futuro = formas
        .filter((f) => f.futuro)
        .reduce((soma, f) => soma.plus(dec(f.total)), dec(0));

      return {
        dias: filtro.dias,
        total: total.toFixed(2),
        imediato: total.minus(futuro).toFixed(2),
        futuro: futuro.toFixed(2),
        formas,
        parcelamento: parcelas.map((l) => ({
          parcelas: l.parcelas,
          pagamentos: Number(l.pagamentos),
          total: dec(l.total).toFixed(2),
          participacao: totalCredito.greaterThan(0)
            ? dec(l.total).dividedBy(totalCredito).times(100).toFixed(1)
            : '0.0',
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Giro, cobertura e encalhe
  // -------------------------------------------------------------------------

  /**
   * Quanto cada item girou — e há quanto tempo o que não girou está parado.
   *
   * Giro e encalhe são a mesma consulta vista dos dois lados: ordenada pelo
   * maior giro, responde "o que puxa a loja"; invertida, responde "onde o
   * dinheiro está dormindo". Separar em dois relatórios seria manter duas
   * consultas que precisam concordar — e elas divergiriam.
   */
  async giro(filtro: FiltroGiro, podeVerCusto: boolean): Promise<RelatorioGiro> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const condicoes = ["v.status = 'ATIVO'"];
      const parametros: unknown[] = [filtro.dias];

      if (filtro.lojaId) {
        parametros.push(filtro.lojaId);
        condicoes.push(`lj.id = $${parametros.length}::uuid`);
      }
      if (filtro.categoriaId) {
        parametros.push(filtro.categoriaId);
        condicoes.push(`p.categoria_id = $${parametros.length}::uuid`);
      }

      const onde = condicoes.join(' AND ');

      /*
        `parado` inverte a leitura: do que menos girou para o maior valor
        dormindo. É o relatório "Sem movimento" do índice, mesma consulta.
      */
      const ordem =
        filtro.ordem === 'parado'
          ? 'ORDER BY vendidas ASC, valor_parado DESC'
          : 'ORDER BY giro DESC NULLS LAST, vendidas DESC';

      const base = `
        WITH saldos AS (
          SELECT s.variacao_id,
                 sum(s.quantidade) AS saldo,
                 sum(s.quantidade * s.custo_medio) AS valor
            FROM saldo_estoque s
            JOIN local_estoque l ON l.id = s.local_id
            JOIN loja lj ON lj.id = l.loja_id
            JOIN variacao v ON v.id = s.variacao_id
            JOIN produto p ON p.id = v.produto_id
           WHERE ${onde}
           GROUP BY s.variacao_id
        ),
        vendas AS (
          SELECT m.variacao_id, sum(m.quantidade) AS vendidas
            FROM movimento_estoque m
           WHERE m.tipo = 'SAIDA_VENDA'
             AND m.criado_em > now() - ($1::int || ' days')::interval
           GROUP BY m.variacao_id
        )`;

      const linhas = await tx.$queryRawUnsafe<
        {
          variacao_id: string;
          sku: string;
          produto: string;
          descricao: string;
          categoria: string | null;
          saldo: string;
          vendidas: string;
          giro: string | null;
          dias_parado: number | null;
          valor_parado: string;
        }[]
      >(
        `
        ${base},
        ultimo AS (
          SELECT m.variacao_id, max(m.criado_em) AS em
            FROM movimento_estoque m
           GROUP BY m.variacao_id
        )
        SELECT v.id AS variacao_id,
               v.sku,
               p.nome AS produto,
               v.descricao,
               c.nome AS categoria,
               s.saldo::text,
               coalesce(ve.vendidas, 0)::text AS vendidas,
               CASE WHEN s.saldo > 0
                    THEN (coalesce(ve.vendidas, 0) / s.saldo)::text
               END AS giro,
               CASE WHEN u.em IS NOT NULL
                    THEN floor(extract(epoch FROM now() - u.em) / 86400)::int
               END AS dias_parado,
               GREATEST(s.valor, 0)::text AS valor_parado
          FROM saldos s
          JOIN variacao v ON v.id = s.variacao_id
          JOIN produto p ON p.id = v.produto_id
          LEFT JOIN categoria c ON c.id = p.categoria_id
          LEFT JOIN vendas ve ON ve.variacao_id = s.variacao_id
          LEFT JOIN ultimo u ON u.variacao_id = s.variacao_id
         ${ordem}
         LIMIT ${String(filtro.limite)}
        `,
        ...parametros,
      );

      /*
        O resumo conta o CONJUNTO inteiro, não a página. Somar a página daria
        "3 sem venda" numa loja com trezentos itens parados.
      */
      const resumo = await tx.$queryRawUnsafe<
        { sem_venda: bigint; sem_movimento: bigint; encalhado: string }[]
      >(
        `
        ${base},
        movidos AS (
          SELECT DISTINCT m.variacao_id
            FROM movimento_estoque m
           WHERE m.criado_em > now() - ($1::int || ' days')::interval
        )
        SELECT count(*) FILTER (WHERE ve.variacao_id IS NULL) AS sem_venda,
               count(*) FILTER (WHERE mo.variacao_id IS NULL) AS sem_movimento,
               coalesce(
                 sum(GREATEST(s.valor, 0)) FILTER (WHERE mo.variacao_id IS NULL),
                 0
               )::text AS encalhado
          FROM saldos s
          LEFT JOIN vendas ve ON ve.variacao_id = s.variacao_id
          LEFT JOIN movidos mo ON mo.variacao_id = s.variacao_id
        `,
        ...parametros,
      );

      const r = resumo[0];

      return {
        dias: filtro.dias,
        semVenda: Number(r?.sem_venda ?? 0),
        semMovimento: Number(r?.sem_movimento ?? 0),
        ...(podeVerCusto ? { valorEncalhado: dec(r?.encalhado ?? '0').toFixed(2) } : {}),
        itens: linhas.map((l) => {
          const saldo = dec(l.saldo);
          const vendidas = dec(l.vendidas);

          return {
            variacaoId: l.variacao_id,
            sku: l.sku,
            produto: l.produto,
            descricaoVariacao: l.descricao,
            categoria: l.categoria,
            saldo: saldo.toFixed(0),
            vendidas: vendidas.toFixed(0),
            giro: l.giro === null ? null : dec(l.giro).toFixed(2),
            /*
              Cobertura em dias: quantos dias o saldo aguenta no ritmo do
              período. Sem venda não há ritmo — e "infinito" não é cobertura,
              é a ausência dela. Nulo, e a tela escreve "sem giro".
            */
            cobertura:
              vendidas.greaterThan(0) && saldo.greaterThan(0)
                ? saldo.dividedBy(vendidas.dividedBy(filtro.dias)).toFixed(0)
                : null,
            diasParado: l.dias_parado,
            ...(podeVerCusto ? { valorEmEstoque: dec(l.valor_parado).toFixed(2) } : {}),
          };
        }),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Transferências
  // -------------------------------------------------------------------------

  /**
   * O que saiu de um local para outro.
   *
   * A transferência é DOIS movimentos — uma saída e uma entrada, ligadas pelo
   * mesmo documento. Em trânsito é a saída que ainda não tem a entrada par:
   * mercadoria que deixou um lugar e não chegou no outro.
   */
  async transferencias(filtro: FiltroMovimentoRelatorio): Promise<RelatorioTransferencias> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const parametros: unknown[] = [filtro.dias];
      let recorte = '';

      if (filtro.lojaId) {
        parametros.push(filtro.lojaId);
        recorte = `AND lj.id = $${parametros.length}::uuid`;
      }

      const linhas = await tx.$queryRawUnsafe<
        {
          id: string;
          em: Date;
          sku: string;
          produto: string;
          descricao: string;
          quantidade: string;
          origem: string;
          destino: string | null;
          ator_id: string | null;
        }[]
      >(
        `
        SELECT m.id,
               m.criado_em AS em,
               v.sku,
               p.nome AS produto,
               v.descricao,
               m.quantidade::text,
               (lj.nome || ' · ' || l.nome) AS origem,
               (
                 SELECT lj2.nome || ' · ' || l2.nome
                   FROM movimento_estoque e
                   JOIN local_estoque l2 ON l2.id = e.local_id
                   JOIN loja lj2 ON lj2.id = l2.loja_id
                  WHERE e.tipo = 'ENTRADA_TRANSFERENCIA'
                    AND e.documento_id = m.documento_id
                    AND e.variacao_id = m.variacao_id
                  LIMIT 1
               ) AS destino,
               m.ator_id
          FROM movimento_estoque m
          JOIN variacao v ON v.id = m.variacao_id
          JOIN produto p ON p.id = v.produto_id
          JOIN local_estoque l ON l.id = m.local_id
          JOIN loja lj ON lj.id = l.loja_id
         WHERE m.tipo = 'SAIDA_TRANSFERENCIA'
           AND m.criado_em > now() - ($1::int || ' days')::interval
           ${recorte}
         ORDER BY m.criado_em DESC
         LIMIT ${String(filtro.limite)}
        `,
        ...parametros,
      );

      /*
        O resumo conta o PERÍODO inteiro, não a página. Contar `itens.length`
        faria "80 enviadas" em qualquer loja que passasse do limite — e o
        número de em trânsito, que é o que importa, vinha capado junto.
      */
      const resumo = await tx.$queryRawUnsafe<{ enviadas: bigint; recebidas: bigint }[]>(
        `
        SELECT count(*) AS enviadas,
               count(*) FILTER (
                 WHERE EXISTS (
                   SELECT 1 FROM movimento_estoque e
                    WHERE e.tipo = 'ENTRADA_TRANSFERENCIA'
                      AND e.documento_id = m.documento_id
                      AND e.variacao_id = m.variacao_id
                 )
               ) AS recebidas
          FROM movimento_estoque m
          JOIN local_estoque l ON l.id = m.local_id
          JOIN loja lj ON lj.id = l.loja_id
         WHERE m.tipo = 'SAIDA_TRANSFERENCIA'
           AND m.criado_em > now() - ($1::int || ' days')::interval
           ${recorte}
        `,
        ...parametros,
      );

      const nomes = await this.nomesDosAtores(
        tx,
        linhas.map((l) => l.ator_id),
      );

      const itens: LinhaTransferencia[] = linhas.map((l) => ({
        id: l.id,
        em: l.em.toISOString(),
        sku: l.sku,
        produto: l.produto,
        descricaoVariacao: l.descricao,
        quantidade: dec(l.quantidade).toFixed(0),
        origem: l.origem,
        destino: l.destino,
        emTransito: l.destino === null,
        ator: this.nomeDoAtor(l.ator_id, nomes),
      }));

      const enviadas = Number(resumo[0]?.enviadas ?? 0);
      const recebidas = Number(resumo[0]?.recebidas ?? 0);

      return {
        dias: filtro.dias,
        enviadas,
        recebidas,
        emTransito: enviadas - recebidas,
        itens,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Divergências de inventário
  // -------------------------------------------------------------------------

  /**
   * O que a contagem encontrou de diferente do sistema.
   *
   * Sobra e falta não se compensam: somar as duas daria "quase zero" numa loja
   * onde metade do estoque está no lugar errado. São contadas separadamente, e
   * o efeito líquido vem à parte.
   */
  async inventario(
    filtro: FiltroMovimentoRelatorio,
    podeVerCusto: boolean,
  ): Promise<RelatorioInventario> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const parametros: unknown[] = [filtro.dias];
      let recorte = '';

      if (filtro.lojaId) {
        parametros.push(filtro.lojaId);
        recorte = `AND lj.id = $${parametros.length}::uuid`;
      }

      // A quantidade é sempre positiva; o sinal mora em `sentido`.
      const diferenca = `(CASE WHEN m.sentido = 'ENTRADA' THEN m.quantidade ELSE -m.quantidade END)`;

      const linhas = await tx.$queryRawUnsafe<
        {
          id: string;
          em: Date;
          sku: string;
          produto: string;
          descricao: string;
          local: string;
          loja: string;
          diferenca: string;
          saldo_anterior: string;
          saldo_posterior: string;
          valor: string;
          justificativa: string | null;
          ator_id: string | null;
        }[]
      >(
        `
        SELECT m.id,
               m.criado_em AS em,
               v.sku,
               p.nome AS produto,
               v.descricao,
               l.nome AS local,
               lj.nome AS loja,
               ${diferenca}::text AS diferenca,
               m.saldo_anterior::text,
               m.saldo_posterior::text,
               (${diferenca} * m.custo_unitario)::text AS valor,
               m.justificativa,
               m.ator_id
          FROM movimento_estoque m
          JOIN variacao v ON v.id = m.variacao_id
          JOIN produto p ON p.id = v.produto_id
          JOIN local_estoque l ON l.id = m.local_id
          JOIN loja lj ON lj.id = l.loja_id
         WHERE m.tipo IN ('ENTRADA_INVENTARIO', 'SAIDA_INVENTARIO')
           AND m.criado_em > now() - ($1::int || ' days')::interval
           ${recorte}
         ORDER BY m.criado_em DESC
         LIMIT ${String(filtro.limite)}
        `,
        ...parametros,
      );

      const resumo = await tx.$queryRawUnsafe<
        { contagens: bigint; sobras: bigint; faltas: bigint; liquido: string }[]
      >(
        `
        SELECT count(*) AS contagens,
               count(*) FILTER (WHERE m.sentido = 'ENTRADA') AS sobras,
               count(*) FILTER (WHERE m.sentido = 'SAIDA') AS faltas,
               coalesce(sum(${diferenca} * m.custo_unitario), 0)::text AS liquido
          FROM movimento_estoque m
          JOIN local_estoque l ON l.id = m.local_id
          JOIN loja lj ON lj.id = l.loja_id
         WHERE m.tipo IN ('ENTRADA_INVENTARIO', 'SAIDA_INVENTARIO')
           AND m.criado_em > now() - ($1::int || ' days')::interval
           ${recorte}
        `,
        ...parametros,
      );

      const r = resumo[0];
      const nomes = await this.nomesDosAtores(
        tx,
        linhas.map((l) => l.ator_id),
      );

      return {
        dias: filtro.dias,
        contagens: Number(r?.contagens ?? 0),
        sobras: Number(r?.sobras ?? 0),
        faltas: Number(r?.faltas ?? 0),
        ...(podeVerCusto ? { efeitoLiquido: dec(r?.liquido ?? '0').toFixed(2) } : {}),
        itens: linhas.map((l) => ({
          id: l.id,
          em: l.em.toISOString(),
          sku: l.sku,
          produto: l.produto,
          descricaoVariacao: l.descricao,
          local: l.local,
          loja: l.loja,
          diferenca: dec(l.diferenca).toFixed(0),
          saldoAntes: dec(l.saldo_anterior).toFixed(0),
          saldoDepois: dec(l.saldo_posterior).toFixed(0),
          ...(podeVerCusto ? { valor: dec(l.valor).toFixed(2) } : {}),
          justificativa: l.justificativa,
          ator: this.nomeDoAtor(l.ator_id, nomes),
        })),
      };
    });
  }

  /**
   * O nome de quem movimentou, numa consulta para a página inteira.
   *
   * `movimento_estoque.ator_id` é uuid sem chave estrangeira — o razão é
   * append-only e não pode depender de uma linha que alguém apague. Devolver o
   * id já encheu uma coluna "Usuário" de uuid.
   */
  private async nomesDosAtores(
    tx: ClienteEmTransacao,
    ids: (string | null)[],
  ): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unicos.length === 0) return new Map();

    const usuarios = await tx.usuario.findMany({
      where: { id: { in: unicos } },
      select: { id: true, nome: true },
    });
    return new Map(usuarios.map((u) => [u.id, u.nome]));
  }

  /** Sem ator o movimento veio da rotina; sem nome resolvido, some. */
  private nomeDoAtor(id: string | null, nomes: Map<string, string>): string | null {
    if (id === null) return 'Sistema';
    return nomes.get(id) ?? null;
  }

  /**
   * Margem bruta, ou `null` quando ela não significa nada.
   *
   * Custo zero acontece com item que nunca teve entrada com custo — e a conta
   * daria 100%, que é mentira, não lucro.
   */
  private margem(valor: Dec, custo: Dec): string | null {
    if (!valor.greaterThan(0) || !custo.greaterThan(0)) return null;
    return valor.minus(custo).dividedBy(valor).times(100).toFixed(1);
  }

  /** O dia, em ISO, contado para trás a partir de hoje no fuso da loja. */
  private diaISO(deslocamento: number): string {
    const agora = new Date();
    agora.setDate(agora.getDate() + deslocamento);
    return agora.toISOString().slice(0, 10);
  }

  private async resumoDeVendas(
    tx: ClienteEmTransacao,
    recorte: string,
    parametros: unknown[],
  ): Promise<{ total: string; vendas: number; itens: string; custo: string }> {
    const linhas = await tx.$queryRawUnsafe<
      { total: string; vendas: bigint; itens: string; custo: string }[]
    >(
      `
      SELECT coalesce(sum(v.total), 0)::text AS total,
             count(DISTINCT v.id) AS vendas,
             coalesce(sum(i.quantidade), 0)::text AS itens,
             coalesce(sum(i.quantidade * i.custo_unitario), 0)::text AS custo
        FROM venda v
        LEFT JOIN venda_item i ON i.venda_id = v.id
       WHERE v.status = 'CONCLUIDA'
         AND (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
             > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
         ${recorte}
      `,
      ...parametros,
    );

    const l = linhas[0];
    return {
      total: l?.total ?? '0',
      vendas: Number(l?.vendas ?? 0),
      itens: dec(l?.itens ?? '0').toFixed(0),
      custo: l?.custo ?? '0',
    };
  }

  private async faturamentoPorDia(
    tx: ClienteEmTransacao,
    recorte: string,
    parametros: unknown[],
  ): Promise<{ dia: string; total: string; vendas: number }[]> {
    // `generate_series` preenche o dia parado: pular o dia sem venda faria a
    // barra de terça encostar na de domingo, fingindo continuidade.
    const linhas = await tx.$queryRawUnsafe<{ dia: Date; total: string; vendas: bigint }[]>(
      `
      WITH dias AS (
        SELECT generate_series(
          (now() AT TIME ZONE 'America/Sao_Paulo')::date - ($1::int - 1),
          (now() AT TIME ZONE 'America/Sao_Paulo')::date,
          '1 day'
        )::date AS dia
      )
      SELECT d.dia,
             coalesce(sum(v.total), 0)::text AS total,
             count(v.id) AS vendas
        FROM dias d
        LEFT JOIN venda v
          ON (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date = d.dia
         AND v.status = 'CONCLUIDA'
         ${recorte}
       GROUP BY d.dia
       ORDER BY d.dia
      `,
      ...parametros,
    );

    return linhas.map((l) => ({
      dia: l.dia.toISOString().slice(0, 10),
      total: dec(l.total).toFixed(2),
      vendas: Number(l.vendas),
    }));
  }

  private async formasDePagamento(
    tx: ClienteEmTransacao,
    recorte: string,
    parametros: unknown[],
  ): Promise<{ forma: string; total: string; participacao: string }[]> {
    const linhas = await tx.$queryRawUnsafe<{ forma: string; total: string }[]>(
      `
      SELECT pg.forma, sum(pg.valor)::text AS total
        FROM venda_pagamento pg
        JOIN venda v ON v.id = pg.venda_id
       WHERE v.status = 'CONCLUIDA'
         AND (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
             > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
         ${recorte}
       GROUP BY pg.forma
       ORDER BY sum(pg.valor) DESC
      `,
      ...parametros,
    );

    const total = linhas.reduce((s, l) => s.plus(dec(l.total)), dec(0));

    return linhas.map((l) => ({
      forma: l.forma,
      total: dec(l.total).toFixed(2),
      participacao: total.greaterThan(0)
        ? dec(l.total).dividedBy(total).times(100).toFixed(1)
        : '0.0',
    }));
  }

  private async vendasPorLoja(
    tx: ClienteEmTransacao,
    recorte: string,
    parametros: unknown[],
  ): Promise<{ loja: string; total: string; participacao: string }[]> {
    const linhas = await tx.$queryRawUnsafe<{ loja: string; total: string }[]>(
      `
      SELECT lj.nome AS loja, sum(v.total)::text AS total
        FROM venda v
        JOIN loja lj ON lj.id = v.loja_id
       WHERE v.status = 'CONCLUIDA'
         AND (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
             > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
         ${recorte}
       GROUP BY lj.nome
       ORDER BY sum(v.total) DESC
      `,
      ...parametros,
    );

    const total = linhas.reduce((s, l) => s.plus(dec(l.total)), dec(0));

    return linhas.map((l) => ({
      loja: l.loja,
      total: dec(l.total).toFixed(2),
      participacao: total.greaterThan(0)
        ? dec(l.total).dividedBy(total).times(100).toFixed(1)
        : '0.0',
    }));
  }

  /**
   * O ranking, na dimensão escolhida.
   *
   * A margem sai do custo CONGELADO no item da venda. Usar o custo médio de
   * hoje faria a margem de março mudar toda vez que chegasse uma compra em
   * outubro — ver docs/COST_POLICY.md.
   */
  private async ranking(
    tx: ClienteEmTransacao,
    filtro: FiltroVendasRelatorio,
    recorte: string,
    parametros: unknown[],
    podeVerCusto: boolean,
  ): Promise<LinhaRanking[]> {
    const DE: Record<string, { juncao: string; nome: string }> = {
      vendedor: {
        juncao: 'JOIN usuario u ON u.id = v.vendedor_id',
        nome: 'u.nome',
      },
      produto: {
        juncao: 'JOIN variacao va ON va.id = i.variacao_id JOIN produto p ON p.id = va.produto_id',
        nome: 'p.nome',
      },
      cliente: {
        juncao: 'LEFT JOIN cliente cl ON cl.id = v.cliente_id',
        nome: "coalesce(cl.nome, 'Consumidor')",
      },
      tabela: {
        juncao: 'LEFT JOIN tabela_preco tp ON tp.id = i.tabela_preco_id',
        nome: "coalesce(tp.nome, 'Sem tabela')",
      },
      categoria: {
        juncao:
          'JOIN variacao va ON va.id = i.variacao_id JOIN produto p ON p.id = va.produto_id LEFT JOIN categoria c ON c.id = p.categoria_id',
        nome: "coalesce(c.nome, 'Sem categoria')",
      },
    };

    const escolha = DE[filtro.dimensao] ?? DE['vendedor']!;

    const linhas = await tx.$queryRawUnsafe<
      { nome: string; valor: string; quantidade: string; custo: string }[]
    >(
      `
      SELECT ${escolha.nome} AS nome,
             sum(i.total_item)::text AS valor,
             sum(i.quantidade)::text AS quantidade,
             sum(i.quantidade * i.custo_unitario)::text AS custo
        FROM venda_item i
        JOIN venda v ON v.id = i.venda_id
        ${escolha.juncao}
       WHERE v.status = 'CONCLUIDA'
         AND (v.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
             > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
         ${recorte}
       GROUP BY ${escolha.nome}
       ORDER BY sum(i.total_item) DESC
       LIMIT 12
      `,
      ...parametros,
    );

    const total = linhas.reduce((s, l) => s.plus(dec(l.valor)), dec(0));

    return linhas.map((l) => {
      const valor = dec(l.valor);
      return {
        nome: l.nome,
        valor: valor.toFixed(2),
        participacao: total.greaterThan(0) ? valor.dividedBy(total).times(100).toFixed(1) : '0.0',
        quantidade: dec(l.quantidade).toFixed(0),
        ...(podeVerCusto ? { margem: this.margem(valor, dec(l.custo)) } : {}),
      };
    });
  }
}
