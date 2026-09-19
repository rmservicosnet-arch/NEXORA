import { Global, Module } from '@nestjs/common';

import { AuditoriaService } from './auditoria.service';

/**
 * O que todo módulo precisa.
 *
 * Global porque auditoria é transversal: qualquer módulo que altere dado da
 * empresa registra o que fez. Fazer cada um importar um módulo para obter isso
 * cria o incentivo errado — o caminho mais curto passa a ser não auditar.
 */
@Global()
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class ComumModule {}
