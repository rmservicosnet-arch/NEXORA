import { Module } from '@nestjs/common';

import { CaixaModule } from '../caixa/caixa.module';
import { CarteiraModule } from '../carteira/carteira.module';
import { ContasModule } from '../contas/contas.module';
import { EstoqueModule } from '../estoque/estoque.module';
import { VendasController } from './vendas.controller';
import { VendasService } from './vendas.service';

@Module({
  // A venda baixa estoque pelo MESMO serviço da saída manual. Uma segunda
  // implementação "só para a venda" seria uma segunda verdade sobre o custo.
  /*
    A venda a prazo escolhe entre carteira e titulo — e nao implementa nenhum
    dos dois por conta propria. Contas nao sabe que vendas existem, entao nao
    ha ciclo.
  */
  imports: [EstoqueModule, CaixaModule, CarteiraModule, ContasModule],
  controllers: [VendasController],
  providers: [VendasService],
  // O faturamento de pedido grava a venda pelo mesmo servico.
  exports: [VendasService],
})
export class VendasModule {}
