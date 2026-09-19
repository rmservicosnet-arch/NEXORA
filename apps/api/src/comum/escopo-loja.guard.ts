import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { CHAVE_PRINCIPAL, DOMINIO_FUNCIONARIO, type Principal } from '../auth/dominios';
import { META_PARAM_LOJA } from './decoradores';

/**
 * Escopo de loja — critério de aceite nº 6 do TENANCY.md.
 *
 * Tenant não é o único escopo. Um vendedor da Loja Centro não movimenta o
 * estoque da Loja Shopping, mesmo sendo da mesma empresa e tendo a permissão
 * `estoque.ajustar`.
 *
 * Permissão diz *o que* a pessoa pode fazer. Vínculo de loja diz *onde*. As
 * duas perguntas são diferentes e as duas precisam de resposta.
 */
@Injectable()
export class EscopoLojaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const nomeDoParametro = this.reflector.getAllAndOverride<string>(META_PARAM_LOJA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!nomeDoParametro) {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const principal = (requisicao as unknown as Record<string, unknown>)[CHAVE_PRINCIPAL] as
      Principal | undefined;

    if (!principal || principal.dominio !== DOMINIO_FUNCIONARIO) {
      throw new ForbiddenException({
        codigo: 'FORA_DE_ESCOPO',
        mensagem: 'Esta operação é restrita a usuários da empresa.',
      });
    }

    const params = requisicao.params as unknown as Record<string, string | undefined>;
    const query = requisicao.query as unknown as Record<string, unknown>;
    const body = (requisicao.body ?? {}) as Record<string, unknown>;

    const bruto =
      params[nomeDoParametro] ??
      (typeof query[nomeDoParametro] === 'string'
        ? (query[nomeDoParametro] as string)
        : undefined) ??
      (typeof body[nomeDoParametro] === 'string' ? (body[nomeDoParametro] as string) : undefined);

    if (!bruto) {
      throw new ForbiddenException({
        codigo: 'LOJA_NAO_INFORMADA',
        mensagem: 'A loja precisa ser informada nesta operação.',
      });
    }

    if (!principal.lojaIds.has(bruto)) {
      // 403, não 404: a loja pertence à mesma empresa, e o usuário sabe que
      // ela existe. Esconder aqui não protegeria nada e confundiria o
      // suporte. Recurso de OUTRA empresa é que vira 404 — e isso o RLS já
      // resolve antes de chegar aqui.
      throw new ForbiddenException({
        codigo: 'SEM_ACESSO_A_LOJA',
        mensagem: 'Você não tem vínculo com esta loja.',
      });
    }

    return true;
  }
}
