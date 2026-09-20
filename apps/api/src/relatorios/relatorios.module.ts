import { Module } from '@nestjs/common';

import { RelatoriosAuditoriaController } from './auditoria.controller';
import { RelatoriosAuditoriaService } from './auditoria.service';
import { RelatoriosCarteiraController } from './carteira.controller';
import { RelatoriosCarteiraService } from './carteira.service';
import { RelatoriosFechamentosService } from './fechamentos.service';
import { RelatoriosPedidosController } from './pedidos.controller';
import { RelatoriosPedidosService } from './pedidos.service';
import { RelatoriosFase5Controller } from './fase5.controller';
import { RelatoriosFase5Service } from './fase5.service';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';

@Module({
  controllers: [
    RelatoriosFase5Controller,
    RelatoriosController,
    RelatoriosPedidosController,
    RelatoriosCarteiraController,
    RelatoriosAuditoriaController,
  ],
  providers: [
    RelatoriosFase5Service,
    RelatoriosService,
    RelatoriosPedidosService,
    RelatoriosCarteiraService,
    RelatoriosFechamentosService,
    RelatoriosAuditoriaService,
  ],
})
export class RelatoriosModule {}
