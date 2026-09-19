/**
 * Configuração da aplicação, validada na inicialização.
 *
 * Variável faltando ou malformada derruba o processo ao subir — não numa
 * requisição às três da manhã. Um segredo JWT vazio, por exemplo, faria a
 * aplicação assinar tokens com string vazia e aceitar qualquer token forjado.
 */

import { z } from 'zod';

/**
 * Os dois domínios de autenticação usam segredos DIFERENTES.
 *
 * Com segredo compartilhado, um token de cliente poderia ser transformado em
 * token de funcionário trocando a claim `aud` e reassinando. Ver ADR-009.
 */
const SEGREDO_MINIMO = 32;

export const esquemaAmbiente = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL é obrigatória'),

  JWT_FUNCIONARIO_SECRET: z
    .string()
    .min(SEGREDO_MINIMO, `JWT_FUNCIONARIO_SECRET precisa de ao menos ${SEGREDO_MINIMO} caracteres`),
  JWT_CLIENTE_SECRET: z
    .string()
    .min(SEGREDO_MINIMO, `JWT_CLIENTE_SECRET precisa de ao menos ${SEGREDO_MINIMO} caracteres`),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DIAS: z.coerce.number().int().positive().default(30),

  API_PORT: z.coerce.number().int().positive().default(3333),
  API_PREFIX: z.string().default('api'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_DOMAIN: z.string().default('localhost'),

  RATE_LIMIT_JANELA_SEGUNDOS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(8),
});

export type Ambiente = z.infer<typeof esquemaAmbiente>;

export function validarAmbiente(bruto: Record<string, unknown>): Ambiente {
  const resultado = esquemaAmbiente.safeParse(bruto);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração inválida no .env:\n${problemas}\n`);
  }

  const ambiente = resultado.data;

  if (ambiente.JWT_FUNCIONARIO_SECRET === ambiente.JWT_CLIENTE_SECRET) {
    throw new Error(
      'JWT_FUNCIONARIO_SECRET e JWT_CLIENTE_SECRET são iguais.\n' +
        '  Com o mesmo segredo, um token de cliente vira token de funcionário ' +
        'apenas trocando a claim `aud`. Ver ADR-009.\n',
    );
  }

  if (ambiente.NODE_ENV === 'production' && !ambiente.COOKIE_SECURE) {
    throw new Error(
      'COOKIE_SECURE está desligado em produção.\n' +
        '  O refresh token trafegaria sem exigir HTTPS.\n',
    );
  }

  return ambiente;
}
