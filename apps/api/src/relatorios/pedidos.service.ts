import { Inject, Injectable } from '@nestjs/common';
import type {
  FiltroConfirmacao,
  FiltroFila,
  RelatorioConfirmacao,
  RelatorioFila,
} from '@estoque/contracts';
import { dec } from '@estoque/core';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Os relatórios do ciclo do pedido.
 *
 * Vivem à parte dos relatórios de estoque e venda porque respondem outra
 * pergunta: não "quanto vendemos", mas "o que está travado e por quê".
 */

/**
 * As faixas de espera.
 *
 * Um tempo médio esconde o pedido esquecido há três dias. As faixas mostram
 * a cauda, que é onde mora o cliente irritado.
 */
const FAIXAS = [
  { nome: 'Menos de 1 h', ate: 1 },
  { nome: '1 a 4 h', ate: 4 },
  { nome: '4 a 24 h', ate: 24 },
  { nome: '1 a 3 dias', ate: 72 },
  { nome: 'Mais de 3 dias', ate: null },
] as const;

/** Desfechos possíveis de um pedido que saiu da fila. Ver docs/ORDERS.md §3. */
const DECIDIDOS = [
  'CONFIRMADO',
  'CONFIRMADO_PARCIALMENTE',
  'FATURADO',
  'CONCLUIDO',
  'DEVOLVIDO',
  'RECUSADO',
  'CANCELADO',
];

/** Os que valem como "deu certo" na taxa de confirmação. */
const CONFIRMADOS = ['CONFIRMADO', 'CONFIRMADO_PARCIALMENTE', 'FATURADO', 'CONCLUIDO'];

@Injectable()
export class RelatoriosPedidosService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Fila e tempo de confirmação
  // -------------------------------------------------------------------------

  /**
   * Quanto o pedido espera, e onde ele trava.
   *
   * A fila é AGORA — não tem período. O período vale só para o tempo já
   * medido: quanto demorou para confirmar o que foi confirmado.
   *
   * Espera do cliente e espera da equipe são filas diferentes, e somá-las
   * faria a equipe levar a culpa por um aumento que o cliente não aceitou.
   */
  async fila(filtro: FiltroFila): Promise<RelatorioFila> {
    return comEscopoAtual(this.prisma, async (tx) => {
      /*
        A fila e o tempo medido sao consultas com parametros diferentes: a
        fila e AGORA e nao usa `dias`. Passar o mesmo vetor para as tres faria
        o Postgres receber um parametro que a consulta nao declara.
      */
      const soLoja = filtro.lojaId ? [filtro.lojaId] : [];
      const recorteFila = filtro.lojaId ? 'AND p.loja_id = $1::uuid' : '';

      const recorte = filtro.lojaId ? 'AND p.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...soLoja];

      const [linhas, resumo, medido] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            id: string;
            numero: number;
            cliente: string;
            loja: string;
            enviado_em: Date;
            horas: string;
            valor: string;
            itens: bigint;
            valido_ate: Date | null;
            espera_cliente: boolean;
          }[]
        >(
          `
          SELECT p.id,
                 p.numero,
                 c.nome AS cliente,
                 lj.nome AS loja,
                 coalesce(p.enviado_em, p.criado_em) AS enviado_em,
                 floor(
                   extract(epoch FROM now() - coalesce(p.enviado_em, p.criado_em)) / 3600
                 )::text AS horas,
                 p.valor_solicitado::text AS valor,
                 (SELECT count(*) FROM pedido_item i
                   WHERE i.pedido_id = p.id AND i.removido_em IS NULL) AS itens,
                 p.valido_ate,
                 (p.status = 'AGUARDANDO_ACEITE_CLIENTE') AS espera_cliente
            FROM pedido p
            JOIN cliente c ON c.id = p.cliente_id
            JOIN loja lj ON lj.id = p.loja_id
           WHERE p.status IN ('AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_ACEITE_CLIENTE')
             ${recorteFila}
           ORDER BY coalesce(p.enviado_em, p.criado_em) ASC
           LIMIT ${String(filtro.limite)}
          `,
          ...soLoja,
        ),

        tx.$queryRawUnsafe<
          {
            na_fila: bigint;
            valor: string;
            mais_antigo: string | null;
            vencidos: bigint;
            espera_cliente: bigint;
          }[]
        >(
          `
          SELECT count(*) FILTER (WHERE p.status = 'AGUARDANDO_CONFIRMACAO') AS na_fila,
                 coalesce(
                   sum(p.valor_solicitado) FILTER (WHERE p.status = 'AGUARDANDO_CONFIRMACAO'),
                   0
                 )::text AS valor,
                 floor(extract(epoch FROM now() - min(coalesce(p.enviado_em, p.criado_em))
                   FILTER (WHERE p.status = 'AGUARDANDO_CONFIRMACAO')) / 3600)::text
                   AS mais_antigo,
                 count(*) FILTER (
                   WHERE p.status = 'AGUARDANDO_CONFIRMACAO' AND p.valido_ate < now()
                 ) AS vencidos,
                 count(*) FILTER (WHERE p.status = 'AGUARDANDO_ACEITE_CLIENTE')
                   AS espera_cliente
            FROM pedido p
           WHERE p.status IN ('AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_ACEITE_CLIENTE')
             ${recorteFila}
          `,
          ...soLoja,
        ),

        /*
          A mediana vai junto da média de propósito: uma confirmação esquecida
          por uma semana levanta a média e some na mediana. As duas lado a
          lado dizem se o atraso é regra ou exceção.
        */
        tx.$queryRawUnsafe<{ confirmados: bigint; media: string | null; mediana: string | null }[]>(
          `
          SELECT count(*) AS confirmados,
                 (avg(extract(epoch FROM p.confirmado_em - p.enviado_em)) / 3600)::text AS media,
                 (percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY extract(epoch FROM p.confirmado_em - p.enviado_em)
                  ) / 3600)::text AS mediana
            FROM pedido p
           WHERE p.confirmado_em IS NOT NULL
             AND p.enviado_em IS NOT NULL
             AND (p.confirmado_em AT TIME ZONE 'America/Sao_Paulo')::date
                 > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
             ${recorte}
          `,
          ...parametros,
        ),
      ]);

      const agora = Date.now();

      const naFila = linhas.filter((l) => !l.espera_cliente);
      const faixas = FAIXAS.map((f, i) => {
        const piso = i === 0 ? 0 : (FAIXAS[i - 1]?.ate ?? 0);
        const dentro = naFila.filter((l) => {
          const horas = Number(l.horas);
          return horas >= piso && (f.ate === null || horas < f.ate);
        });

        return {
          faixa: f.nome,
          pedidos: dentro.length,
          valor: dentro.reduce((s, l) => s.plus(dec(l.valor)), dec(0)).toFixed(2),
        };
      });

      const r = resumo[0];
      const m = medido[0];

      return {
        dias: filtro.dias,
        naFila: Number(r?.na_fila ?? 0),
        valorNaFila: dec(r?.valor ?? '0').toFixed(2),
        maisAntigoHoras: r?.mais_antigo == null ? null : Number(r.mais_antigo),
        precoVencido: Number(r?.vencidos ?? 0),
        esperandoCliente: Number(r?.espera_cliente ?? 0),
        confirmados: Number(m?.confirmados ?? 0),
        horasMedias: m?.media == null ? null : dec(m.media).toFixed(1),
        horasMediana: m?.mediana == null ? null : dec(m.mediana).toFixed(1),
        faixas,
        itens: linhas.map((l) => ({
          id: l.id,
          numero: l.numero,
          cliente: l.cliente,
          loja: l.loja,
          enviadoEm: l.enviado_em.toISOString(),
          horasNaFila: Number(l.horas),
          valorSolicitado: dec(l.valor).toFixed(2),
          itens: Number(l.itens),
          validoAte: l.valido_ate?.toISOString() ?? null,
          precoVencido: l.valido_ate !== null && l.valido_ate.getTime() < agora,
          esperaCliente: l.espera_cliente,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Taxa de confirmação
  // -------------------------------------------------------------------------

  /**
   * O que aconteceu com o que o cliente pediu.
   *
   * A taxa se mede sobre os pedidos DECIDIDOS, não sobre os enviados: um
   * pedido que chegou há dez minutos e ainda está na fila não é fracasso, é
   * pendência. Contá-lo como não confirmado faria a taxa piorar sozinha toda
   * vez que a loja recebesse pedido.
   */
  async confirmacao(filtro: FiltroConfirmacao): Promise<RelatorioConfirmacao> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND p.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      const janela = `
        p.enviado_em IS NOT NULL
        AND (p.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
        ${recorte}`;

      const [desfechos, porLoja] = await Promise.all([
        tx.$queryRawUnsafe<
          { status: string; pedidos: bigint; solicitado: string; confirmado: string }[]
        >(
          `
          SELECT p.status,
                 count(*) AS pedidos,
                 sum(p.valor_solicitado)::text AS solicitado,
                 sum(p.valor_confirmado)::text AS confirmado
            FROM pedido p
           WHERE ${janela}
           GROUP BY p.status
           ORDER BY count(*) DESC
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<
          {
            loja: string;
            enviados: bigint;
            decididos: bigint;
            confirmados: bigint;
            valor: string;
          }[]
        >(
          `
          SELECT lj.nome AS loja,
                 count(*) AS enviados,
                 count(*) FILTER (WHERE p.status::text = ANY($${String(parametros.length + 1)}::text[]))
                   AS decididos,
                 count(*) FILTER (WHERE p.status::text = ANY($${String(parametros.length + 2)}::text[]))
                   AS confirmados,
                 coalesce(
                   sum(p.valor_confirmado)
                     FILTER (WHERE p.status::text = ANY($${String(parametros.length + 2)}::text[])),
                   0
                 )::text AS valor
            FROM pedido p
            JOIN loja lj ON lj.id = p.loja_id
           WHERE ${janela}
           GROUP BY lj.nome
           ORDER BY count(*) DESC
          `,
          ...parametros,
          DECIDIDOS,
          CONFIRMADOS,
        ),
      ]);

      const enviados = desfechos.reduce((s, d) => s + Number(d.pedidos), 0);
      const decididos = desfechos
        .filter((d) => DECIDIDOS.includes(d.status))
        .reduce((s, d) => s + Number(d.pedidos), 0);
      const confirmados = desfechos
        .filter((d) => CONFIRMADOS.includes(d.status))
        .reduce((s, d) => s + Number(d.pedidos), 0);

      const solicitado = desfechos.reduce((s, d) => s.plus(dec(d.solicitado)), dec(0));
      const confirmado = desfechos
        .filter((d) => CONFIRMADOS.includes(d.status))
        .reduce((s, d) => s.plus(dec(d.confirmado)), dec(0));

      return {
        dias: filtro.dias,
        enviados,
        decididos,
        emAberto: enviados - decididos,
        taxaConfirmacao:
          decididos > 0 ? dec(confirmados).dividedBy(decididos).times(100).toFixed(1) : '0.0',
        valorSolicitado: solicitado.toFixed(2),
        valorConfirmado: confirmado.toFixed(2),
        aproveitamento: solicitado.greaterThan(0)
          ? confirmado.dividedBy(solicitado).times(100).toFixed(1)
          : '0.0',
        desfechos: desfechos.map((d) => ({
          status: d.status,
          pedidos: Number(d.pedidos),
          valor: dec(d.solicitado).toFixed(2),
          participacao:
            enviados > 0 ? dec(Number(d.pedidos)).dividedBy(enviados).times(100).toFixed(1) : '0.0',
        })),
        porLoja: porLoja.map((l) => {
          const decididosLoja = Number(l.decididos);
          const confirmadosLoja = Number(l.confirmados);

          return {
            loja: l.loja,
            enviados: Number(l.enviados),
            decididos: decididosLoja,
            confirmados: confirmadosLoja,
            taxa:
              decididosLoja > 0
                ? dec(confirmadosLoja).dividedBy(decididosLoja).times(100).toFixed(1)
                : '0.0',
            valorConfirmado: dec(l.valor).toFixed(2),
          };
        }),
      };
    });
  }
}
