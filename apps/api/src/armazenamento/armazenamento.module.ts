import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Armazenamento } from './armazenamento';
import { ArmazenamentoLocal } from './armazenamento-local.service';

export class ArmazenamentoNaoConfiguradoError extends Error {
  readonly codigo = 'ARMAZENAMENTO_NAO_CONFIGURADO';

  constructor(driver: string) {
    super(
      `STORAGE_DRIVER="${driver}" ainda não tem implementação. ` +
        'Use "local" ou implemente o driver antes de subir.',
    );
    this.name = 'ArmazenamentoNaoConfiguradoError';
  }
}

/**
 * Escolhe o driver de armazenamento.
 *
 * A falha é na inicialização, não na primeira foto enviada. Subir uma API que
 * aceita cadastro e só descobre que não sabe guardar imagem quando alguém
 * tenta é trocar um erro de configuração por um erro de operação.
 */
@Module({
  providers: [
    {
      provide: Armazenamento,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('STORAGE_DRIVER') ?? 'local';

        if (driver === 'local') {
          return new ArmazenamentoLocal(config);
        }

        // S3 entra aqui quando houver bucket. O contrato já é o dele —
        // ver o comentário em armazenamento.ts.
        throw new ArmazenamentoNaoConfiguradoError(driver);
      },
    },
  ],
  exports: [Armazenamento],
})
export class ArmazenamentoModule {}
