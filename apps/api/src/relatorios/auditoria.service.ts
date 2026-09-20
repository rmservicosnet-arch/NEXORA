import { Inject, Injectable } from '@nestjs/common';
import type {
  FiltroAcessos,
  FiltroSensiveis,
  FiltroTrilha,
  LinhaTrilha,
  RelatorioAcessos,
  RelatorioSensiveis,
  RelatorioTrilha,
} from '@estoque/contracts';
import { comEscopoAtual, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Os relatórios sobre a própria trilha.
 *
 * `audit_log` é append-only: nada aqui altera, tudo aqui lê. É a única parte
 * do sistema cujo assunto é o próprio sistema.
 */

/**
 * As ações que mexem em dinheiro, preço ou histórico.
 *
 * Lista explícita, não prefixo: `acao LIKE 'CARTEIRA_%'` passaria a incluir
 * toda ação futura de carteira sem ninguém decidir isso — o mesmo erro do
 * curinga de permissão que já mordeu duas vezes.
 */
const SENSIVEIS = [
  'PRECOS_ALTERADOS',
  'PRECOS_DA_TABELA_ALTERADOS',
  'VENDA_CANCELADA',
  'ESTOQUE_CONTAGEM',
  'ESTOQUE_AJUSTE',
  'CARTEIRA_AJUSTE_CREDITO',
  'CARTEIRA_AJUSTE_DEBITO',
  'CARTEIRA_BONIFICACAO',
  'CARTEIRA_ESTORNO',
  'CARTEIRA_LIMITE_DEFINIDO',
  'CARTEIRA_BLOQUEADA',
  'CARTEIRA_DESBLOQUEADA',
  'PEDIDO_CONFIRMADO_SEM_SALDO',
  'SENHA_REDEFINIDA',
  'PRODUTO_EXCLUIDO',
  'IMAGEM_EXCLUIDA',
];

/** Eventos de segurança que não são exportação mas pertencem à mesma tela. */
const SEGURANCA = ['CROSS_TENANT_ATTEMPT', 'REUSO_DETECTADO', 'SENHA_REDEFINIDA'];

/** A ação gravada quando alguém baixa um CSV de relatório. */
export const ACAO_EXPORTACAO = 'RELATORIO_EXPORTADO';

/**
 * Colunas cuja presença significa que dinheiro saiu do sistema.
 *
 * Ancorado no começo do nome de propósito: `com_custo` é uma coluna que DIZ
 * se havia custo, e não o custo em si — a primeira versão marcava o próprio
 * relatório de auditoria como portador de custo.
 */
const COLUNA_DE_CUSTO = /^(custo|margem|valor|faturamento|liquido|bruto)/i;

interface LinhaBruta {
  id: string;
  em: Date;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  ator: string | null;
  ator_tipo: string;
  motivo: string | null;
  ip: string | null;
  antes: unknown;
  depois: unknown;
}

@Injectable()
export class RelatoriosAuditoriaService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Trilha por entidade
  // -------------------------------------------------------------------------

  /**
   * Tudo que aconteceu com um registro.
   *
   * Sem entidade escolhida a tela precisa oferecer as que existem — decorar
   * `movimento_estoque` para digitar no filtro não é interface, é senha.
   */
  async trilha(filtro: FiltroTrilha): Promise<RelatorioTrilha> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const condicoes = [
        `(a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
         > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int`,
      ];
      const parametros: unknown[] = [filtro.dias];

      if (filtro.entidade) {
        parametros.push(filtro.entidade);
        condicoes.push(`a.entidade = $${String(parametros.length)}`);
      }
      if (filtro.entidadeId) {
        parametros.push(filtro.entidadeId);
        condicoes.push(`a.entidade_id = $${String(parametros.length)}::uuid`);
      }

      const onde = condicoes.join(' AND ');

      const [linhas, entidades, total] = await Promise.all([
        tx.$queryRawUnsafe<LinhaBruta[]>(
          `
          SELECT a.id,
                 a.criado_em AS em,
                 a.acao,
                 a.entidade,
                 a.entidade_id,
                 a.ator_nome AS ator,
                 a.ator_tipo::text AS ator_tipo,
                 a.motivo,
                 a.ip,
                 a.antes,
                 a.depois
            FROM audit_log a
           WHERE ${onde}
           ORDER BY a.criado_em DESC
           LIMIT ${String(filtro.limite)}
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<{ entidade: string; registros: bigint }[]>(
          `
          SELECT a.entidade, count(*) AS registros
            FROM audit_log a
           WHERE (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
                 > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int
           GROUP BY a.entidade
           ORDER BY count(*) DESC
          `,
          filtro.dias,
        ),

        tx.$queryRawUnsafe<{ registros: bigint }[]>(
          `SELECT count(*) AS registros FROM audit_log a WHERE ${onde}`,
          ...parametros,
        ),
      ]);

      return {
        dias: filtro.dias,
        entidade: filtro.entidade ?? null,
        entidadeId: filtro.entidadeId ?? null,
        registros: Number(total[0]?.registros ?? 0),
        entidades: entidades.map((e) => ({
          entidade: e.entidade,
          registros: Number(e.registros),
        })),
        itens: linhas.map((l) => this.paraLinha(l)),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Ações sensíveis
  // -------------------------------------------------------------------------

  /**
   * Preço, ajuste, cancelamento, estorno.
   *
   * O que une estas ações é que nenhuma tem contrapartida automática: alguém
   * decidiu. Por isso o motivo importa, e o que falta motivo é contado.
   */
  async sensiveis(filtro: FiltroSensiveis): Promise<RelatorioSensiveis> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const parametros: unknown[] = [filtro.dias, filtro.acao ? [filtro.acao] : SENSIVEIS];

      const janela = `
        a.acao = ANY($2::text[])
        AND (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int`;

      const [linhas, porAcao, porAtor] = await Promise.all([
        tx.$queryRawUnsafe<LinhaBruta[]>(
          `
          SELECT a.id,
                 a.criado_em AS em,
                 a.acao,
                 a.entidade,
                 a.entidade_id,
                 a.ator_nome AS ator,
                 a.ator_tipo::text AS ator_tipo,
                 a.motivo,
                 a.ip,
                 a.antes,
                 a.depois
            FROM audit_log a
           WHERE ${janela}
           ORDER BY a.criado_em DESC
           LIMIT ${String(filtro.limite)}
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<{ acao: string; registros: bigint }[]>(
          `
          SELECT a.acao, count(*) AS registros
            FROM audit_log a
           WHERE ${janela}
           GROUP BY a.acao
           ORDER BY count(*) DESC
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<{ ator: string | null; registros: bigint; sem_motivo: bigint }[]>(
          `
          SELECT a.ator_nome AS ator,
                 count(*) AS registros,
                 count(*) FILTER (WHERE a.motivo IS NULL) AS sem_motivo
            FROM audit_log a
           WHERE ${janela}
           GROUP BY a.ator_nome
           ORDER BY count(*) DESC
          `,
          ...parametros,
        ),
      ]);

      return {
        dias: filtro.dias,
        registros: porAcao.reduce((s, a) => s + Number(a.registros), 0),
        atores: porAtor.length,
        semMotivo: porAtor.reduce((s, a) => s + Number(a.sem_motivo), 0),
        porAcao: porAcao.map((a) => ({ acao: a.acao, registros: Number(a.registros) })),
        porAtor: porAtor.map((a) => ({
          ator: a.ator ?? 'Sistema',
          registros: Number(a.registros),
          semMotivo: Number(a.sem_motivo),
        })),
        itens: linhas.map((l) => this.paraLinha(l)),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Acessos e exportações
  // -------------------------------------------------------------------------

  /**
   * Quem levou dado de custo ou de cliente.
   *
   * A exportação acontece no navegador: o CSV é montado lá e nunca passaria
   * pelo servidor. Por isso a tela AVISA o servidor antes de baixar — sem
   * esse aviso, este relatório seria uma tela em branco que parece dizer que
   * ninguém exportou nada.
   */
  async acessos(filtro: FiltroAcessos): Promise<RelatorioAcessos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const parametros: unknown[] = [filtro.dias, [ACAO_EXPORTACAO, ...SEGURANCA]];

      const janela = `
        a.acao = ANY($2::text[])
        AND (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
            > (now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int`;

      const [linhas, porAcao] = await Promise.all([
        tx.$queryRawUnsafe<LinhaBruta[]>(
          `
          SELECT a.id,
                 a.criado_em AS em,
                 a.acao,
                 a.entidade,
                 a.entidade_id,
                 a.ator_nome AS ator,
                 a.ator_tipo::text AS ator_tipo,
                 a.motivo,
                 a.ip,
                 a.antes,
                 a.depois
            FROM audit_log a
           WHERE ${janela}
           ORDER BY a.criado_em DESC
           LIMIT ${String(filtro.limite)}
          `,
          ...parametros,
        ),

        tx.$queryRawUnsafe<{ acao: string; registros: bigint }[]>(
          `
          SELECT a.acao, count(*) AS registros
            FROM audit_log a
           WHERE ${janela}
           GROUP BY a.acao
          `,
          ...parametros,
        ),
      ]);

      const conta = (acao: string) => Number(porAcao.find((a) => a.acao === acao)?.registros ?? 0);

      const itens = linhas.map((l) => {
        const detalhe = (l.depois ?? {}) as {
          relatorio?: string;
          colunas?: string[];
          linhas?: number;
        };
        const colunas = detalhe.colunas ?? [];

        return {
          id: l.id,
          em: l.em.toISOString(),
          acao: l.acao,
          ator: l.ator,
          ip: l.ip,
          relatorio: detalhe.relatorio ?? null,
          linhas: detalhe.linhas ?? null,
          // Custo saiu do sistema se alguma coluna exportada o carregava.
          comCusto: colunas.some((c) => COLUNA_DE_CUSTO.test(c)),
        };
      });

      const exportacoes = itens.filter((i) => i.acao === ACAO_EXPORTACAO);
      const porAtor = new Map<string, { exportacoes: number; comCusto: number }>();

      for (const e of exportacoes) {
        const chave = e.ator ?? 'Não identificado';
        const atual = porAtor.get(chave) ?? { exportacoes: 0, comCusto: 0 };
        atual.exportacoes += 1;
        if (e.comCusto) atual.comCusto += 1;
        porAtor.set(chave, atual);
      }

      return {
        dias: filtro.dias,
        exportacoes: conta(ACAO_EXPORTACAO),
        comCusto: exportacoes.filter((e) => e.comCusto).length,
        linhasExportadas: exportacoes.reduce((s, e) => s + (e.linhas ?? 0), 0),
        crossTenant: conta('CROSS_TENANT_ATTEMPT'),
        reusoDeToken: conta('REUSO_DETECTADO'),
        porAtor: [...porAtor.entries()]
          .map(([ator, v]) => ({ ator, ...v }))
          .sort((a, b) => b.exportacoes - a.exportacoes),
        itens,
      };
    });
  }

  /**
   * Antes e depois viram uma lista de campos que MUDARAM.
   *
   * Despejar os dois JSON na tela faz quem audita comparar chave a chave, e
   * é exatamente aí que a alteração passa despercebida.
   */
  private paraLinha(l: LinhaBruta): LinhaTrilha {
    const antes = (l.antes ?? {}) as Record<string, unknown>;
    const depois = (l.depois ?? {}) as Record<string, unknown>;

    const campos = [...new Set([...Object.keys(antes), ...Object.keys(depois)])];
    const texto = (v: unknown): string => {
      if (v === undefined || v === null) return '—';
      if (typeof v === 'object') return JSON.stringify(v).slice(0, 120);
      return String(v).slice(0, 120);
    };

    return {
      id: l.id,
      em: l.em.toISOString(),
      acao: l.acao,
      entidade: l.entidade,
      entidadeId: l.entidade_id,
      ator: l.ator,
      atorTipo: l.ator_tipo,
      motivo: l.motivo,
      ip: l.ip,
      mudancas: campos
        .filter((c) => texto(antes[c]) !== texto(depois[c]))
        .slice(0, 12)
        .map((campo) => ({ campo, antes: texto(antes[campo]), depois: texto(depois[campo]) })),
    };
  }
}
