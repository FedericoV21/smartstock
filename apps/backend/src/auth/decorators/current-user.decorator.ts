import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AccessTokenPayload } from '../interfaces/access-token-payload.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const request = ctx.switchToHttp().getRequest<{ user?: AccessTokenPayload }>();
    return request.user as AccessTokenPayload;
  },
);
