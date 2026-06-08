import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { Usuario } from '../users/entities/usuario.entity';

export const ACCESS_TOKEN_TTL_SECONDS = 3600;

@Injectable()
export class AuthTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issueForUsuario(
    usuario: Usuario,
    extra?: { pin_temporal?: boolean; username_local?: string },
  ) {
    const tenantId = usuario.tenantId;
    const accessToken = this.jwtService.sign({
      sub: usuario.id,
      email: usuario.email,
      role: 'authenticated',
      tenant_id: tenantId,
      tenant_home_id: tenantId,
      rol: usuario.rol,
      es_super_admin: usuario.esSuperAdmin,
      sucursal_default_id: usuario.sucursalDefaultId ?? undefined,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer' as const,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      ...(extra?.pin_temporal !== undefined ? { pin_temporal: extra.pin_temporal } : {}),
      user: {
        id: usuario.id,
        tenant_id: tenantId,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        ...(extra?.username_local ? { username_local: extra.username_local } : {}),
      },
    };
  }
}
