/**
 * Execução com escopo de tenant.
 *
 * O ponto central: `app.tenant_id` é definido com **`SET LOCAL`**, sempre
 * dentro de uma transação.
 *
 * O Prisma usa um pool. Uma conexão é reutilizada entre requisições de
 * empresas diferentes. Um `SET` comum sobreviveria ao fim da requisição e
 * vazaria o tenant anterior para a próxima que pegasse a mesma conexão — que
 * é exatamente o vazamento que o RLS deveria impedir.
 *
 * `set_config(..., true)` é o equivalente parametrizável de `SET LOCAL`:
 * expira no fim da transação e aceita valor por parâmetro, sem concatenar
 * string em SQL.
 *
 * Consequência aceita: **toda** leitura e escrita de dado de empresa acontece
 * dentro de uma transação. Ver docs/TENANCY.md §2.
 */

import type { Contexto } from './contexto';
import { exigirContexto } from './contexto';
import type { PrismaClient } from '../generated';

/** O cliente disponível dentro de `comEscopo`. Sem `$transaction` aninhada. */
export type ClienteEmTransacao = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

export interface OpcoesEscopo {
  /** Tempo máximo da transação, em milissegundos. */
  readonly tempoLimiteMs?: number;
  /** Tempo máximo esperando uma conexão do pool. */
  readonly esperaMs?: number;
}

const TEMPO_LIMITE_PADRAO_MS = 10_000;
const ESPERA_PADRAO_MS = 5_000;

async function aplicarEscopo(tx: ClienteEmTransacao, contexto: Contexto): Promise<void> {
  // O terceiro argumento `true` é o que torna a definição local à transação.
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${contexto.tenantId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.cliente_id', ${contexto.clienteId ?? ''}, true)`;
}

/**
 * Abre uma transação já com o escopo aplicado.
 *
 * Tudo que `acao` fizer enxerga apenas os dados da empresa do contexto — e,
 * no portal, apenas os do próprio cliente.
 */
export async function comEscopo<T>(
  prisma: PrismaClient,
  contexto: Contexto,
  acao: (tx: ClienteEmTransacao) => Promise<T>,
  opcoes: OpcoesEscopo = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await aplicarEscopo(tx, contexto);
      return acao(tx);
    },
    {
      timeout: opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS,
      maxWait: opcoes.esperaMs ?? ESPERA_PADRAO_MS,
    },
  );
}

/**
 * Mesma coisa, pegando o contexto do `AsyncLocalStorage`.
 *
 * É a forma usada nos serviços da API: o guard já abriu o contexto, e o
 * serviço não precisa recebê-lo por parâmetro. Lança se não houver contexto
 * aberto — esquecer é erro alto, não silencioso.
 */
export async function comEscopoAtual<T>(
  prisma: PrismaClient,
  acao: (tx: ClienteEmTransacao) => Promise<T>,
  opcoes: OpcoesEscopo = {},
): Promise<T> {
  return comEscopo(prisma, exigirContexto(), acao, opcoes);
}
