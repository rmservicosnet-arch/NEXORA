import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EmpresasService } from './empresas.service';
import { PlataformaController } from './plataforma.controller';
import { SuporteService } from './suporte.service';

/**
 * A plataforma — o que está acima das empresas.
 *
 * Diretório fechado por regra de lint: é o único lugar do sistema autorizado
 * a chamar as funções `plataforma_*`, que são `SECURITY DEFINER` e cruzam
 * tenants por definição. Ver `docs/TENANCY.md` §2.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlataformaController],
  providers: [EmpresasService, SuporteService],
})
export class PlataformaModule {}
