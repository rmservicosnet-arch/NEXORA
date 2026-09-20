import type {
  FiltroAging,
  FiltroAReceber,
  FiltroComprasFornecedor,
  FiltroCustoAquisicao,
  FiltroFluxo,
  RelatorioAging,
  RelatorioAReceber,
  RelatorioComprasFornecedor,
  RelatorioCustoAquisicao,
  RelatorioFluxo,
} from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';
import { Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Os relatórios que esperavam Compras e Contas existirem.
 *
 * Eram os dois grupos marcados "Fase 5" no índice dos 36.
 */

/**
 * As faixas de aging.
 *
 * "A vencer" vem PRIMEIRO de propósito: é o que ainda dá para organizar. As
 * três seguintes medem atraso, e a última não tem teto — é onde mora o que
 * provavelmente não vai ser pago.
 */
const FAIXAS = [
  { nome: 'A vencer', de: null as number | null, ate: 0 },
  { nome: '1 a 30 dias', de: 1, ate: 30 },
  { nome: '31 a 60 dias', de: 31, ate: 60 },
  { nome: 'Mais de 60 dias', de: 61, ate: null as number | null },
] as const;

@Injectable()
export class RelatoriosFase5Service {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Aging — a pagar e a receber por vencimento
  // -------------------------------------------------------------------------

  /**
   * Quanto se deve (ou se tem a receber), por quanto tempo já venceu.
   *
   * Soma `valor − pago`, nunca o valor cheio: um título de 9.600 com 4.743 já
   * pagos pesa 4.856 no que falta. Somar o cheio mostraria uma dívida que já
   * não existe.
   */
  async aging(filtro: FiltroAging): Promise<RelatorioAging> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.$queryRawUnsafe<
        {
          contraparte_id: string | null;
          contraparte: string;
          dias: string;
          aberto: string;
          titulos: bigint;
        }[]
      >(
        `
        SELECT coalesce(t.fornecedor_id, t.cliente_id)::text AS contraparte_id,
               coalesce(f.nome, c.nome, 'lançado à mão')     AS contraparte,
               (CURRENT_DATE - t.vencimento)::text           AS dias,
               sum(t.valor - t.valor_pago)::text             AS aberto,
               count(*)                                      AS titulos
          FROM titulo_financeiro t
          LEFT JOIN fornecedor f ON f.id = t.fornecedor_id
          LEFT JOIN cliente    c ON c.id = t.cliente_id
         WHERE t.tipo = $1::"TipoTitulo"
           AND t.status = 'ABERTO'
         GROUP BY 1, 2, 3
        `,
        filtro.tipo,
      );

      const porContraparte = new Map<
        string,
        {
          contraparteId: string | null;
          contraparte: string;
          faixas: ReturnType<typeof dec>[];
          titulos: number;
          atraso: number | null;
        }
      >();

      const totaisPorFaixa = FAIXAS.map(() => dec(0));
      const titulosPorFaixa = FAIXAS.map(() => 0);

      for (const linha of linhas) {
        const dias = Number(linha.dias);
        const valor = dec(linha.aberto);
        const quantos = Number(linha.titulos);

        const indice = FAIXAS.findIndex(
          (f) => (f.de === null || dias >= f.de) && (f.ate === null || dias <= f.ate),
        );
        // Toda linha cai em alguma faixa: a primeira não tem piso e a última
        // não tem teto. Um buraco aqui seria sempre erro.
        const i = indice === -1 ? 0 : indice;

        totaisPorFaixa[i] = totaisPorFaixa[i]!.plus(valor);
        titulosPorFaixa[i] = titulosPorFaixa[i]! + quantos;

        const chave = linha.contraparte;
        const atual = porContraparte.get(chave) ?? {
          contraparteId: linha.contraparte_id,
          contraparte: linha.contraparte,
          faixas: FAIXAS.map(() => dec(0)),
          titulos: 0,
          atraso: null as number | null,
        };

        atual.faixas[i] = atual.faixas[i]!.plus(valor);
        atual.titulos += quantos;
        if (dias > 0 && (atual.atraso === null || dias > atual.atraso)) {
          atual.atraso = dias;
        }

        porContraparte.set(chave, atual);
      }

      const itens = [...porContraparte.values()]
        .map((c) => ({
          contraparteId: c.contraparteId,
          contraparte: c.contraparte,
          porFaixa: c.faixas.map((v) => v.toFixed(2)),
          total: c.faixas.reduce((s, v) => s.plus(v), dec(0)).toFixed(2),
          titulos: c.titulos,
          atrasoMaisAntigo: c.atraso,
        }))
        // Do maior devedor para o menor: é a ordem em que se decide quem
        // cobrar primeiro.
        .sort((a, b) => Number(b.total) - Number(a.total))
        .slice(0, filtro.limite);

      const total = totaisPorFaixa.reduce((s, v) => s.plus(v), dec(0));
      const aVencer = totaisPorFaixa[0] ?? dec(0);

      return {
        tipo: filtro.tipo,
        faixas: FAIXAS.map((f, i) => ({
          faixa: f.nome,
          titulos: titulosPorFaixa[i] ?? 0,
          valor: (totaisPorFaixa[i] ?? dec(0)).toFixed(2),
        })),
        itens,
        total: total.toFixed(2),
        totalTitulos: titulosPorFaixa.reduce((s, v) => s + v, 0),
        vencido: total.minus(aVencer).toFixed(2),
        aVencer: aVencer.toFixed(2),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Fluxo de caixa realizado
  // -------------------------------------------------------------------------

  /**
   * O que entrou e o que saiu, dia a dia.
   *
   * REALIZADO: só baixa que aconteceu. Título em aberto com vencimento no
   * período NÃO entra — ele é promessa, e misturar promessa com dinheiro que
   * passou faz o fluxo mentir exatamente no mês em que ninguém pagou.
   */
  async fluxo(filtro: FiltroFluxo): Promise<RelatorioFluxo> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.$queryRawUnsafe<{ dia: string; entrou: string; saiu: string }[]>(
        `
        SELECT b.pago_em::text AS dia,
               coalesce(sum(b.valor) FILTER (WHERE t.tipo = 'RECEBER'), 0)::text AS entrou,
               coalesce(sum(b.valor) FILTER (WHERE t.tipo = 'PAGAR'), 0)::text   AS saiu
          FROM baixa_titulo b
          JOIN titulo_financeiro t ON t.id = b.titulo_id
         WHERE b.pago_em > CURRENT_DATE - $1::int
         GROUP BY 1
         ORDER BY 1 ASC
        `,
        filtro.dias,
      );

      let entrou = dec(0);
      let saiu = dec(0);

      const dias = linhas.map((l) => {
        const e = dec(l.entrou);
        const s = dec(l.saiu);
        entrou = entrou.plus(e);
        saiu = saiu.plus(s);

        return {
          dia: l.dia,
          entrou: e.toFixed(2),
          saiu: s.toFixed(2),
          liquido: e.minus(s).toFixed(2),
        };
      });

      return {
        dias,
        entrou: entrou.toFixed(2),
        saiu: saiu.toFixed(2),
        liquido: entrou.minus(saiu).toFixed(2),
        observacao:
          'Realizado: só baixas que aconteceram. Título em aberto com vencimento no período não entra aqui — ele é promessa, não dinheiro que passou.',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Compras por fornecedor
  // -------------------------------------------------------------------------

  async comprasPorFornecedor(filtro: FiltroComprasFornecedor): Promise<RelatorioComprasFornecedor> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.$queryRawUnsafe<
        {
          fornecedor_id: string;
          fornecedor: string;
          notas: bigint;
          itens: bigint;
          unidades: string;
          valor: string;
          prazo_medio: string | null;
          ultima_compra: string | null;
        }[]
      >(
        `
        SELECT f.id::text   AS fornecedor_id,
               f.nome       AS fornecedor,
               count(DISTINCT c.id)                      AS notas,
               count(i.id)                               AS itens,
               coalesce(sum(i.quantidade), 0)::text      AS unidades,
               coalesce(sum(i.total), 0)::text           AS valor,
               -- O prazo só existe quando a nota tem emissão. Sem ela, zero
               -- diria "chegou no mesmo dia", que é uma afirmação falsa.
               avg(
                 EXTRACT(epoch FROM c.recebida_em - c.emitida_em) / 86400
               ) FILTER (WHERE c.emitida_em IS NOT NULL)::text AS prazo_medio,
               max(c.recebida_em)::text                  AS ultima_compra
          FROM compra c
          JOIN fornecedor f ON f.id = c.fornecedor_id
          LEFT JOIN compra_item i ON i.compra_id = c.id
         WHERE c.status = 'RECEBIDA'
           AND c.recebida_em > now() - ($1::int * INTERVAL '1 day')
         GROUP BY 1, 2
         ORDER BY 6 DESC
         LIMIT $2::int
        `,
        filtro.dias,
        filtro.limite,
      );

      const total = linhas.reduce((s, l) => s.plus(dec(l.valor)), dec(0));

      return {
        itens: linhas.map((l) => ({
          fornecedorId: l.fornecedor_id,
          fornecedor: l.fornecedor,
          notas: Number(l.notas),
          itens: Number(l.itens),
          unidades: dec(l.unidades).toFixed(2),
          valor: dec(l.valor).toFixed(2),
          participacao: total.isZero()
            ? '0.00'
            : dec(l.valor).dividedBy(total).times(100).toFixed(2),
          prazoMedio: l.prazo_medio === null ? null : Number(dec(l.prazo_medio).toFixed(1)),
          ultimaCompra: l.ultima_compra,
        })),
        total: total.toFixed(2),
        totalNotas: linhas.reduce((s, l) => s + Number(l.notas), 0),
        fornecedores: linhas.length,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Evolução do custo de aquisição
  // -------------------------------------------------------------------------

  /**
   * Quanto o item custava e quanto custa agora.
   *
   * Sai do `compra_item`, não do custo médio: a média mistura entradas de
   * datas e fornecedores diferentes. O que se quer saber aqui é o que o
   * fornecedor COBROU, nota a nota.
   */
  async custoDeAquisicao(filtro: FiltroCustoAquisicao): Promise<RelatorioCustoAquisicao> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const parametros: unknown[] = [filtro.dias];
      let recorte = '';
      if (filtro.variacaoId) {
        parametros.push(filtro.variacaoId);
        recorte = `AND i.variacao_id = $${String(parametros.length)}::uuid`;
      }
      parametros.push(filtro.limite);
      const posLimite = parametros.length;

      const linhas = await tx.$queryRawUnsafe<
        {
          variacao_id: string;
          sku: string;
          produto: string;
          descricao: string;
          compras: bigint;
          primeiro_custo: string;
          ultimo_custo: string;
          menor_custo: string;
          maior_custo: string;
          primeira_em: string;
          ultima_em: string;
          ultimo_fornecedor: string;
        }[]
      >(
        `
        WITH entradas AS (
          SELECT i.variacao_id,
                 i.custo_unitario,
                 c.recebida_em,
                 f.nome AS fornecedor,
                 row_number() OVER (PARTITION BY i.variacao_id ORDER BY c.recebida_em ASC)  AS primeira,
                 row_number() OVER (PARTITION BY i.variacao_id ORDER BY c.recebida_em DESC) AS ultima
            FROM compra_item i
            JOIN compra c     ON c.id = i.compra_id
            JOIN fornecedor f ON f.id = c.fornecedor_id
           WHERE c.status = 'RECEBIDA'
             AND c.recebida_em > now() - ($1::int * INTERVAL '1 day')
             ${recorte}
        )
        SELECT e.variacao_id::text AS variacao_id,
               v.sku,
               p.nome        AS produto,
               v.descricao,
               count(*)      AS compras,
               max(e.custo_unitario) FILTER (WHERE e.primeira = 1)::text AS primeiro_custo,
               max(e.custo_unitario) FILTER (WHERE e.ultima = 1)::text   AS ultimo_custo,
               min(e.custo_unitario)::text                               AS menor_custo,
               max(e.custo_unitario)::text                               AS maior_custo,
               min(e.recebida_em)::text                                  AS primeira_em,
               max(e.recebida_em)::text                                  AS ultima_em,
               max(e.fornecedor) FILTER (WHERE e.ultima = 1)             AS ultimo_fornecedor
          FROM entradas e
          JOIN variacao v ON v.id = e.variacao_id
          JOIN produto  p ON p.id = v.produto_id
         GROUP BY 1, 2, 3, 4
        HAVING count(*) > 0
         ORDER BY abs(
                   max(e.custo_unitario) FILTER (WHERE e.ultima = 1)
                 - max(e.custo_unitario) FILTER (WHERE e.primeira = 1)
                 ) DESC
         LIMIT $${String(posLimite)}::int
        `,
        ...parametros,
      );

      let subiram = 0;
      let cairam = 0;
      let estaveis = 0;

      const itens = linhas.map((l) => {
        const primeiro = dec(l.primeiro_custo);
        const ultimo = dec(l.ultimo_custo);

        if (ultimo.greaterThan(primeiro)) subiram += 1;
        else if (ultimo.lessThan(primeiro)) cairam += 1;
        else estaveis += 1;

        return {
          variacaoId: l.variacao_id,
          sku: l.sku,
          produto: l.produto,
          descricaoVariacao: l.descricao,
          compras: Number(l.compras),
          primeiroCusto: primeiro.toFixed(6),
          ultimoCusto: ultimo.toFixed(6),
          menorCusto: dec(l.menor_custo).toFixed(6),
          maiorCusto: dec(l.maior_custo).toFixed(6),
          // Primeiro custo zero não dá variação: dividir por zero seria
          // infinito, e "subiu infinito%" não diz nada a ninguém.
          variacaoPercentual: primeiro.isZero()
            ? null
            : ultimo.minus(primeiro).dividedBy(primeiro).times(100).toFixed(2),
          primeiraCompraEm: l.primeira_em,
          ultimaCompraEm: l.ultima_em,
          ultimoFornecedor: l.ultimo_fornecedor,
        };
      });

      return { itens, subiram, cairam, estaveis };
    });
  }

  // -------------------------------------------------------------------------
  // Notas a receber
  // -------------------------------------------------------------------------

  /**
   * Nota lançada e mercadoria que não entrou.
   *
   * É a fila de trabalho do depósito, e o "dias parada" é o que a torna útil:
   * uma nota de três semanas em rascunho é mercadoria perdida ou digitação
   * esquecida, e nos dois casos alguém precisa olhar.
   */
  async notasAReceber(filtro: FiltroAReceber): Promise<RelatorioAReceber> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.$queryRawUnsafe<
        {
          compra_id: string;
          numero_nota: string | null;
          fornecedor: string;
          local: string;
          loja: string;
          emitida_em: string | null;
          dias: string | null;
          itens: bigint;
          unidades: string;
          valor: string;
        }[]
      >(
        `
        SELECT c.id::text        AS compra_id,
               c.numero_nota,
               f.nome            AS fornecedor,
               l.nome            AS local,
               lj.nome           AS loja,
               c.emitida_em::text,
               CASE WHEN c.emitida_em IS NULL THEN NULL
                    ELSE floor(EXTRACT(epoch FROM now() - c.emitida_em) / 86400)::text
               END               AS dias,
               count(i.id)       AS itens,
               coalesce(sum(i.quantidade), 0)::text AS unidades,
               c.valor_total::text AS valor
          FROM compra c
          JOIN fornecedor f    ON f.id = c.fornecedor_id
          JOIN local_estoque l ON l.id = c.local_id
          JOIN loja lj         ON lj.id = c.loja_id
          LEFT JOIN compra_item i ON i.compra_id = c.id
         WHERE c.status = 'RASCUNHO'
         GROUP BY c.id, c.numero_nota, f.nome, l.nome, lj.nome, c.emitida_em, c.valor_total
         ORDER BY c.emitida_em ASC NULLS LAST
         LIMIT $1::int
        `,
        filtro.limite,
      );

      const itens = linhas.map((l) => ({
        compraId: l.compra_id,
        numeroNota: l.numero_nota,
        fornecedor: l.fornecedor,
        local: l.local,
        loja: l.loja,
        emitidaEm: l.emitida_em,
        diasParada: l.dias === null ? null : Number(l.dias),
        itens: Number(l.itens),
        unidades: dec(l.unidades).toFixed(2),
        valor: dec(l.valor).toFixed(2),
      }));

      /*
        O indicador conta o CONJUNTO, não a página: um "3 paradas há mais de
        15 dias" que muda com o `limite` é um número que mente.
      */
      const [resumo] = await tx.$queryRawUnsafe<{ total: string; notas: bigint; velhas: bigint }[]>(
        `
        SELECT coalesce(sum(valor_total), 0)::text AS total,
               count(*)                            AS notas,
               count(*) FILTER (
                 WHERE emitida_em IS NOT NULL
                   AND emitida_em < now() - INTERVAL '15 days'
               )                                   AS velhas
          FROM compra
         WHERE status = 'RASCUNHO'
        `,
      );

      return {
        itens,
        total: dec(resumo?.total ?? '0').toFixed(2),
        notas: Number(resumo?.notas ?? 0),
        paradasHaMais15: Number(resumo?.velhas ?? 0),
      };
    });
  }
}
