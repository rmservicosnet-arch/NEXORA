/**
 * Os dois domínios de autenticação — ADR-009.
 *
 * Funcionário e cliente não são "tipos de usuário": são principais
 * diferentes, com tabelas, rotas de login e segredos de assinatura próprios.
 *
 * A claim `aud` é o que separa os dois. Um token de cliente é
 * **estruturalmente incapaz** de passar no guard de funcionário: a audiência
 * não confere e o segredo também não. A garantia não depende de ninguém
 * lembrar de filtrar por um campo `tipo` numa consulta.
 */

export const DOMINIO_FUNCIONARIO = 'funcionario' as const;
export const DOMINIO_CLIENTE = 'cliente' as const;

export type Dominio = typeof DOMINIO_FUNCIONARIO | typeof DOMINIO_CLIENTE;

/** Conteúdo do token de acesso. Deliberadamente enxuto. */
export interface PayloadAcesso {
  /** Id do `usuario` ou do `cliente_acesso`. */
  readonly sub: string;
  /** Tenant. É a ÚNICA origem confiável da empresa. Ver docs/TENANCY.md §2. */
  readonly tid: string;
  /** Cliente. Presente apenas no domínio do portal. */
  readonly cid?: string;
  readonly aud: Dominio;
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
  readonly dominio: Dominio;
  readonly tenantId: string;
  readonly clienteId?: string;
  readonly nome: string;
  readonly email: string;
  readonly permissoes: ReadonlySet<string>;
  /** Lojas às quais o funcionário tem vínculo. Vazio no portal. */
  readonly lojaIds: ReadonlySet<string>;
  readonly plataformaAdmin: boolean;
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
