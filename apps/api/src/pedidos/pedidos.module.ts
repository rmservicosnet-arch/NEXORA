import { Module } from '@nestjs/common';

import { VendasModule } from '../vendas/vendas.module';
import { PedidosController, PortalPedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';

@Module({
  // O pedido faturado vira VENDA pelo MESMO servico do PDV. A dependencia vai
  // nesta direcao e so nela: a venda nao sabe que pedidos existem.
  imports: [VendasModule],
  controllers: [PedidosController, PortalPedidosController],
  providers: [PedidosService],
})
export class PedidosModule {}
