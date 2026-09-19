export {
  ConexaoPrivilegiadaError,
  PrismaClient,
  criarPrisma,
  exigirPapelSemPrivilegio,
  type OpcoesConexao,
} from './client';

export {
  SemContextoError,
  comContexto,
  contextoAtual,
  contextoDeSistema,
  exigirContexto,
  type Contexto,
  type PrincipalTipo,
} from './contexto';

export {
  comEscopo,
  comEscopoAtual,
  type ClienteEmTransacao,
  type OpcoesEscopo,
} from './escopo';

export { Prisma } from './generated';
