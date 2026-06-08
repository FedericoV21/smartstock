import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import {
  getNexusDashboardPassword,
  NEXUS_DASHBOARD_COOKIE,
  parseCookieHeader,
  signNexusDashboardSession,
  verifyNexusDashboardSession,
} from './utils/auth-cookie.util';

@Injectable()
export class NexusDashboardAuthService {
  assertPassword(password: string): string {
    if (password !== getNexusDashboardPassword()) {
      throw new UnauthorizedException('Contraseña incorrecta.');
    }
    return signNexusDashboardSession();
  }

  readSessionToken(request: Request): string | undefined {
    const cookies = parseCookieHeader(request.headers.cookie);
    return cookies[NEXUS_DASHBOARD_COOKIE];
  }

  assertSession(request: Request): void {
    const token = this.readSessionToken(request);
    if (!verifyNexusDashboardSession(token)) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  isSessionValid(request: Request): boolean {
    return verifyNexusDashboardSession(this.readSessionToken(request));
  }
}
