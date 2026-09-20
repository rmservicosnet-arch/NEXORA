import { Inject, Injectable } from '@nestjs/common';
import type {
  FiltroAceites,
  FiltroAlteracoes,
  FiltroConfirmacao,
  FiltroFila,
  FiltroRuptura,
  LinhaAlteracao,
  RelatorioAceites,
  RelatorioAlteracoes,
  RelatorioConfirmacao,
  RelatorioFila,
  RelatorioRuptura,
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
        /*
          A primeira faixa nao tem PISO.

          Com `piso = 0`, um pedido cuja hora de envio esteja adiante do
          relogio do banco da `horas` negativo e nao cai em faixa NENHUMA — as
          cinco faixas somavam zero enquanto a fila tinha quatorze. As faixas
          cobrem a fila inteira por definicao; um buraco nelas e sempre erro.
        */
        const piso = i === 0 ? Number.NEGATIVE_INFINITY : (FAIXAS[i - 1]?.ate ?? 0);
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

  // -------------------------------------------------------------------------
  // Ruptura
  // -------------------------------------------------------------------------

  /**
   * Venda perdida por falta de estoque.
   *
   * O item devolvido por falta é o único lugar do sistema onde a demanda
   * aparece SEM a venda: o cliente pediu, a loja não tinha. Um relatório de
   * vendas jamais mostraria isso — ele só conhece o que saiu.
   *
   * O saldo de hoje vai junto porque repor é decisão com os dois números: o
   * que faltou e o que tem agora.
   */
  async ruptura(filtro: FiltroRuptura): Promise<RelatorioRuptura> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND p.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      /*
        A janela é a do PEDIDO, não a do item: o item não guarda quando foi
        enviado, e a falta pertence ao momento em que o cliente pediu.
      */
      const janela = `
        p.enviado_em IS NOT NULL
        AND (p.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
        ${recorte}`;

      /* Falta é o que foi pedido e não foi atendido — nem o devolvido por
         falta, nem a parte não confirmada de um item confirmado pela metade. */
      const faltou = `
        (i.status = 'DEVOLVIDO'
         OR (i.status = 'CONFIRMADO' AND i.quantidade_confirmada < i.quantidade_solicitada))
        AND i.removido_em IS NULL
        AND i.origem = 'SOLICITADO_CLIENTE'`;

      const [linhas, resumo] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            variacao_id: string;
            sku: string;
            produto: string;
            descricao: string;
            pedidos: bigint;
            solicitada: string;
            atendida: string;
            nao_atendida: string;
            valor: string;
            saldo: string;
            sem_saldo: bigint;
          }[]
        >(
          `
          SELECT v.id AS variacao_id,
                 v.sku,
                 pr.nome AS produto,
                 v.descricao,
                 count(DISTINCT i.pedido_id) AS pedidos,
                 sum(i.quantidade_solicitada)::text AS solicitada,
                 sum(i.quantidade_confirmada)::text AS atendida,
                 sum(i.quantidade_solicitada - i.quantidade_confirmada)::text AS nao_atendida,
                 sum((i.quantidade_solicitada - i.quantidade_confirmada) * i.preco_unitario)::text
                   AS valor,
                 coalesce((
                   SELECT sum(se.quantidade) FROM saldo_estoque se
                    WHERE se.variacao_id = v.id
                 ), 0)::text AS saldo,
                 count(*) FILTER (WHERE i.confirmado_sem_saldo) AS sem_saldo
            FROM pedido_item i
            JOIN pedido p ON p.id = i.pedido_id
            JOIN variacao v ON v.id = i.variacao_id
            JOIN produto pr ON pr.id = v.produto_id
           WHERE ${janela} AND ${faltou}
           GROUP BY v.id, v.sku, pr.nome, v.descricao
           ORDER BY sum((i.quantidade_solicitada - i.quantidade_confirmada) * i.preco_unitario) DESC
           LIMIT ${String(filtro.limite)}
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<{ itens: bigint; pedidos: bigint; valor: string; sem_saldo: bigint }[]>(
          `
          SELECT count(*) FILTER (WHERE ${faltou}) AS itens,
                 count(DISTINCT i.pedido_id) FILTER (WHERE ${faltou}) AS pedidos,
                 coalesce(sum(
                   (i.quantidade_solicitada - i.quantidade_confirmada) * i.preco_unitario
                 ) FILTER (WHERE ${faltou}), 0)::text AS valor,
                 count(*) FILTER (WHERE i.confirmado_sem_saldo) AS sem_saldo
            FROM pedido_item i
            JOIN pedido p ON p.id = i.pedido_id
           WHERE ${janela}
          `,
          ...parametros,
        ),
      ]);

      const r = resumo[0];

      return {
        dias: filtro.dias,
        itensEmFalta: Number(r?.itens ?? 0),
        pedidosAfetados: Number(r?.pedidos ?? 0),
        valorPerdido: dec(r?.valor ?? '0').toFixed(2),
        confirmadosSemSaldo: Number(r?.sem_saldo ?? 0),
        itens: linhas.map((l) => ({
          variacaoId: l.variacao_id,
          sku: l.sku,
          produto: l.produto,
          descricaoVariacao: l.descricao,
          pedidos: Number(l.pedidos),
          solicitada: dec(l.solicitada).toFixed(0),
          atendida: dec(l.atendida).toFixed(0),
          naoAtendida: dec(l.nao_atendida).toFixed(0),
          valorPerdido: dec(l.valor).toFixed(2),
          saldoAtual: dec(l.saldo).toFixed(0),
          confirmadoSemSaldo: Number(l.sem_saldo),
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Alterações pela equipe
  // -------------------------------------------------------------------------

  /**
   * O que a equipe incluiu e o que retirou do pedido do cliente.
   *
   * Remoção é LÓGICA: o item sai da conta e permanece na linha do tempo, com
   * autor e motivo. Remoção sem motivo escrito vai contada à parte — o acordo
   * com o cliente existiu, mas ninguém consegue mais dizer qual foi.
   */
  async alteracoes(filtro: FiltroAlteracoes): Promise<RelatorioAlteracoes> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND p.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      const janela = `
        (coalesce(i.removido_em, i.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date
        > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
        ${recorte}`;

      const tocado = `
        (i.origem = 'ADICIONADO_EQUIPE' OR i.removido_em IS NOT NULL)`;

      const [linhas, porAutor] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            id: string;
            pedido_id: string;
            numero: number;
            cliente: string;
            em: Date;
            removido: boolean;
            sku: string;
            produto: string;
            descricao: string;
            quantidade: string;
            valor: string;
            motivo: string | null;
            autor: string | null;
          }[]
        >(
          `
          SELECT i.id,
                 i.pedido_id,
                 p.numero,
                 c.nome AS cliente,
                 coalesce(i.removido_em, i.criado_em) AS em,
                 (i.removido_em IS NOT NULL) AS removido,
                 v.sku,
                 pr.nome AS produto,
                 v.descricao,
                 (CASE WHEN i.removido_em IS NOT NULL
                       THEN i.quantidade_solicitada
                       ELSE greatest(i.quantidade_confirmada, i.quantidade_solicitada)
                  END)::text AS quantidade,
                 i.total_item::text AS valor,
                 coalesce(i.motivo_remocao, p.resumo_alteracao) AS motivo,
                 u.nome AS autor
            FROM pedido_item i
            JOIN pedido p ON p.id = i.pedido_id
            JOIN cliente c ON c.id = p.cliente_id
            JOIN variacao v ON v.id = i.variacao_id
            JOIN produto pr ON pr.id = v.produto_id
            LEFT JOIN usuario u
              ON u.id = coalesce(i.removido_por_id, i.adicionado_por_id, p.editado_por_id)
           WHERE ${tocado} AND ${janela}
           ORDER BY coalesce(i.removido_em, i.criado_em) DESC
           LIMIT ${String(filtro.limite)}
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<
          {
            autor: string | null;
            inclusoes: bigint;
            remocoes: bigint;
            incluido: string;
            removido: string;
            sem_motivo: bigint;
            pedidos: bigint;
          }[]
        >(
          `
          SELECT u.nome AS autor,
                 count(*) FILTER (
                   WHERE i.origem = 'ADICIONADO_EQUIPE' AND i.removido_em IS NULL
                 ) AS inclusoes,
                 count(*) FILTER (WHERE i.removido_em IS NOT NULL) AS remocoes,
                 coalesce(sum(i.total_item) FILTER (
                   WHERE i.origem = 'ADICIONADO_EQUIPE' AND i.removido_em IS NULL
                 ), 0)::text AS incluido,
                 coalesce(sum(i.total_item) FILTER (WHERE i.removido_em IS NOT NULL), 0)::text
                   AS removido,
                 count(*) FILTER (
                   WHERE i.removido_em IS NOT NULL AND i.motivo_remocao IS NULL
                 ) AS sem_motivo,
                 count(DISTINCT i.pedido_id) AS pedidos
            FROM pedido_item i
            JOIN pedido p ON p.id = i.pedido_id
            LEFT JOIN usuario u
              ON u.id = coalesce(i.removido_por_id, i.adicionado_por_id, p.editado_por_id)
           WHERE ${tocado} AND ${janela}
           GROUP BY u.nome
           ORDER BY count(*) DESC
          `,
          ...parametros,
        ),
      ]);

      const soma = (campo: 'incluido' | 'removido') =>
        porAutor.reduce((acc, a) => acc.plus(dec(a[campo])), dec(0));

      const itens: LinhaAlteracao[] = linhas.map((l) => ({
        id: l.id,
        pedidoId: l.pedido_id,
        numero: l.numero,
        cliente: l.cliente,
        em: l.em.toISOString(),
        acao: l.removido ? 'REMOCAO' : 'INCLUSAO',
        sku: l.sku,
        produto: l.produto,
        descricaoVariacao: l.descricao,
        quantidade: dec(l.quantidade).toFixed(0),
        valor: dec(l.valor).toFixed(2),
        motivo: l.motivo,
        autor: l.autor,
      }));

      return {
        dias: filtro.dias,
        inclusoes: porAutor.reduce((acc, a) => acc + Number(a.inclusoes), 0),
        remocoes: porAutor.reduce((acc, a) => acc + Number(a.remocoes), 0),
        valorIncluido: soma('incluido').toFixed(2),
        valorRemovido: soma('removido').toFixed(2),
        pedidosTocados: porAutor.reduce((acc, a) => acc + Number(a.pedidos), 0),
        porAutor: porAutor.map((a) => ({
          // Sem usuário resolvido o item veio de uma edição antiga do pedido.
          autor: a.autor ?? 'Não identificado',
          inclusoes: Number(a.inclusoes),
          remocoes: Number(a.remocoes),
          valorIncluido: dec(a.incluido).toFixed(2),
          valorRemovido: dec(a.removido).toFixed(2),
          semMotivo: Number(a.sem_motivo),
        })),
        itens,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Aceites de cliente
  // -------------------------------------------------------------------------

  /**
   * Aumentos que precisaram do toque do cliente.
   *
   * Pendente não é recusa: a taxa se mede sobre os RESPONDIDOS. Um aumento
   * enviado há uma hora contado como recusado faria a equipe achar que o
   * cliente rejeita tudo.
   */
  async aceites(filtro: FiltroAceites): Promise<RelatorioAceites> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const recorte = filtro.lojaId ? 'AND p.loja_id = $2::uuid' : '';
      const parametros: unknown[] = [filtro.dias, ...(filtro.lojaId ? [filtro.lojaId] : [])];

      /*
        Quem pediu aceite é quem TEM a edição registrada, não quem está no
        status agora: o pedido já aceito seguiu para confirmado e sumiria do
        recorte se o filtro fosse pelo status.
      */
      const janela = `
        p.editado_pela_equipe_em IS NOT NULL
        AND (p.editado_pela_equipe_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
        AND EXISTS (
          SELECT 1 FROM pedido_evento e
           WHERE e.pedido_id = p.id AND e.para_status = 'AGUARDANDO_ACEITE_CLIENTE'
        )
        ${recorte}`;

      const linhas = await tx.$queryRawUnsafe<
        {
          id: string;
          numero: number;
          cliente: string;
          loja: string;
          pedido_em: Date;
          solicitado: string;
          confirmado: string;
          resumo: string | null;
          status: string;
          aceite_em: Date | null;
          horas: string | null;
        }[]
      >(
        `
        SELECT p.id,
               p.numero,
               c.nome AS cliente,
               lj.nome AS loja,
               p.editado_pela_equipe_em AS pedido_em,
               p.valor_solicitado::text AS solicitado,
               p.valor_confirmado::text AS confirmado,
               p.resumo_alteracao AS resumo,
               p.status::text AS status,
               p.aceite_cliente_em AS aceite_em,
               CASE WHEN p.aceite_cliente_em IS NOT NULL
                    THEN floor(extract(
                      epoch FROM p.aceite_cliente_em - p.editado_pela_equipe_em
                    ) / 3600)::text
               END AS horas
          FROM pedido p
          JOIN cliente c ON c.id = p.cliente_id
          JOIN loja lj ON lj.id = p.loja_id
         WHERE ${janela}
         ORDER BY p.editado_pela_equipe_em DESC
         LIMIT ${String(filtro.limite)}
        `,
        ...parametros,
      );

      const resumo = await tx.$queryRawUnsafe<
        {
          total: bigint;
          aceitos: bigint;
          recusados: bigint;
          pendentes: bigint;
          media: string | null;
        }[]
      >(
        `
        SELECT count(*) AS total,
               count(*) FILTER (WHERE p.aceite_cliente_em IS NOT NULL) AS aceitos,
               count(*) FILTER (
                 WHERE p.aceite_cliente_em IS NULL AND p.status = 'RECUSADO'
               ) AS recusados,
               count(*) FILTER (
                 WHERE p.status = 'AGUARDANDO_ACEITE_CLIENTE'
               ) AS pendentes,
               (avg(extract(
                  epoch FROM p.aceite_cliente_em - p.editado_pela_equipe_em
                )) / 3600)::text AS media
          FROM pedido p
         WHERE ${janela}
        `,
        ...parametros,
      );

      const r = resumo[0];
      const aceitos = Number(r?.aceitos ?? 0);
      const recusados = Number(r?.recusados ?? 0);
      const respondidos = aceitos + recusados;

      const desfechoDe = (l: (typeof linhas)[number]): 'ACEITO' | 'RECUSADO' | 'PENDENTE' => {
        if (l.aceite_em !== null) return 'ACEITO';
        if (l.status === 'AGUARDANDO_ACEITE_CLIENTE') return 'PENDENTE';
        if (l.status === 'RECUSADO') return 'RECUSADO';
        // Seguiu sem aceite registrado: a equipe desfez o aumento.
        return 'PENDENTE';
      };

      const aumentoDe = (l: (typeof linhas)[number]) => dec(l.confirmado).minus(dec(l.solicitado));

      const itens = linhas.map((l) => ({
        id: l.id,
        numero: l.numero,
        cliente: l.cliente,
        loja: l.loja,
        pedidoEm: l.pedido_em.toISOString(),
        valorSolicitado: dec(l.solicitado).toFixed(2),
        valorConfirmado: dec(l.confirmado).toFixed(2),
        aumento: aumentoDe(l).toFixed(2),
        resumoAlteracao: l.resumo,
        desfecho: desfechoDe(l),
        horasAte: l.horas === null ? null : Number(l.horas),
      }));

      const somaPor = (desfecho: 'ACEITO' | 'RECUSADO') =>
        itens
          .filter((i) => i.desfecho === desfecho)
          .reduce((acc, i) => acc.plus(dec(i.aumento)), dec(0));

      return {
        dias: filtro.dias,
        pedidosDeAceite: Number(r?.total ?? 0),
        aceitos,
        recusados,
        pendentes: Number(r?.pendentes ?? 0),
        taxaAceite:
          respondidos > 0 ? dec(aceitos).dividedBy(respondidos).times(100).toFixed(1) : '0.0',
        aumentoAceito: somaPor('ACEITO').toFixed(2),
        aumentoRecusado: somaPor('RECUSADO').toFixed(2),
        horasMedias: r?.media == null ? null : dec(r.media).toFixed(1),
        itens,
      };
    });
  }
}
