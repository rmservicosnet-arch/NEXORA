/**
 * Os três domínios de autenticação — ADR-009, estendido pelo ADR-011.
 *
 * Funcionário, cliente e plataforma não são "tipos de usuário": são
 * principais diferentes, com tabelas, rotas de login e segredos de
 * assinatura próprios.
 *
 * A claim `aud` é o que os separa. Um token de cliente é **estruturalmente
 * incapaz** de passar no guard de funcionário: a audiência não confere e o
 * segredo também não. A garantia não depende de ninguém lembrar de filtrar
 * por um campo `tipo` numa consulta.
 *
 * O terceiro chegou com a administração da plataforma, e ele é diferente dos
 * outros dois num ponto que decide o desenho inteiro: **não tem empresa**.
 * Não é um funcionário com uma bandeira — um funcionário marcado assim
 * continuaria preso a um tenant, e aí quem criaria a primeira empresa?
 */

export const DOMINIO_FUNCIONARIO = 'funcionario' as const;
export const DOMINIO_CLIENTE = 'cliente' as const;
export const DOMINIO_PLATAFORMA = 'plataforma' as const;

export type Dominio =
  typeof DOMINIO_FUNCIONARIO | typeof DOMINIO_CLIENTE | typeof DOMINIO_PLATAFORMA;

/**
 * Os dois domínios que vivem DENTRO de uma empresa.
 *
 * Existe como tipo próprio para o compilador cobrar: `PayloadAcesso` exige
 * `tid`, e um token de plataforma não tem o que pôr ali. Sem esta separação
 * o `tid` viraria opcional para todo mundo — e ele é a única origem confiável
 * da empresa.
 */
export type DominioComEmpresa = typeof DOMINIO_FUNCIONARIO | typeof DOMINIO_CLIENTE;

/** Conteúdo do token de acesso. Deliberadamente enxuto. */
export interface PayloadAcesso {
  /** Id do `usuario` ou do `cliente_acesso`. */
  readonly sub: string;
  /** Tenant. É a ÚNICA origem confiável da empresa. Ver docs/TENANCY.md §2. */
  readonly tid: string;
  /** Cliente. Presente apenas no domínio do portal. */
  readonly cid?: string;
  /**
   * Sessão de SUPORTE: id do administrador de plataforma que a abriu.
   *
   * O token continua sendo de funcionário — é assim que todos os guards e
   * todo o RLS seguem valendo sem exceção. A marca existe para a tela da
   * empresa poder dizer em voz alta que quem está ali não é o dono da conta.
   * Um acesso de fora que ninguém consegue ver na tela é o que esta marca
   * impede.
   */
  readonly sup?: string;
  readonly aud: DominioComEmpresa;
}

/**
 * Token da plataforma. Sem `tid`, e é isso que o define.
 *
 * O administrador de plataforma não pertence a empresa nenhuma: o que ele
 * pode fazer não é escopo de tenant, é o oposto disso.
 */
export interface PayloadPlataforma {
  /** Id em `plataforma_admin`. */
  readonly sub: string;
  readonly aud: typeof DOMINIO_PLATAFORMA;
}

/**
 * Quem está falando, já resolvido.
 *
 * As permissões não vêm no token. São lidas do banco a cada requisição, com
 * escopo de tenant.
 *
 * O custo é uma consulta por requisição. O ganho é que revogar um perfil tem
 * efeito imediato — com as permissões dentro do token, um usuário demitido
 * continuaria com acesso até o token expirar. Quando a medição pedir, entra
 * cache curto; não antes.
 */
export interface Principal {
  readonly id: string;
  /*
    Nunca `plataforma`. Este principal SEMPRE tem empresa — `tenantId` logo
    abaixo é obrigatório —, e quem administra a plataforma não tem. São dois
    tipos porque são duas coisas; um só, com campos opcionais, faria o
    compilador aceitar um administrador de plataforma com tenant vazio.
  */
  readonly dominio: DominioComEmpresa;
  readonly tenantId: string;
  readonly clienteId?: string;
  /**
   * A razao social do cliente. So no portal.
   *
   * `nome` e a PESSOA que entrou; esta e a empresa em nome de quem ela compra.
   * Um professor pode responder por mais de uma academia, e a tela precisa
   * dizer em qual delas ele esta.
   */
  readonly empresa?: string;
  readonly nome: string;
  readonly email: string;
  readonly permissoes: ReadonlySet<string>;
  /** Lojas às quais o funcionário tem vínculo. Vazio no portal. */
  readonly lojaIds: ReadonlySet<string>;
  readonly plataformaAdmin: boolean;
  /** Preenchido só em sessão de suporte. Ver `sup` em `PayloadAcesso`. */
  readonly suporteDe?: string;
}

/**
 * Quem administra a plataforma, já resolvido.
 *
 * Sem `tenantId`, sem `permissoes` e sem `lojaIds` — nenhum dos três faz
 * sentido fora de uma empresa. O que este principal pode fazer é decidido
 * pelo DOMÍNIO da rota, não por uma lista de permissões: só as rotas de
 * `apps/api/src/plataforma/` o aceitam, e nenhuma outra rota do sistema
 * aceita o token dele.
 */
export interface PrincipalPlataforma {
  readonly id: string;
  readonly dominio: typeof DOMINIO_PLATAFORMA;
  readonly nome: string;
  readonly email: string;
}

/** Onde o principal fica pendurado na requisição. */
export const CHAVE_PRINCIPAL = 'principalAutenticado' as const;

/**
 * Canal de quem está entrando.
 *
 * `web`  → refresh em cookie httpOnly; o corpo não devolve o token
 * `app`  → refresh no corpo; o aplicativo guarda no Keychain/Keystore
 *
 * São exclusivos de propósito. Devolver o token no corpo **e** no cookie
 * anularia o httpOnly, que existe justamente para o JavaScript da página não
 * conseguir ler o refresh. Ver docs/MOBILE.md §4.
 */
export type Canal = 'web' | 'app';
