/**
 * Contexto da requisição.
 *
 * Carrega quem está falando e em nome de qual empresa. É preenchido pelos
 * guards da API a partir do **token validado** — nunca do corpo, da query ou
 * de um header. Ver docs/TENANCY.md §2, camada 1.
 *
 * Usa `AsyncLocalStorage` para não ter de passar o contexto por parâmetro em
 * toda a pilha de chamadas. O risco dessa escolha é esquecer de abrir o
 * contexto; por isso `exigirContexto()` lança em vez de devolver `undefined`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type PrincipalTipo = 'FUNCIONARIO' | 'CLIENTE' | 'SISTEMA';

export interface Contexto {
  /** Empresa. Vem da claim do token, sempre. */
  readonly tenantId: string;
  readonly principalTipo: PrincipalTipo;
  readonly principalId?: string;
  /**
   * Preenchido apenas no portal do cliente. Quando presente, o RLS restringe
   * as tabelas de cliente aos dados dele. Ver docs/TENANCY.md §2.
   */
  readonly clienteId?: string;
  /** Lojas às quais o funcionário tem vínculo. */
  readonly lojaIds?: readonly string[];
  /** Acompanha a requisição nos logs e na auditoria. */
  readonly correlacaoId?: string;
}

const armazem = new AsyncLocalStorage<Contexto>();

export class SemContextoError extends Error {
  readonly codigo = 'SEM_CONTEXTO_TENANT';

  constructor() {
    super(
      'Nenhum contexto de tenant está aberto. Toda leitura e escrita de dado ' +
        'de empresa acontece dentro de comContexto(). Ver docs/TENANCY.md §2.',
    );
    this.name = 'SemContextoError';
  }
}

export function contextoAtual(): Contexto | undefined {
  return armazem.getStore();
}

export function exigirContexto(): Contexto {
  const atual = armazem.getStore();
  if (!atual) {
    throw new SemContextoError();
  }
  return atual;
}

/** Executa `acao` dentro de um contexto. Tudo que ela chamar enxerga o mesmo. */
export function comContexto<T>(contexto: Contexto, acao: () => Promise<T>): Promise<T> {
  return armazem.run(contexto, acao);
}

/**
 * Contexto de sistema — jobs, filas, expiração de reserva.
 *
 * Não existe "job sem tenant": um job que não sabe de qual empresa é não tem
 * o que fazer. A exigência do `tenantId` aqui é o que garante isso na
 * enfileiração, e não só na execução. Ver docs/TENANCY.md §4.
 */
export function contextoDeSistema(tenantId: string, correlacaoId?: string): Contexto {
  if (!tenantId) {
    throw new SemContextoError();
  }
  return correlacaoId
    ? { tenantId, principalTipo: 'SISTEMA', correlacaoId }
    : { tenantId, principalTipo: 'SISTEMA' };
}
