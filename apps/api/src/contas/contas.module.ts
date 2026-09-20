import { Module } from '@nestjs/common';

import { CaixaModule } from '../caixa/caixa.module';
import { CarteiraModule } from '../carteira/carteira.module';
import { ContasController } from './contas.controller';
import { ContasService } from './contas.service';

@Module({
  /*
    A baixa NAO move dinheiro por conta propria: em dinheiro ela chama o
    caixa, e num titulo a receber ela chama a carteira. Cada um com as suas
    regras e a sua auditoria — e por isso que este modulo nao vira um segundo
    lugar onde saldo muda.
  */
  imports: [CarteiraModule, CaixaModule],
  controllers: [ContasController],
  providers: [ContasService],
  // A venda a prazo de cliente SEM carteira cria titulo por este servico:
  // a regra de como um titulo nasce fica nesta casa. docs/WALLET.md §6.
  exports: [ContasService],
})
export class ContasModule {}
