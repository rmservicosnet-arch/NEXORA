import { Inject, Injectable } from '@nestjs/common';
import type {
  FiltroPosicao,
  FiltroVendasRelatorio,
  LinhaPosicao,
  LinhaRanking,
  PosicaoEstoque,
  RelatorioVendas,
} from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import { comEscopoAtual, type ClienteEmTransacao, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

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
