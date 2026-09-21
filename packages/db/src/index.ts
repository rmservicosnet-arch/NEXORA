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

export { comEscopo, comEscopoAtual, type ClienteEmTransacao, type OpcoesEscopo } from './escopo';

export {
  PARAMETROS_SENHA,
  SenhaFracaError,
  TAMANHO_MINIMO_SENHA,
  conferirSenha,
  gerarHashSenha,
} from './senha';

export { Prisma } from '../generated';

/*
  O catalogo de permissoes e os perfis de sistema.

  Estava em `prisma/permissoes.ts`, fora de `src`: o `tsc` nao o copiava para
  `dist`, entao so quem o importava por caminho relativo o alcancava — o seed
  e um script. A API precisa dele para criar os perfis de uma empresa nova, e
  a unica forma de importar de fora do build e nao importar.
*/
export {
  CHAVES_PERMISSAO,
  PERFIS,
  PERMISSOES,
  type DefinicaoPerfil,
  type DefinicaoPermissao,
} from './permissoes';
