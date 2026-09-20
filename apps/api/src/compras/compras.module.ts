import { Module } from '@nestjs/common';

import { EstoqueModule } from '../estoque/estoque.module';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';

@Module({
  // Receber uma nota GRAVA no razao de estoque, e quem sabe gravar ali e o
  // EstoqueService. A dependencia vai nesta direcao e so nela: o estoque nao
  // sabe que compras existem.
  imports: [EstoqueModule],
  controllers: [ComprasController],
  providers: [ComprasService],
})
export class ComprasModule {}
