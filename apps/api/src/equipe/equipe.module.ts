import { Module } from '@nestjs/common';

import { EquipeController } from './equipe.controller';
import { PerfisService } from './perfis.service';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [EquipeController],
  providers: [UsuariosService, PerfisService],
})
export class EquipeModule {}
