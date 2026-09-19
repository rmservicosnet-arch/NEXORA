import { Module } from '@nestjs/common';

import { AcessosService } from './acessos.service';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, AcessosService],
})
export class ClientesModule {}
