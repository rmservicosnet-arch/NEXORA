import { Module } from '@nestjs/common';

import { RelatoriosPedidosController } from './pedidos.controller';
import { RelatoriosPedidosService } from './pedidos.service';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';

@Module({
  controllers: [RelatoriosController, RelatoriosPedidosController],
  providers: [RelatoriosService, RelatoriosPedidosService],
})
export class RelatoriosModule {}
