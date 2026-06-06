import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import type { RequestWithId } from '../common/http/request-with-id';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check (liveness)' })
  getHealth(@Req() req: RequestWithId) {
    return {
      data: {
        status: 'ok',
        service: 'smartstock-backend',
      },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
