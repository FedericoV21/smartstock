import { ConfigService } from '@nestjs/config';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export function assertCronBearerAuth(
  config: ConfigService,
  authorization: string | undefined,
): void {
  const secret = config.get<string>('CRON_SECRET', '');
  if (!secret) {
    throw new ServiceUnavailableException('CRON_SECRET no configurado');
  }
  if (authorization !== `Bearer ${secret}`) {
    throw new UnauthorizedException('No autorizado');
  }
}
