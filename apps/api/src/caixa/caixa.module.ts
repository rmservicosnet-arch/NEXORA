import { Module } from '@nestjs/common';

import { CaixaController } from './caixa.controller';
import { CaixaService } from './caixa.service';

@Module({
  controllers: [CaixaController],
  providers: [CaixaService],
  // O PDV precisa resolver qual caixa recebe a venda, dentro da transação
  // dele — ver `caixaParaVenda`.
  exports: [CaixaService],
})
export class CaixaModule {}
