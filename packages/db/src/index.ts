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

export {
  PARAMETROS_SENHA,
  SenhaFracaError,
  TAMANHO_MINIMO_SENHA,
  conferirSenha,
  gerarHashSenha,
} from './senha';

export { Prisma } from '../generated';
