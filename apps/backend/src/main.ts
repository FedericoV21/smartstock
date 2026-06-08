import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { configureApp } from './bootstrap/configure-app';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  configureApp(app, config);
  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
}
bootstrap();
