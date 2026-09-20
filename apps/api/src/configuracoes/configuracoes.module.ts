import { Module } from '@nestjs/common';

import { ConfiguracoesController } from './configuracoes.controller';
import { ConfiguracoesService } from './configuracoes.service';

@Module({
  controllers: [ConfiguracoesController],
  providers: [ConfiguracoesService],
})
export class ConfiguracoesModule {}
