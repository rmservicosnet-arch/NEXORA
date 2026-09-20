import { Module } from '@nestjs/common';

import { ArmazenamentoModule } from '../armazenamento/armazenamento.module';
import { ImagensController } from './imagens.controller';
import { ImagensService } from './imagens.service';
import { PrecosService } from './precos.service';
import { ProdutosController } from './produtos.controller';
import { ProdutosService } from './produtos.service';
import { TabelasController } from './tabelas.controller';
import { TabelasService } from './tabelas.service';

@Module({
  imports: [ArmazenamentoModule],
  controllers: [ProdutosController, ImagensController, TabelasController],
  providers: [ProdutosService, ImagensService, PrecosService, TabelasService],
  // `MidiaModule` serve os bytes e precisa do mesmo serviço — é ele que faz a
  // volta pelo banco, sob RLS, antes de tocar no armazenamento.
  exports: [ImagensService],
})
export class ProdutosModule {}
