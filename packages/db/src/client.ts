/**
 * Conexão da aplicação com o PostgreSQL.
 *
 * Aqui mora a trava que fecha o único buraco do desenho de isolamento.
 *
 * O `estoque_migrator` precisa de BYPASSRLS — as policies usam FORCE, que
 * alcança o dono da tabela, e sem BYPASSRLS nem a migração nem o seed
 * conseguiriam escrever. Isso cria um risco: alguém apontar a aplicação para
 * `DIRECT_URL` por engano e passar por cima do isolamento inteiro, sem
 * nenhum erro aparente.
 *
 * `criarPrisma()` **recusa-se a conectar** se o papel tiver BYPASSRLS, for
 * superusuário ou for dono de tabelas. Falha alta e cedo, na inicialização,
 * em vez de silenciosa e tarde, em produção.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated';

export class ConexaoPrivilegiadaError extends Error {
  readonly codigo = 'CONEXAO_PRIVILEGIADA';

  constructor(usuario: string, motivos: readonly string[]) {
    super(
      `A aplicação tentou conectar como "${usuario}", que ${motivos.join(', ')}. ` +
        'Com esse papel o Row-Level Security não vale, e o isolamento entre ' +
        'empresas deixa de existir. Use DATABASE_URL (estoque_app), não ' +
        'DIRECT_URL (estoque_migrator). Ver docs/TENANCY.md §2.',
    );
    this.name = 'ConexaoPrivilegiadaError';
  }
}

export interface OpcoesConexao {
  readonly url: string;
  /** Registra as consultas. Só em desenvolvimento. */
  readonly registrarConsultas?: boolean;
  /**
   * Dispensa a checagem de privilégio.
   *
   * Existe para o seed e para scripts de manutenção, que rodam com o
   * migrator de propósito. **Nunca** use na API.
   */
  readonly permitirPapelPrivilegiado?: boolean;
}

interface LinhaPapel {
  usuario: string;
  bypassrls: boolean;
  superusuario: boolean;
  tabelas_proprias: number;
}

/**
 * Confere o papel conectado antes de deixar a aplicação subir.
 *
 * Três perguntas, todas com a mesma consequência se a resposta for sim: o
 * RLS não protege nada.
 */
export async function exigirPapelSemPrivilegio(prisma: PrismaClient): Promise<void> {
  const linhas = await prisma.$queryRaw<LinhaPapel[]>`
    SELECT current_user::text AS usuario,
           r.rolbypassrls     AS bypassrls,
           r.rolsuper         AS superusuario,
           (SELECT count(*)::int
              FROM pg_tables
             WHERE schemaname = 'public'
               AND tableowner = current_user) AS tabelas_proprias
      FROM pg_roles r
     WHERE r.rolname = current_user
  `;

  const papel = linhas[0];
  if (!papel) {
    throw new ConexaoPrivilegiadaError('desconhecido', ['não pôde ser identificado']);
  }

  const motivos: string[] = [];
  if (papel.bypassrls) {
    motivos.push('tem BYPASSRLS');
  }
  if (papel.superusuario) {
    motivos.push('é superusuário');
  }
  if (papel.tabelas_proprias > 0) {
    motivos.push(`é dono de ${papel.tabelas_proprias} tabela(s)`);
  }

  if (motivos.length > 0) {
    throw new ConexaoPrivilegiadaError(papel.usuario, motivos);
  }
}

export async function criarPrisma(opcoes: OpcoesConexao): Promise<PrismaClient> {
  const adapter = new PrismaPg({ connectionString: opcoes.url });

  const prisma = new PrismaClient({
    adapter,
    log: opcoes.registrarConsultas ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

  if (!opcoes.permitirPapelPrivilegiado) {
    try {
      await exigirPapelSemPrivilegio(prisma);
    } catch (erro) {
      await prisma.$disconnect();
      throw erro;
    }
  }

  return prisma;
}

export { PrismaClient };
