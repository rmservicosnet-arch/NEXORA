import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validarAmbiente } from './configuracao';
import { PrismaModule } from './infra/prisma/prisma.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // O .env vive na raiz do monorepo, não dentro de apps/api.
      envFilePath: ['../../.env'],
      validate: validarAmbiente,
    }),

    // Limite global. O login tem limite próprio, mais apertado, no módulo
    // de autenticação — tentativa de senha é o alvo óbvio de força bruta.
    ThrottlerModule.forRoot([
      {
        name: 'padrao',
        ttl: 60_000,
        limit: 120,
      },
    ]),

    PrismaModule,
  ],
  controllers: [SaudeController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
