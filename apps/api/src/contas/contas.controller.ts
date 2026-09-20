import {
  PERM,
  baixaSchema,
  cancelamentoTituloSchema,
  estornoBaixaSchema,
  filtroTitulosSchema,
  novoTituloSchema,
  type BaixaTitulo,
  type CancelamentoTitulo,
  type EstornoBaixa,
  type FiltroTitulos,
  type NovoTitulo,
  type PaginaTitulos,
  type Titulo,
} from '@estoque/contracts';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ContasService } from './contas.service';

/**
 * Contas a pagar e a receber.
 *
 * `financeiro.visualizar` le; `financeiro.baixar` move dinheiro. Sao perguntas
 * diferentes: olhar o que vence amanha nao e o mesmo grau de autoridade que
 * dar por pago.
 */
@Controller('financeiro/titulos')
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  @Get()
  @Permissoes(PERM.financeiro.visualizar)
  async listar(
    @Query(new ZodPipe(filtroTitulosSchema)) filtro: FiltroTitulos,
  ): Promise<PaginaTitulos> {
    return this.contas.listar(filtro);
  }

  @Get(':id')
  @Permissoes(PERM.financeiro.visualizar)
  async detalhe(@Param('id') id: string): Promise<Titulo> {
    return this.contas.detalhe(id);
  }

  @Post()
  @Permissoes(PERM.financeiro.baixar)
  async criar(
    @Body(new ZodPipe(novoTituloSchema)) dados: NovoTitulo,
    @PrincipalAtual() principal: Principal,
  ): Promise<Titulo[]> {
    return this.contas.criar(dados, principal);
  }

  @Post(':id/baixar')
  @Permissoes(PERM.financeiro.baixar)
  async baixar(
    @Param('id') id: string,
    @Body(new ZodPipe(baixaSchema)) dados: BaixaTitulo,
    @PrincipalAtual() principal: Principal,
  ): Promise<Titulo> {
    return this.contas.baixar(id, dados, principal);
  }

  /**
   * Desfazer uma baixa.
   *
   * Mesma permissao de dar baixa: quem pode mover o dinheiro pode desfazer o
   * movimento. O que NAO pode e desfazer sem dizer por que — o motivo e
   * obrigatorio no schema.
   */
  @Post(':id/baixas/:baixaId/estornar')
  @Permissoes(PERM.financeiro.baixar)
  async estornarBaixa(
    @Param('id') id: string,
    @Param('baixaId') baixaId: string,
    @Body(new ZodPipe(estornoBaixaSchema)) dados: EstornoBaixa,
    @PrincipalAtual() principal: Principal,
  ): Promise<Titulo> {
    return this.contas.estornarBaixa(id, baixaId, dados, principal);
  }

  @Post(':id/cancelar')
  @Permissoes(PERM.financeiro.baixar)
  async cancelar(
    @Param('id') id: string,
    @Body(new ZodPipe(cancelamentoTituloSchema)) dados: CancelamentoTitulo,
    @PrincipalAtual() principal: Principal,
  ): Promise<Titulo> {
    return this.contas.cancelar(id, dados, principal);
  }
}
