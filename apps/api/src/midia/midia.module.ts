import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import express from 'express';

import { LIMITE_BYTES_IMAGEM } from '@estoque/core';

import { ArmazenamentoModule } from '../armazenamento/armazenamento.module';
import { ProdutosModule } from '../produtos/produtos.module';
import { MidiaController } from './midia.controller';

@Module({
  imports: [ArmazenamentoModule, ProdutosModule],
  controllers: [MidiaController],
})
export class MidiaModule implements NestModule {
  /**
   * Corpo cru só nesta rota.
   *
   * O parser padrão do NestJS é JSON; uma imagem chegaria como `{}`. Ligar o
   * parser cru globalmente faria toda rota carregar megabytes na memória à
   * toa, então ele vale para `PUT /midia/enviar` e mais nada.
   *
   * Registrado como middleware de módulo, e não em `main.ts`, para que os
   * testes de ponta a ponta — que montam a aplicação sem passar por lá —
   * tenham exatamente o mesmo comportamento da produção.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(express.raw({ type: () => true, limit: LIMITE_BYTES_IMAGEM }))
      .forRoutes({ path: 'midia/enviar', method: RequestMethod.PUT });
  }
}
