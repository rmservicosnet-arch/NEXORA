import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CHAVE_PRINCIPAL, type Principal } from '../auth/dominios';
import { META_PERMISSOES } from './decoradores';

@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exigidas = this.reflector.getAllAndOverride<string[]>(META_PERMISSOES, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exigidas || exigidas.length === 0) {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest<Record<string, unknown>>();
    const principal = requisicao[CHAVE_PRINCIPAL] as Principal | undefined;

    if (!principal) {
      throw new ForbiddenException({
        codigo: 'SEM_PERMISSAO',
        mensagem: 'Você não tem permissão para esta ação.',
      });
    }

    // Todas as permissões exigidas, não qualquer uma.
    const faltando = exigidas.filter((chave) => !principal.permissoes.has(chave));

    if (faltando.length > 0) {
      throw new ForbiddenException({
        codigo: 'SEM_PERMISSAO',
        mensagem: 'Você não tem permissão para esta ação.',
        // A permissão que falta é devolvida de propósito: quem chegou até
        // aqui já está autenticado nesta empresa, e a informação ajuda o
        // suporte a resolver sem tentativa e erro.
        permissoesFaltantes: faltando,
      });
    }

    return true;
  }
}
