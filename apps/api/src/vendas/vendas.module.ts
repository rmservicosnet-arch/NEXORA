import { Module } from '@nestjs/common';

import { EstoqueModule } from '../estoque/estoque.module';
import { VendasController } from './vendas.controller';
import { VendasService } from './vendas.service';

@Module({
  // A venda baixa estoque pelo MESMO serviço da saída manual. Uma segunda
  // implementação "só para a venda" seria uma segunda verdade sobre o custo.
  imports: [EstoqueModule],
  controllers: [VendasController],
  providers: [VendasService],
})
export class VendasModule {}
