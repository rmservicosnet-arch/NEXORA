import { Inject, Injectable } from '@nestjs/common';
import type { FiltroVisaoGeral, VisaoGeral } from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, type ClienteEmTransacao, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

/** Quantos itens negativos e quantas vendas a tela mostra em lista. */
const NA_LISTA = 6;

/**
 * Os números da visão geral.
 *
 * Tudo agregado no BANCO. Trazer as vendas do período para somar em
 * JavaScript funcionaria com o seed e cairia na primeira loja de verdade —
 * e o `Decimal` do dinheiro atravessaria a rede para virar `number` no
 * caminho, que é exatamente o que o projeto não faz.
 */
@Injectable()
export class VisaoGeralService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async resumo(filtro: FiltroVisaoGeral): Promise<VisaoGeral> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const [porDia, hoje, ontem, semana, estoque, negativos, ultimas] = await Promise.all([
        this.serieDiaria(tx, filtro),
        this.somaDoDia(tx, filtro, 0),
        this.somaDoDia(tx, filtro, 1),
        this.ticketDaSemanaAnterior(tx, filtro),
        this.contagensDeEstoque(tx, filtro),
        this.itensNegativos(tx, filtro),
        this.ultimasVendas(tx, filtro),
      ]);

      const totalPeriodo = porDia.reduce((s, p) => s.plus(dec(p.total)), dec(0));
      const vendasPeriodo = porDia.reduce((s, p) => s + p.vendas, 0);

      return {
        vendasHoje: hoje.total,
        vendasOntem: ontem.total,
        // Ticket médio do PERÍODO, não do dia: um sábado fraco não pode
        // mover a referência contra a qual se compara.
        ticketMedio: vendasPeriodo > 0 ? totalPeriodo.dividedBy(vendasPeriodo).toFixed(2) : '0.00',
        ticketMedioSemanaAnterior: semana,
        porDia,
        totalDoPeriodo: totalPeriodo.toFixed(2),
        ...estoque,
        negativos,
        ultimasVendas: ultimas,
      };
    });
  }

  /**
   * A série por dia, agrupada no banco.
   *
   * `generate_series` preenche os dias sem venda: sem isso o gráfico pula
   * segunda-feira e a barra de terça encosta na de domingo, fingindo
   * continuidade onde houve um dia parado.
   */
  private async serieDiaria(
    tx: ClienteEmTransacao,
    filtro: FiltroVisaoGeral,
  ): Promise<{ dia: string; total: string; vendas: number }[]> {
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
         ${filtro.lojaId ? 'AND v.loja_id = $2::uuid' : ''}
       GROUP BY d.dia
       ORDER BY d.dia
      `,
      filtro.dias,
      ...(filtro.lojaId ? [filtro.lojaId] : []),
    );

    return linhas.map((l) => ({
      dia: l.dia.toISOString().slice(0, 10),
      total: dec(l.total).toFixed(2),
      vendas: Number(l.vendas),
    }));
  }

  /** Soma de um dia, contado para trás a partir de hoje. */
  private async somaDoDia(
    tx: ClienteEmTransacao,
    filtro: FiltroVisaoGeral,
    diasAtras: number,
  ): Promise<{ total: string }> {
    const linhas = await tx.$queryRawUnsafe<{ total: string }[]>(
      `
      SELECT coalesce(sum(total), 0)::text AS total
        FROM venda
       WHERE status = 'CONCLUIDA'
         AND (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
             = (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
         ${filtro.lojaId ? 'AND loja_id = $2::uuid' : ''}
      `,
      diasAtras,
      ...(filtro.lojaId ? [filtro.lojaId] : []),
    );

    return { total: dec(linhas[0]?.total ?? '0').toFixed(2) };
  }

  /** Ticket médio dos 7 dias anteriores aos 7 últimos — a referência. */
  private async ticketDaSemanaAnterior(
    tx: ClienteEmTransacao,
    filtro: FiltroVisaoGeral,
  ): Promise<string> {
    const linhas = await tx.$queryRawUnsafe<{ total: string; vendas: bigint }[]>(
      `
      SELECT coalesce(sum(total), 0)::text AS total, count(*) AS vendas
        FROM venda
       WHERE status = 'CONCLUIDA'
         AND (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date
             BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date - 13
                 AND (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7
         ${filtro.lojaId ? 'AND loja_id = $1::uuid' : ''}
      `,
      ...(filtro.lojaId ? [filtro.lojaId] : []),
    );

    const total = dec(linhas[0]?.total ?? '0');
    const vendas = Number(linhas[0]?.vendas ?? 0);
    return vendas > 0 ? total.dividedBy(vendas).toFixed(2) : '0.00';
  }

  private async contagensDeEstoque(
    tx: ClienteEmTransacao,
    filtro: FiltroVisaoGeral,
  ): Promise<{
    abaixoDoMinimo: number;
    variacoesNegativas: number;
    lojasComNegativo: number;
  }> {
    const linhas = await tx.$queryRawUnsafe<
      {
        abaixo: bigint;
        negativas: bigint;
        lojas: bigint;
      }[]
    >(
      `
      WITH por_variacao AS (
        SELECT s.variacao_id,
               sum(s.quantidade) AS saldo,
               max(v.estoque_minimo) AS minimo
          FROM saldo_estoque s
          JOIN variacao v ON v.id = s.variacao_id
          JOIN local_estoque l ON l.id = s.local_id
         WHERE v.status = 'ATIVO'
           ${filtro.lojaId ? 'AND l.loja_id = $1::uuid' : ''}
         GROUP BY s.variacao_id
      )
      SELECT
        count(*) FILTER (WHERE saldo >= 0 AND saldo < minimo) AS abaixo,
        count(*) FILTER (WHERE saldo < 0) AS negativas,
        (SELECT count(DISTINCT l.loja_id)
           FROM saldo_estoque s2
           JOIN local_estoque l ON l.id = s2.local_id
          WHERE s2.quantidade < 0
            ${filtro.lojaId ? 'AND l.loja_id = $1::uuid' : ''}) AS lojas
      FROM por_variacao
      `,
      ...(filtro.lojaId ? [filtro.lojaId] : []),
    );

    return {
      abaixoDoMinimo: Number(linhas[0]?.abaixo ?? 0),
      variacoesNegativas: Number(linhas[0]?.negativas ?? 0),
      lojasComNegativo: Number(linhas[0]?.lojas ?? 0),
    };
  }

  /**
   * Os negativos mais antigos primeiro.
   *
   * "Desde quando" é a data do movimento que levou o saldo abaixo de zero e
   * não foi revertido — é o que diz se isto é de hoje ou está parado há uma
   * semana. Sem essa data, a lista é só um inventário do problema.
   */
  private async itensNegativos(
    tx: ClienteEmTransacao,
    filtro: FiltroVisaoGeral,
  ): Promise<VisaoGeral['negativos']> {
    const linhas = await tx.$queryRawUnsafe<
      {
        variacao_id: string;
        sku: string;
        produto: string;
        local: string;
        loja: string;
        saldo: string;
        desde: Date | null;
      }[]
    >(
      `
      SELECT s.variacao_id, v.sku, p.nome AS produto,
             l.nome AS local, lj.nome AS loja,
             s.quantidade::text AS saldo,
             (SELECT min(m.criado_em)
                FROM movimento_estoque m
               WHERE m.variacao_id = s.variacao_id
                 AND m.local_id = s.local_id
                 AND m.saldo_negativo = true) AS desde
        FROM saldo_estoque s
        JOIN variacao v ON v.id = s.variacao_id
        JOIN produto p ON p.id = v.produto_id
        JOIN local_estoque l ON l.id = s.local_id
        JOIN loja lj ON lj.id = l.loja_id
       WHERE s.quantidade < 0
         ${filtro.lojaId ? 'AND lj.id = $1::uuid' : ''}
       ORDER BY s.quantidade ASC
       LIMIT ${String(NA_LISTA)}
      `,
      ...(filtro.lojaId ? [filtro.lojaId] : []),
    );

    return linhas.map((l) => ({
      variacaoId: l.variacao_id,
      sku: l.sku,
      produto: l.produto,
      local: l.local,
      loja: l.loja,
      saldo: dec(l.saldo).toFixed(0),
      desde: l.desde?.toISOString() ?? null,
    }));
  }

  private async ultimasVendas(
    tx: ClienteEmTransacao,
    filtro: FiltroVisaoGeral,
  ): Promise<VisaoGeral['ultimasVendas']> {
    const vendas = await tx.venda.findMany({
      where: { status: 'CONCLUIDA', ...(filtro.lojaId ? { lojaId: filtro.lojaId } : {}) },
      orderBy: { id: 'desc' },
      take: NA_LISTA,
      select: {
        id: true,
        numero: true,
        total: true,
        concluidaEm: true,
        cliente: { select: { nome: true } },
        vendedor: { select: { nome: true } },
        pagamentos: { select: { forma: true, valor: true } },
      },
    });

    return vendas.map((v) => {
      // A forma que pesou mais. Venda dividida entre PIX e dinheiro mostra a
      // maior — dizer "PIX + dinheiro" numa coluna estreita não informa.
      const maior = [...v.pagamentos].sort((a, b) =>
        dec(b.valor.toString()).minus(dec(a.valor.toString())).toNumber(),
      )[0];

      return {
        id: v.id,
        numero: v.numero,
        cliente: v.cliente?.nome ?? null,
        vendedor: v.vendedor.nome,
        pagamento: maior?.forma ?? null,
        total: dec(v.total.toString()).toFixed(2),
        concluidaEm: v.concluidaEm?.toISOString() ?? null,
      };
    });
  }
}
