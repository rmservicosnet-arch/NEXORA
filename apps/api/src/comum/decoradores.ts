import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { CHAVE_PRINCIPAL, type Dominio, type Principal } from '../auth/dominios';

export const META_PUBLICO = 'rota:publica';
export const META_DOMINIO = 'rota:dominio';
export const META_PERMISSOES = 'rota:permissoes';
export const META_PARAM_LOJA = 'rota:paramLoja';

/** Rota sem autenticação. Login e sonda de saúde — mais nada por padrão. */
export const Publico = (): MethodDecorator & ClassDecorator => SetMetadata(META_PUBLICO, true);

/**
 * Domínio exigido pela rota. O padrão é `funcionario`.
 *
 * Marcar como `cliente` faz o guard verificar o token com o segredo do
 * portal. Um token de funcionário apresentado ali falha na assinatura.
 */
export const ExigeDominio = (dominio: Dominio): MethodDecorator & ClassDecorator =>
  SetMetadata(META_DOMINIO, dominio);

/**
 * Permissões exigidas. Todas, não qualquer uma.
 *
 * Exigir "qualquer uma" transforma toda combinação de perfis num risco que
 * ninguém consegue revisar.
 */
export const Permissoes = (...chaves: string[]): MethodDecorator =>
  SetMetadata(META_PERMISSOES, chaves);

/**
 * Nome do parâmetro de rota que carrega a loja.
 *
 * O guard de escopo confere se o usuário tem vínculo com ela. Tenant não é o
 * único escopo: um vendedor da Loja Centro não movimenta o estoque da Loja
 * Shopping. Ver docs/TENANCY.md §3.
 */
export const EscopoLoja = (nomeDoParametro = 'lojaId'): MethodDecorator =>
  SetMetadata(META_PARAM_LOJA, nomeDoParametro);

/** Injeta o principal já resolvido pelo guard. */
export const PrincipalAtual = createParamDecorator(
  (_dado: unknown, ctx: ExecutionContext): Principal => {
    const requisicao = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return requisicao[CHAVE_PRINCIPAL] as Principal;
  },
);
