import { Inject, Injectable } from '@nestjs/common';
import type { FiltroFechamentos, RelatorioFechamentos } from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Fechamento de caixa: conferência e diferenças.
 *
 * `diferenca` é `contado − esperado` e nunca é ajustada em silêncio — fica
 * registrada como é. Este relatório é o lugar onde alguém olha para ela.
 */
@Injectable()
export class RelatoriosFechamentosService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async fechamentos(filtro: FiltroFechamentos): Promise<RelatorioFechamentos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const condicoes = [
        `(c.aberto_em AT TIME ZONE 'America/Sao_Paulo')::date
         > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int`,
      ];
      const parametros: unknown[] = [filtro.dias];

      if (filtro.lojaId) {
        parametros.push(filtro.lojaId);
        condicoes.push(`c.loja_id = $${String(parametros.length)}::uuid`);
      }

      const onde = condicoes.join(' AND ');
      // O recorte vale só para a LISTA: o resumo continua contando tudo.
      const recorteLista = filtro.apenasComDiferenca ? 'AND c.diferenca <> 0' : '';

      const [linhas, resumo] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            id: string;
            numero: number;
            loja: string;
            operador: string;
            aberto_em: Date;
            fechado_em: Date | null;
            status: string;
            abertura: string;
            esperado: string | null;
            contado: string | null;
            diferenca: string | null;
            conferido_por: string | null;
            observacao: string | null;
          }[]
        >(
          `
          SELECT c.id,
                 c.numero,
                 lj.nome AS loja,
                 u.nome AS operador,
                 c.aberto_em,
                 c.fechado_em,
                 c.status::text AS status,
                 c.valor_abertura::text AS abertura,
                 c.valor_esperado::text AS esperado,
                 c.valor_contado::text AS contado,
                 c.diferenca::text,
                 conf.nome AS conferido_por,
                 c.observacao_fechamento AS observacao
            FROM caixa c
            JOIN loja lj ON lj.id = c.loja_id
            JOIN usuario u ON u.id = c.operador_id
            LEFT JOIN usuario conf ON conf.id = c.conferido_por_id
           WHERE ${onde} ${recorteLista}
           ORDER BY c.aberto_em DESC
           LIMIT ${String(filtro.limite)}
          `,
          ...parametros,
        ),

        /*
          Falta e sobra contadas separadamente.

          Somadas, R$ 200 de falta e R$ 200 de sobra dariam zero numa loja
          onde dois operadores erram todo dia em direções opostas — e é
          exatamente essa loja que precisa do relatório.
        */
        tx.$queryRawUnsafe<
          {
            fechados: bigint;
            conferidos: bigint;
            abertos: bigint;
            com_diferenca: bigint;
            faltas: string;
            sobras: string;
            sem_conferencia: bigint;
          }[]
        >(
          `
          SELECT count(*) FILTER (WHERE c.status IN ('FECHADO', 'CONFERIDO')) AS fechados,
                 count(*) FILTER (WHERE c.status = 'CONFERIDO') AS conferidos,
                 count(*) FILTER (WHERE c.status = 'ABERTO') AS abertos,
                 count(*) FILTER (WHERE c.diferenca <> 0) AS com_diferenca,
                 coalesce(sum(c.diferenca) FILTER (WHERE c.diferenca < 0), 0)::text AS faltas,
                 coalesce(sum(c.diferenca) FILTER (WHERE c.diferenca > 0), 0)::text AS sobras,
                 count(*) FILTER (WHERE c.status = 'FECHADO') AS sem_conferencia
            FROM caixa c
           WHERE ${onde}
          `,
          ...parametros,
        ),
      ]);

      const r = resumo[0];

      return {
        dias: filtro.dias,
        fechados: Number(r?.fechados ?? 0),
        conferidos: Number(r?.conferidos ?? 0),
        abertos: Number(r?.abertos ?? 0),
        comDiferenca: Number(r?.com_diferenca ?? 0),
        faltas: dec(r?.faltas ?? '0').toFixed(2),
        sobras: dec(r?.sobras ?? '0').toFixed(2),
        semConferencia: Number(r?.sem_conferencia ?? 0),
        itens: linhas.map((l) => ({
          id: l.id,
          numero: l.numero,
          loja: l.loja,
          operador: l.operador,
          abertoEm: l.aberto_em.toISOString(),
          fechadoEm: l.fechado_em?.toISOString() ?? null,
          status: l.status,
          valorAbertura: dec(l.abertura).toFixed(2),
          valorEsperado: l.esperado === null ? null : dec(l.esperado).toFixed(2),
          valorContado: l.contado === null ? null : dec(l.contado).toFixed(2),
          diferenca: l.diferenca === null ? null : dec(l.diferenca).toFixed(2),
          conferidoPor: l.conferido_por,
          observacao: l.observacao,
        })),
      };
    });
  }
}
