import { ForbiddenException, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';

type AuthedRequest = Request & { user?: AccessTokenPayload };

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  constructor(@Inject(REQUEST) private readonly request: AuthedRequest) {}

  getTenantId(): string {
    const tid = this.request.user?.tenant_id;
    if (!tid || typeof tid !== 'string' || tid.trim() === '') {
      throw new ForbiddenException('Missing tenant_id in access token');
    }
    return tid;
  }

  getTenantIdOptional(): string | null {
    const tid = this.request.user?.tenant_id;
    if (typeof tid === 'string' && tid.trim() !== '') {
      return tid;
    }
    return null;
  }
}
