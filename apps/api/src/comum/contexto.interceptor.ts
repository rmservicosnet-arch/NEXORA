import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { comContexto, type Contexto } from '@estoque/db';
import type { Observable } from 'rxjs';
import { from, switchMap } from 'rxjs';

import {
  CHAVE_PRINCIPAL,
  DOMINIO_FUNCIONARIO,
  DOMINIO_PLATAFORMA,
  type Principal,
  type PrincipalPlataforma,
} from '../auth/dominios';

/**
 * Abre o contexto de tenant para o resto da requisição.
 *
 * Precisa ser interceptor, não guard: guard devolve um booleano e não
 * consegue *envolver* a execução. `AsyncLocalStorage.run` exige envolver.
 *
 * Ordem no NestJS: guards primeiro (autenticam e penduram o principal),
 * interceptors depois (envolvem o handler). É exatamente o que se precisa.
 */
@Injectable()
export class ContextoInterceptor implements NestInterceptor {
  intercept(execucao: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const requisicao = execucao.switchToHttp().getRequest<Record<string, unknown>>();
    const principal = requisicao[CHAVE_PRINCIPAL] as Principal | PrincipalPlataforma | undefined;

    if (!principal) {
      // Rota pública. Não há empresa a definir — e o RLS garante que, sem
      // contexto, nenhuma consulta devolve linha.
      return proximo.handle();
    }

    /*
      A plataforma não tem empresa, e por isso não abre contexto aqui.

      Quem administra a plataforma escolhe a empresa a cada operação, e o
      serviço abre o escopo dela na hora — com `principalTipo: 'PLATAFORMA'`,
      que é o que faz a auditoria dizer que quem agiu veio de fora. Abrir um
      contexto genérico aqui exigiria um `tenantId` que não existe.

      Antes desta guarda o interceptor fazia `[...principal.lojaIds]` para
      todo principal autenticado, e o da plataforma não tem lojas: a
      requisição morria com "lojaIds is not iterable", um 500 com pilha em
      lugar de resposta.
    */
    if (principal.dominio === DOMINIO_PLATAFORMA) {
      return proximo.handle();
    }

    const contexto: Contexto = {
      tenantId: principal.tenantId,
      principalTipo: principal.dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
      principalId: principal.id,
      ...(principal.clienteId ? { clienteId: principal.clienteId } : {}),
      lojaIds: [...principal.lojaIds],
      correlacaoId: (requisicao['correlacaoId'] as string | undefined) ?? crypto.randomUUID(),
    };

    return from(comContexto(contexto, async () => proximo.handle())).pipe(
      switchMap((observavel) => observavel),
    );
  }
}
