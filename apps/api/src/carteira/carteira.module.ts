import { Module } from '@nestjs/common';

import { CarteiraController, PortalCarteiraController } from './carteira.controller';
import { CarteiraService } from './carteira.service';

@Module({
  controllers: [CarteiraController, PortalCarteiraController],
  providers: [CarteiraService],
  // O PDV debita a carteira dentro da transação da venda — ver
  // `debitarPorVenda`.
  exports: [CarteiraService],
})
export class CarteiraModule {}
