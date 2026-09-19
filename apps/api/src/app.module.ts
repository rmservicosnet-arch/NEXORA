import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { AutenticacaoGuard } from './comum/autenticacao.guard';
import { ContextoInterceptor } from './comum/contexto.interceptor';
import { EscopoLojaGuard } from './comum/escopo-loja.guard';
import { PermissoesGuard } from './comum/permissoes.guard';
import { validarAmbiente } from './configuracao';
import { PrismaModule } from './infra/prisma/prisma.module';
import { LojasController } from './lojas/lojas.controller';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env'],
      validate: validarAmbiente,
    }),

    ThrottlerModule.forRoot({
      throttlers: [{ name: 'padrao', ttl: 60_000, limit: 120 }],
      // Desligado apenas sob teste automatizado.
      //
      // O limite é real e funciona — foi ele que derrubou a primeira
      // execução da suíte de autenticação, que faz mais de dez logins em
      // segundos. Mantê-lo ligado ali obrigaria a espalhar esperas pelos
      // testes, deixando a suíte lenta e instável sem provar nada sobre
      // autenticação.
      //
      // `skipIf` no módulo, e não `overrideGuard` no teste: guard registrado
      // por APP_GUARD tem como token o próprio APP_GUARD, então
      // `overrideGuard(ThrottlerGuard)` não o alcança.
      skipIf: () => process.env['NODE_ENV'] === 'test',
    }),

    PrismaModule,
    AuthModule,
  ],
  controllers: [SaudeController, LojasController],
  providers: [
    // A ordem importa e é esta:
    //
    //   1. Throttler       antes de tudo, inclusive de verificar senha
    //   2. Autenticação    resolve quem é, e recusa tenant forjado
    //   3. Permissões      o QUE a pessoa pode fazer
    //   4. Escopo de loja  ONDE ela pode fazer
    //
    // Guards são globais de propósito: rota nova nasce protegida. Abrir
    // exige `@Publico()` explícito — esquecer fecha, não abre.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
    { provide: APP_GUARD, useClass: PermissoesGuard },
    { provide: APP_GUARD, useClass: EscopoLojaGuard },

    // Abre o contexto de tenant para o handler. Depois dos guards, porque
    // depende do principal que eles resolvem.
    { provide: APP_INTERCEPTOR, useClass: ContextoInterceptor },
  ],
})
export class AppModule {}
