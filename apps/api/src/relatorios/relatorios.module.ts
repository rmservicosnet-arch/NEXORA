import { Module } from '@nestjs/common';

import { RelatoriosAuditoriaController } from './auditoria.controller';
import { RelatoriosAuditoriaService } from './auditoria.service';
import { RelatoriosCarteiraController } from './carteira.controller';
import { RelatoriosCarteiraService } from './carteira.service';
import { RelatoriosFechamentosService } from './fechamentos.service';
import { RelatoriosPedidosController } from './pedidos.controller';
import { RelatoriosPedidosService } from './pedidos.service';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';

@Module({
  controllers: [
    RelatoriosController,
    RelatoriosPedidosController,
    RelatoriosCarteiraController,
    RelatoriosAuditoriaController,
  ],
  providers: [
    RelatoriosService,
    RelatoriosPedidosService,
    RelatoriosCarteiraService,
    RelatoriosFechamentosService,
    RelatoriosAuditoriaService,
  ],
})
export class RelatoriosModule {}
