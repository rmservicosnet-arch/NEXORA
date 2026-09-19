import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from '../auth/auth.service';
import { CHAVE_PRINCIPAL, DOMINIO_FUNCIONARIO, type Dominio } from '../auth/dominios';
import { TokensService } from '../auth/tokens.service';
import { AuditoriaService } from './auditoria.service';
import { META_DOMINIO, META_PUBLICO } from './decoradores';

/**
 * Campos que, se vierem do cliente tentando definir a empresa, são
 * tentativa de acesso cruzado.
 *
 * O tenant vem do token e de mais lugar nenhum. Ver docs/TENANCY.md §2,
 * camada 1.
 */
const CAMPOS_DE_TENANT = ['tenantId', 'tenant_id', 'empresaId', 'empresa_id'];

@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(META_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico) {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const token = this.extrairToken(requisicao);
    if (!token) {
      throw new UnauthorizedException({
        codigo: 'TOKEN_AUSENTE',
        mensagem: 'Autenticação obrigatória.',
      });
    }

    const dominio =
      this.reflector.getAllAndOverride<Dominio>(META_DOMINIO, [
        contexto.getHandler(),
        contexto.getClass(),
      ]) ?? DOMINIO_FUNCIONARIO;

    let payload;
    try {
      // O segredo usado é o do domínio que a ROTA exige — não o que o token
      // afirma ser. Token do portal numa rota de funcionário falha aqui, na
      // assinatura, antes de qualquer outra verificação.
      payload = await this.tokens.verificarAcesso(token, dominio);
    } catch {
      throw new UnauthorizedException({
        codigo: 'TOKEN_INVALIDO',
        mensagem: 'Sessão inválida ou expirada.',
      });
    }

    const principal = await this.auth.carregarPrincipal(payload);

    // Critério de aceite nº 3 do TENANCY.md.
    await this.recusarTenantForjado(requisicao, principal.tenantId, principal);

    (requisicao as unknown as Record<string, unknown>)[CHAVE_PRINCIPAL] = principal;
    return true;
  }

  private extrairToken(requisicao: Request): string | null {
    const cabecalho = requisicao.headers.authorization;
    if (!cabecalho) {
      return null;
    }
    const [esquema, valor] = cabecalho.split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !valor) {
      return null;
    }
    return valor;
  }

  /**
   * Recusa a requisição se ela tentar definir a empresa por conta própria.
   *
   * Um `tenantId` no corpo que difere do token não é engano de programação
   * do cliente: é tentativa de acesso cruzado. Ignorar em silêncio esconderia
   * um ataque em andamento — então a requisição morre com 403 e o fato fica
   * registrado na trilha.
   */
  private async recusarTenantForjado(
    requisicao: Request,
    tenantDoToken: string,
    principal: { id: string; nome: string; dominio: Dominio; tenantId: string },
  ): Promise<void> {
    const fontes: Array<Record<string, unknown> | undefined> = [
      requisicao.body as Record<string, unknown> | undefined,
      requisicao.query as unknown as Record<string, unknown> | undefined,
      requisicao.params as unknown as Record<string, unknown> | undefined,
    ];

    for (const fonte of fontes) {
      if (!fonte || typeof fonte !== 'object') {
        continue;
      }
      for (const campo of CAMPOS_DE_TENANT) {
        const valor = fonte[campo];
        if (typeof valor === 'string' && valor.length > 0 && valor !== tenantDoToken) {
          await this.auditoria.registrar({
            contexto: {
              tenantId: tenantDoToken,
              principalTipo: principal.dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
              principalId: principal.id,
            },
            acao: 'CROSS_TENANT_ATTEMPT',
            entidade: 'requisicao',
            atorNome: principal.nome,
            motivo:
              `${requisicao.method} ${requisicao.originalUrl} — campo "${campo}" ` +
              `apontava para outra empresa`,
            ip: requisicao.ip ?? undefined,
            depois: { campo, recebido: valor, esperado: tenantDoToken },
          });

          throw new ForbiddenException({
            codigo: 'TENANT_FORJADO',
            mensagem: 'A empresa é determinada pela sua sessão e não pode ser informada.',
          });
        }
      }
    }
  }
}
