import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  bloqueioCarteiraSchema,
  estornoCarteiraSchema,
  filtroCarteirasSchema,
  filtroExtratoSchema,
  lancamentoCarteiraSchema,
  limiteCarteiraSchema,
  PERM,
  type BloqueioCarteira,
  type Carteira,
  type EstornoCarteira,
  type ExtratoCarteira,
  type FiltroCarteiras,
  type FiltroExtrato,
  type LancamentoCarteira,
  type LimiteCarteira,
  type PaginaCarteiras,
} from '@estoque/contracts';

import { DOMINIO_CLIENTE, type Principal } from '../auth/dominios';
import { ExigeDominio, Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { CarteiraService } from './carteira.service';

@Controller('carteira')
export class CarteiraController {
  constructor(private readonly carteira: CarteiraService) {}

  @Get()
  @Permissoes(PERM.carteira.visualizar)
  async listar(
    @Query(new ZodPipe(filtroCarteirasSchema)) filtro: FiltroCarteiras,
  ): Promise<PaginaCarteiras> {
    return this.carteira.listar(filtro);
  }

  @Get(':clienteId/extrato')
  @Permissoes(PERM.carteira.visualizar)
  async extrato(
    @Param('clienteId') clienteId: string,
    @Query(new ZodPipe(filtroExtratoSchema)) filtro: FiltroExtrato,
  ): Promise<ExtratoCarteira> {
    return this.carteira.extrato(clienteId, filtro);
  }

  /**
   * Lançamento manual: depósito, quitação, bonificação, ajuste, taxa.
   *
   * A permissão específica depende do `tipo`, que vem no corpo — e
   * `@Permissoes` decide antes de o corpo ser lido. Por isso aqui só se exige
   * ver a carteira; o serviço confere a permissão do tipo.
   */
  @Post(':clienteId/lancamentos')
  @Permissoes(PERM.carteira.visualizar)
  async lancar(
    @Param('clienteId') clienteId: string,
    @Body(new ZodPipe(lancamentoCarteiraSchema)) dados: LancamentoCarteira,
    @PrincipalAtual() principal: Principal,
  ): Promise<ExtratoCarteira> {
    return this.carteira.lancar(clienteId, dados, principal);
  }

  @Post(':clienteId/lancamentos/:movimentoId/estornar')
  @Permissoes(PERM.carteira.estornar)
  async estornar(
    @Param('clienteId') clienteId: string,
    @Param('movimentoId') movimentoId: string,
    @Body(new ZodPipe(estornoCarteiraSchema)) dados: EstornoCarteira,
    @PrincipalAtual() principal: Principal,
  ): Promise<ExtratoCarteira> {
    return this.carteira.estornar(clienteId, movimentoId, dados, principal);
  }

  @Post(':clienteId/limite')
  @Permissoes(PERM.carteira.definirLimite)
  async definirLimite(
    @Param('clienteId') clienteId: string,
    @Body(new ZodPipe(limiteCarteiraSchema)) dados: LimiteCarteira,
    @PrincipalAtual() principal: Principal,
  ): Promise<Carteira> {
    return this.carteira.definirLimite(clienteId, dados, principal);
  }

  @Post(':clienteId/bloqueio')
  @Permissoes(PERM.carteira.definirLimite)
  async bloquear(
    @Param('clienteId') clienteId: string,
    @Body(new ZodPipe(bloqueioCarteiraSchema)) dados: BloqueioCarteira,
    @PrincipalAtual() principal: Principal,
  ): Promise<Carteira> {
    return this.carteira.bloquear(clienteId, dados, principal);
  }
}

/**
 * A carteira do próprio cliente, no portal.
 *
 * Somente leitura, e sem `clienteId` na rota: o cliente vem do token. Aceitar
 * o id pela URL abriria a carteira de qualquer um para quem trocasse o número
 * — e o RLS de cliente, sozinho, não protegeria a listagem de outro id do
 * mesmo tenant. Ver docs/WALLET.md §8.
 */
@Controller('portal/carteira')
@ExigeDominio(DOMINIO_CLIENTE)
export class PortalCarteiraController {
  constructor(private readonly carteira: CarteiraService) {}

  @Get()
  async minhaCarteira(
    @Query(new ZodPipe(filtroExtratoSchema)) filtro: FiltroExtrato,
    @PrincipalAtual() principal: Principal,
  ): Promise<ExtratoCarteira> {
    return this.carteira.extrato(principal.clienteId ?? '', filtro);
  }
}
