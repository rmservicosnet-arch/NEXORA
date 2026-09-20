import { Inject, Injectable } from '@nestjs/common';
import type {
  FiltroAbertos,
  FiltroAjustes,
  FiltroLimite,
  RelatorioAbertos,
  RelatorioAjustes,
  RelatorioLimite,
} from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Os relatórios da conta corrente do cliente.
 *
 * Aqui o sinal importa: saldo negativo é dívida, e o razão guarda o sinal em
 * `sentido`. Nenhuma tela inverte nada — quem inverte esconde.
 */

/**
 * As faixas de atraso.
 *
 * A carteira não tem vencimento por lançamento, então o que se mede é há
 * quanto tempo o saldo está negativo sem voltar a zero. Chamar isso de
 * "vencido há 60 dias" seria inventar uma data que não existe.
 */
const FAIXAS = [
  { nome: 'Até 30 dias', ate: 30 },
  { nome: '31 a 60 dias', ate: 60 },
  { nome: '61 a 90 dias', ate: 90 },
  { nome: 'Mais de 90 dias', ate: null },
] as const;

/** Os tipos que criam dinheiro sem contrapartida. Ver docs/WALLET.md. */
const CRIAM_DINHEIRO = ['AJUSTE_CREDITO', 'AJUSTE_DEBITO', 'BONIFICACAO'];

@Injectable()
export class RelatoriosCarteiraService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Saldos em aberto
  // -------------------------------------------------------------------------

  /**
   * Quem deve, quanto e há quanto tempo.
   *
   * O "há quanto tempo" sai do razão: é a data do último movimento que deixou
   * o saldo em zero ou acima. Usar a data do primeiro débito daria "devendo
   * há dois anos" para quem quitou dez vezes no meio do caminho.
   */
  async abertos(filtro: FiltroAbertos): Promise<RelatorioAbertos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.$queryRawUnsafe<
        {
          cliente_id: string;
          cliente: string;
          saldo: string;
          limite: string;
          dias: string | null;
          ultimo_credito: Date | null;
          bloqueada: boolean;
        }[]
      >(
        `
        SELECT c.id AS cliente_id,
               c.nome AS cliente,
               ca.saldo::text,
               ca.limite_credito::text AS limite,
               (
                 SELECT floor(extract(epoch FROM now() - m.criado_em) / 86400)::text
                   FROM carteira_movimento m
                  WHERE m.carteira_id = ca.id AND m.saldo_posterior >= 0
                  ORDER BY m.criado_em DESC
                  LIMIT 1
               ) AS dias,
               (
                 SELECT m.criado_em FROM carteira_movimento m
                  WHERE m.carteira_id = ca.id AND m.sentido = 'CREDITO'
                  ORDER BY m.criado_em DESC
                  LIMIT 1
               ) AS ultimo_credito,
               ca.bloqueada_para_compra AS bloqueada
          FROM carteira ca
          JOIN cliente c ON c.id = ca.cliente_id
         WHERE ca.saldo < 0 AND ca.status = 'ATIVO'
         ORDER BY ca.saldo ASC
         LIMIT ${String(filtro.limite)}
        `,
      );

      const resumo = await tx.$queryRawUnsafe<
        { devedores: bigint; total: string; acima: bigint; bloqueadas: bigint }[]
      >(
        `
        SELECT count(*) AS devedores,
               coalesce(sum(ca.saldo), 0)::text AS total,
               count(*) FILTER (WHERE ca.saldo + ca.limite_credito < 0) AS acima,
               count(*) FILTER (WHERE ca.bloqueada_para_compra) AS bloqueadas
          FROM carteira ca
         WHERE ca.saldo < 0 AND ca.status = 'ATIVO'
        `,
      );

      const itens = linhas.map((l) => {
        const saldo = dec(l.saldo);
        const limite = dec(l.limite);

        return {
          clienteId: l.cliente_id,
          cliente: l.cliente,
          saldo: saldo.toFixed(2),
          limiteCredito: limite.toFixed(2),
          disponivel: saldo.plus(limite).toFixed(2),
          diasNegativo: l.dias === null ? null : Number(l.dias),
          ultimoCredito: l.ultimo_credito?.toISOString() ?? null,
          bloqueada: l.bloqueada,
        };
      });

      const faixas = FAIXAS.map((f, i) => {
        const piso = i === 0 ? 0 : (FAIXAS[i - 1]?.ate ?? 0);
        const dentro = itens.filter((l) => {
          // Sem data de virada, a dívida nasceu com a carteira: cai na última.
          const dias = l.diasNegativo ?? Number.MAX_SAFE_INTEGER;
          return dias >= piso && (f.ate === null || dias < f.ate);
        });

        return {
          faixa: f.nome,
          clientes: dentro.length,
          valor: dentro.reduce((s, l) => s.plus(dec(l.saldo)), dec(0)).toFixed(2),
        };
      });

      const r = resumo[0];

      return {
        devedores: Number(r?.devedores ?? 0),
        totalDevido: dec(r?.total ?? '0').toFixed(2),
        acimaDoLimite: Number(r?.acima ?? 0),
        bloqueadas: Number(r?.bloqueadas ?? 0),
        faixas,
        itens,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Acima do limite
  // -------------------------------------------------------------------------

  /**
   * Quem passou do limite, e com que autorização.
   *
   * `excedeu_limite` é gravado no movimento: passar do limite é permitido
   * quando autorizado, nunca silencioso. Este relatório é a contrapartida
   * disso — a autorização existe para ser revista depois.
   */
  async limite(filtro: FiltroLimite): Promise<RelatorioLimite> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const janela = `
        m.excedeu_limite
        AND (m.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int`;

      const [linhas, resumo, agora] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            id: string;
            em: Date;
            cliente: string;
            tipo: string;
            valor: string;
            saldo_posterior: string;
            limite: string;
            justificativa: string | null;
            ator: string | null;
          }[]
        >(
          `
          SELECT m.id,
                 m.criado_em AS em,
                 c.nome AS cliente,
                 m.tipo::text AS tipo,
                 m.valor::text,
                 m.saldo_posterior::text,
                 ca.limite_credito::text AS limite,
                 m.justificativa,
                 m.ator_nome AS ator
            FROM carteira_movimento m
            JOIN carteira ca ON ca.id = m.carteira_id
            JOIN cliente c ON c.id = ca.cliente_id
           WHERE ${janela}
           ORDER BY m.criado_em DESC
           LIMIT ${String(filtro.limite)}
          `,
          filtro.dias,
        ),

        tx.$queryRawUnsafe<
          { autorizacoes: bigint; valor: string; clientes: bigint; sem_justificativa: bigint }[]
        >(
          `
          SELECT count(*) AS autorizacoes,
                 coalesce(sum(m.valor), 0)::text AS valor,
                 count(DISTINCT ca.cliente_id) AS clientes,
                 count(*) FILTER (WHERE m.justificativa IS NULL) AS sem_justificativa
            FROM carteira_movimento m
            JOIN carteira ca ON ca.id = m.carteira_id
           WHERE ${janela}
          `,
          filtro.dias,
        ),

        /* Histórico e dívida viva são coisas diferentes: alguém pode ter
           passado do limite em março e já ter quitado. */
        tx.$queryRawUnsafe<{ acima: bigint }[]>(
          `
          SELECT count(*) AS acima
            FROM carteira ca
           WHERE ca.status = 'ATIVO' AND ca.saldo + ca.limite_credito < 0
          `,
        ),
      ]);

      const r = resumo[0];

      return {
        dias: filtro.dias,
        autorizacoes: Number(r?.autorizacoes ?? 0),
        valorAutorizado: dec(r?.valor ?? '0').toFixed(2),
        clientesAfetados: Number(r?.clientes ?? 0),
        acimaAgora: Number(agora[0]?.acima ?? 0),
        semJustificativa: Number(r?.sem_justificativa ?? 0),
        itens: linhas.map((l) => {
          const saldo = dec(l.saldo_posterior);
          const limite = dec(l.limite);
          const disponivel = saldo.plus(limite);

          return {
            id: l.id,
            em: l.em.toISOString(),
            cliente: l.cliente,
            tipo: l.tipo,
            valor: dec(l.valor).toFixed(2),
            saldoPosterior: saldo.toFixed(2),
            limiteCredito: limite.toFixed(2),
            // Quanto passou: sempre positivo, porque é "o quanto faltou".
            excedeuEm: disponivel.lessThan(0) ? disponivel.negated().toFixed(2) : '0.00',
            justificativa: l.justificativa,
            autorizadoPor: l.ator,
          };
        }),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Ajustes e bonificações
  // -------------------------------------------------------------------------

  /**
   * Os lançamentos que criam dinheiro sem contrapartida.
   *
   * Quitação tem dinheiro do outro lado; venda a prazo tem mercadoria. Ajuste
   * e bonificação não têm nada — só a assinatura de quem lançou. Por isso o
   * banco exige justificativa neles, e por isso este relatório existe.
   */
  async ajustes(filtro: FiltroAjustes): Promise<RelatorioAjustes> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const janela = `
        m.tipo::text = ANY($2::text[])
        AND (m.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int`;

      const [linhas, porAutor] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            id: string;
            em: Date;
            cliente: string;
            tipo: string;
            credito: boolean;
            valor: string;
            saldo_posterior: string;
            justificativa: string | null;
            ator: string | null;
          }[]
        >(
          `
          SELECT m.id,
                 m.criado_em AS em,
                 c.nome AS cliente,
                 m.tipo::text AS tipo,
                 (m.sentido = 'CREDITO') AS credito,
                 m.valor::text,
                 m.saldo_posterior::text,
                 m.justificativa,
                 m.ator_nome AS ator
            FROM carteira_movimento m
            JOIN carteira ca ON ca.id = m.carteira_id
            JOIN cliente c ON c.id = ca.cliente_id
           WHERE ${janela}
           ORDER BY m.criado_em DESC
           LIMIT ${String(filtro.limite)}
          `,
          filtro.dias,
          CRIAM_DINHEIRO,
        ),

        tx.$queryRawUnsafe<
          {
            autor: string | null;
            lancamentos: bigint;
            credito: string;
            debito: string;
            sem_justificativa: bigint;
          }[]
        >(
          `
          SELECT m.ator_nome AS autor,
                 count(*) AS lancamentos,
                 coalesce(sum(m.valor) FILTER (WHERE m.sentido = 'CREDITO'), 0)::text AS credito,
                 coalesce(sum(m.valor) FILTER (WHERE m.sentido = 'DEBITO'), 0)::text AS debito,
                 count(*) FILTER (WHERE m.justificativa IS NULL) AS sem_justificativa
            FROM carteira_movimento m
           WHERE ${janela}
           GROUP BY m.ator_nome
           ORDER BY count(*) DESC
          `,
          filtro.dias,
          CRIAM_DINHEIRO,
        ),
      ]);

      const credito = porAutor.reduce((s, a) => s.plus(dec(a.credito)), dec(0));
      const debito = porAutor.reduce((s, a) => s.plus(dec(a.debito)), dec(0));

      return {
        dias: filtro.dias,
        lancamentos: porAutor.reduce((s, a) => s + Number(a.lancamentos), 0),
        credito: credito.toFixed(2),
        debito: debito.toFixed(2),
        liquido: credito.minus(debito).toFixed(2),
        semJustificativa: porAutor.reduce((s, a) => s + Number(a.sem_justificativa), 0),
        porAutor: porAutor.map((a) => ({
          autor: a.autor ?? 'Não identificado',
          lancamentos: Number(a.lancamentos),
          credito: dec(a.credito).toFixed(2),
          debito: dec(a.debito).toFixed(2),
        })),
        itens: linhas.map((l) => ({
          id: l.id,
          em: l.em.toISOString(),
          cliente: l.cliente,
          tipo: l.tipo,
          credito: l.credito,
          valor: dec(l.valor).toFixed(2),
          saldoPosterior: dec(l.saldo_posterior).toFixed(2),
          justificativa: l.justificativa,
          autor: l.ator,
        })),
      };
    });
  }
}
