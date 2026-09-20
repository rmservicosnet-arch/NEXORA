import { Module } from '@nestjs/common';

import { VisaoGeralController } from './visao-geral.controller';
import { VisaoGeralService } from './visao-geral.service';

@Module({
  controllers: [VisaoGeralController],
  providers: [VisaoGeralService],
})
export class VisaoGeralModule {}
