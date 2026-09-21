import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  entrarParaSuporteSchema,
  entrarPlataformaSchema,
  novaEmpresaSchema,
  reativarEmpresaSchema,
  redefinirSenhaAdminSchema,
  suspenderEmpresaSchema,
  type EmpresaCriada,
  type EmpresaDetalhe,
  type EmpresaResumo,
  type EntrarParaSuporte,
  type EntrarPlataforma,
  type NovaEmpresa,
  type PaginaEmpresas,
  type ReativarEmpresa,
  type RedefinirSenhaAdmin,
  type SenhaAdminRedefinida,
  type SessaoPlataformaResposta,
  type SessaoSuporte,
  type SuspenderEmpresa,
} from '@estoque/contracts';

import { DOMINIO_PLATAFORMA, type PrincipalPlataforma } from '../auth/dominios';
import { PlataformaAuthService } from '../auth/plataforma-auth.service';
import { ExigeDominio, PrincipalAtual, Publico } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { EmpresasService } from './empresas.service';
import { SuporteService } from './suporte.service';

/**
 * O terceiro domínio, e o único que enxerga mais de uma empresa.
 *
 * `@ExigeDominio(DOMINIO_PLATAFORMA)` no controlador inteiro não é
 * decoração: o guard escolhe o SEGREDO pelo domínio que a rota pede. Um token
 * de funcionário aqui falha na assinatura — dá **401, não 403**. Falha na
 * autenticação, não na permissão, e é o desenho do ADR-009.
 *
 * Não há `@Permissoes()` em nenhuma rota, e a ausência é deliberada: as
 * permissões vivem dentro de uma empresa, e quem entra aqui não tem empresa.
 * O que autoriza é o domínio.
 */

const COOKIE_PLATAFORMA = 'plataforma_refresh';

@Controller('plataforma')
@ExigeDominio(DOMINIO_PLATAFORMA)
export class PlataformaController {
  constructor(
    private readonly auth: PlataformaAuthService,
    private readonly empresas: EmpresasService,
    private readonly suporte: SuporteService,
  ) {}

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  /**
   * Cofre de token PRÓPRIO.
   *
   * O nome do cookie é outro de propósito: entrar na plataforma na mesma aba
   * em que alguém está logado numa empresa não pode derrubar a sessão dela.
   * O mesmo motivo do portal do cliente ter o seu.
   */
  @Post('login')
  @Publico()
  @HttpCode(200)
  @Throttle({ padrao: { limit: 5, ttl: 60_000 } })
  async entrar(
    @Body(new ZodPipe(entrarPlataformaSchema)) dto: EntrarPlataforma,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoPlataformaResposta> {
    const sessao = await this.auth.entrar(dto.email, dto.senha, {
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'],
    });

    this.gravarCookie(res, sessao.refresh);
    return { tokenAcesso: sessao.acesso, admin: sessao.admin };
  }

  @Post('refresh')
  @Publico()
  @HttpCode(200)
  async renovar(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoPlataformaResposta> {
    const refresh = (req.cookies as Record<string, string> | undefined)?.[COOKIE_PLATAFORMA] ?? '';
    const sessao = await this.auth.renovar(refresh, {
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'],
    });

    this.gravarCookie(res, sessao.refresh);
    return { tokenAcesso: sessao.acesso, admin: sessao.admin };
  }

  @Post('logout')
  @Publico()
  @HttpCode(204)
  async sair(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refresh = (req.cookies as Record<string, string> | undefined)?.[COOKIE_PLATAFORMA] ?? '';
    if (refresh) {
      await this.auth.sair(refresh);
    }
    res.clearCookie(COOKIE_PLATAFORMA, { path: '/api/plataforma' });
  }

  @Get('eu')
  eu(@PrincipalAtual() quem: PrincipalPlataforma): PrincipalPlataforma {
    return quem;
  }

  // -------------------------------------------------------------------------
  // Empresas
  // -------------------------------------------------------------------------

  @Get('empresas')
  async listar(): Promise<PaginaEmpresas> {
    return this.empresas.listar();
  }

  @Post('empresas')
  async criar(
    @Body(new ZodPipe(novaEmpresaSchema)) dto: NovaEmpresa,
    @PrincipalAtual() quem: PrincipalPlataforma,
  ): Promise<EmpresaCriada> {
    return this.empresas.criar(dto, quem);
  }

  @Get('empresas/:id')
  async detalhe(@Param('id') id: string): Promise<EmpresaDetalhe> {
    return this.empresas.detalhe(id);
  }

  @Put('empresas/:id/suspender')
  async suspender(
    @Param('id') id: string,
    @Body(new ZodPipe(suspenderEmpresaSchema)) dto: SuspenderEmpresa,
    @PrincipalAtual() quem: PrincipalPlataforma,
  ): Promise<EmpresaResumo> {
    return this.empresas.mudarSituacao(id, 'INATIVO', dto.motivo, quem);
  }

  @Put('empresas/:id/reativar')
  async reativar(
    @Param('id') id: string,
    @Body(new ZodPipe(reativarEmpresaSchema)) dto: ReativarEmpresa,
    @PrincipalAtual() quem: PrincipalPlataforma,
  ): Promise<EmpresaResumo> {
    return this.empresas.mudarSituacao(id, 'ATIVO', dto.motivo, quem);
  }

  @Post('empresas/:id/senha-admin')
  @HttpCode(200)
  async redefinirSenhaAdmin(
    @Param('id') id: string,
    @Body(new ZodPipe(redefinirSenhaAdminSchema)) dto: RedefinirSenhaAdmin,
    @PrincipalAtual() quem: PrincipalPlataforma,
  ): Promise<SenhaAdminRedefinida> {
    return this.empresas.redefinirSenhaAdmin(id, dto.usuarioId, dto.motivo, quem);
  }

  @Post('empresas/:id/suporte')
  @HttpCode(200)
  async entrarParaSuporte(
    @Param('id') id: string,
    @Body(new ZodPipe(entrarParaSuporteSchema)) dto: EntrarParaSuporte,
    @PrincipalAtual() quem: PrincipalPlataforma,
  ): Promise<SessaoSuporte> {
    return this.suporte.entrar(id, dto.motivo, quem);
  }

  /**
   * Só empresa VAZIA. Com histórico, a resposta manda suspender.
   *
   * Existe para o engano de cadastro ter volta — o slug é único na
   * plataforma e não se altera, então um erro de digitação ocuparia o
   * endereço para sempre.
   */
  @Delete('empresas/:id')
  @HttpCode(204)
  async excluir(
    @Param('id') id: string,
    @PrincipalAtual() quem: PrincipalPlataforma,
  ): Promise<void> {
    await this.empresas.excluirVazia(id, quem);
  }

  private gravarCookie(res: Response, refresh: string): void {
    res.cookie(COOKIE_PLATAFORMA, refresh, {
      httpOnly: true,
      sameSite: 'lax',
      // Caminho estreito: o cookie da plataforma não viaja nas chamadas da
      // empresa, e o da empresa não viaja aqui.
      path: '/api/plataforma',
      secure: process.env['COOKIE_SECURE'] === 'true',
    });
  }
}
