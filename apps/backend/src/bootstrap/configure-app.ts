import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

export function configureApp(app: INestApplication, config: ConfigService): void {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');

  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const corsRaw = config.get<string>('NEST_CORS_ORIGINS', 'http://localhost:3000') ?? '';
  const corsOrigins = corsRaw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
      credentials: true,
    });
  }

  if (config.get<boolean>('TRUST_PROXY', false)) {
    const instance = app.getHttpAdapter().getInstance() as {
      set?: (key: string, value: unknown) => void;
    };
    instance.set?.('trust proxy', 1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'api/docs', method: RequestMethod.ALL },
      { path: 'api/docs/(.*)', method: RequestMethod.ALL },
    ],
  });

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SmartStock API')
      .setDescription('Contratos backend NestJS (v1)')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          in: 'header',
        },
        'access-token',
      )
      .build();

    // Evita conflicto de tipos si hay dos resoluciones de `@nestjs/*` (workspace + local).
    const document = SwaggerModule.createDocument(app as never, swaggerConfig);
    SwaggerModule.setup('api/docs', app as never, document, {
      customSiteTitle: 'SmartStock API',
    });
  }
}
