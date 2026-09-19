import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import type { Ambiente } from './configuracao';

async function iniciar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Ambiente, true>);
  const logger = new Logger('api');

  app.use(helmet());
  app.use(cookieParser());

  // O refresh token vai em cookie httpOnly, então a origem precisa ser
  // explícita e enviar credenciais. `origin: true` com credenciais é o
  // mesmo que não ter CORS.
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }));
  app.enableShutdownHooks();

  const porta = config.get('API_PORT', { infer: true });
  await app.listen(porta);

  logger.log(`API em http://localhost:${porta}/${config.get('API_PREFIX', { infer: true })}`);
  logger.log(`Ambiente: ${config.get('NODE_ENV', { infer: true })}`);
}

iniciar().catch((erro: unknown) => {
  // Falha de configuração aparece aqui, antes de qualquer requisição.
  console.error('\n  ✗ A API não subiu:\n');
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
