import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  filtroAcessosSchema,
  filtroSensiveisSchema,
  filtroTrilhaSchema,
  PERM,
  registroExportacaoSchema,
  type FiltroAcessos,
  type FiltroSensiveis,
  type FiltroTrilha,
  type RegistroExportacao,
  type RelatorioAcessos,
  type RelatorioSensiveis,
  type RelatorioTrilha,
} from '@estoque/contracts';
import { exigirContexto } from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ACAO_EXPORTACAO, RelatoriosAuditoriaService } from './auditoria.service';

/**
 * Os relatórios sobre a própria trilha.
 *
 * Exigem `auditoria.visualizar`: a trilha diz o que cada pessoa fez, e quem
 * pode ver o faturamento não passa a poder vigiar os colegas.
 */
@Controller('relatorios/auditoria')
export class RelatoriosAuditoriaController {
  constructor(
    private readonly auditoria: RelatoriosAuditoriaService,
    private readonly trilhaDeAuditoria: AuditoriaService,
  ) {}

  @Get('trilha')
  @Permissoes(PERM.auditoria.visualizar)
  async trilha(
    @Query(new ZodPipe(filtroTrilhaSchema)) filtro: FiltroTrilha,
  ): Promise<RelatorioTrilha> {
    return this.auditoria.trilha(filtro);
  }

  @Get('sensiveis')
  @Permissoes(PERM.auditoria.visualizar)
  async sensiveis(
    @Query(new ZodPipe(filtroSensiveisSchema)) filtro: FiltroSensiveis,
  ): Promise<RelatorioSensiveis> {
    return this.auditoria.sensiveis(filtro);
  }

  @Get('acessos')
  @Permissoes(PERM.auditoria.visualizar)
  async acessos(
    @Query(new ZodPipe(filtroAcessosSchema)) filtro: FiltroAcessos,
  ): Promise<RelatorioAcessos> {
    return this.auditoria.acessos(filtro);
  }

  /**
   * A tela avisa que alguem baixou um CSV.
   *
   * O arquivo e montado no NAVEGADOR e nunca passaria pelo servidor. Sem este
   * aviso, "quem levou dado de custo" seria uma tela em branco que parece
   * dizer que ninguem exportou nada.
   *
   * Exige so `relatorio.visualizar`: quem exporta e quem le o relatorio, e
   * nao quem audita.
   */
  @Post('exportacao')
  @HttpCode(204)
  @Permissoes(PERM.relatorio.visualizar)
  async registrarExportacao(
    @Body(new ZodPipe(registroExportacaoSchema)) dados: RegistroExportacao,
    @PrincipalAtual() principal: Principal,
  ): Promise<void> {
    await this.trilhaDeAuditoria.registrar({
      contexto: exigirContexto(),
      acao: ACAO_EXPORTACAO,
      entidade: 'relatorio',
      atorNome: principal.nome,
      motivo: dados.relatorio,
      depois: { relatorio: dados.relatorio, colunas: dados.colunas, linhas: dados.linhas },
    });
  }
}
