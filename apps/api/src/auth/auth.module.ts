import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController, PortalAuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // Sem segredo global de propósito: cada assinatura e verificação informa
    // o segredo do seu domínio. Um segredo padrão aqui seria usado por
    // engano em algum ponto, e os dois domínios voltariam a ser um só.
    JwtModule.register({}),
  ],
  controllers: [AuthController, PortalAuthController],
  // `AuditoriaService` vem do `ComumModule`, que é global.
  providers: [AuthService, TokensService],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
