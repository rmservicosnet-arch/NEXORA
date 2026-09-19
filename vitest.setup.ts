/**
 * Carrega o .env antes dos testes.
 *
 * Os testes de integração de `@estoque/db` precisam de DATABASE_URL e
 * DIRECT_URL. Os testes puros de `@estoque/core` ignoram isto.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // Sem .env: os testes que dependem do banco se marcam como pulados.
}
