import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(4000),
  DB_HOST: Joi.string().trim().min(1).required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().trim().min(1).required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().trim().min(1).required(),
  DB_SSL: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  DB_LOGGING: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  /** Secreto HS256 para validar JWT (preferido en despliegue Next + Nest + Postgres). */
  JWT_SECRET: Joi.string().trim().min(1).optional(),
  /** Alias legacy; basta con definir `JWT_SECRET` o este. */
  SUPABASE_JWT_SECRET: Joi.string().trim().min(1).optional(),
  ARCA_ENCRYPTION_KEY: Joi.string().length(32).optional(),
  TRUST_PROXY: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  THROTTLE_TTL_MS: Joi.number().integer().positive().default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(120),
  /** Secreto para `POST /api/v1/internal/arca-jobs/run` (cron / worker). */
  ARCA_WORKER_SECRET: Joi.string().allow('').default(''),
  /** Bearer para `GET /api/v1/cron/reintentar-arca` y `POST /api/v1/cron/arca-procesar`. */
  CRON_SECRET: Joi.string().allow('').default(''),
  ARCA_WORKER_BATCH_SIZE: Joi.number().integer().min(1).max(50).default(5),
  /** Solo con `arca_config.ambiente = homologacion`: asigna CAE ficticio sin llamar AFIP. */
  ARCA_WORKER_STUB: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  /** Subir PDF post-CAE a S3-compatible y persistir `comprobante.pdf_url`. */
  PDF_STORAGE_ENABLED: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  PDF_S3_BUCKET: Joi.string().allow('').default(''),
  PDF_S3_REGION: Joi.string().allow('').default('us-east-1'),
  PDF_S3_ENDPOINT: Joi.string().allow('').default(''),
  PDF_S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  PDF_S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  PDF_S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  /** Origen p├║blico (sin barra final); se concatena `/{tenantId}/{comprobanteId}.pdf`. */
  PDF_PUBLIC_BASE_URL: Joi.string().allow('').default(''),
  /** Miniaturas de producto ÔåÆ S3-compatible (bucket `producto-imagenes` o propio). */
  PRODUCT_IMAGE_STORAGE_ENABLED: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  PRODUCT_IMAGE_S3_BUCKET: Joi.string().allow('').default('producto-imagenes'),
  PRODUCT_IMAGE_S3_REGION: Joi.string().allow('').default(''),
  PRODUCT_IMAGE_S3_ENDPOINT: Joi.string().allow('').default(''),
  PRODUCT_IMAGE_S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  PRODUCT_IMAGE_S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  /** Origen p├║blico CDN; fallback a PDF_PUBLIC_BASE_URL si vac├¡o. */
  PRODUCT_IMAGE_PUBLIC_BASE_URL: Joi.string().allow('').default(''),
  /** Logo tenant ÔåÆ S3-compatible (bucket `tenant-logos`). Reutiliza credenciales de producto/PDF si no se define bucket propio. */
  TENANT_LOGO_STORAGE_ENABLED: Joi.boolean().truthy('true', '1').falsy('false', '0').optional(),
  TENANT_LOGO_S3_BUCKET: Joi.string().allow('').default('tenant-logos'),
  TENANT_LOGO_S3_REGION: Joi.string().allow('').default(''),
  TENANT_LOGO_S3_ENDPOINT: Joi.string().allow('').default(''),
  TENANT_LOGO_S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true', '1').falsy('false', '0').optional(),
  TENANT_LOGO_S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  TENANT_LOGO_S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  TENANT_LOGO_PUBLIC_BASE_URL: Joi.string().allow('').default(''),
  /** Invitaci├│n usuarios v├¡a Supabase Auth Admin (POST /config/users). */
  SUPABASE_URL: Joi.string().allow('').default(''),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').default(''),
  PUBLIC_APP_BASE_URL: Joi.string().allow('').default(''),
  /** Or├¡genes CORS permitidos (Next u otros), separados por coma. Vac├¡o = sin CORS expl├¡cito. */
  NEST_CORS_ORIGINS: Joi.string().allow('').default('http://localhost:3000'),
  /** Panel interno GinkGo (POST /api/v1/nexus-dashboard/login). */
  NEXUS_DASHBOARD_PASSWORD: Joi.string().allow('').optional(),
  NEXUS_DASHBOARD_SECRET: Joi.string().allow('').optional(),
})
  .custom((value, helpers) => {
    const jwt =
      (typeof value.JWT_SECRET === 'string' && value.JWT_SECRET.trim()) ||
      (typeof value.SUPABASE_JWT_SECRET === 'string' && value.SUPABASE_JWT_SECRET.trim());
    if (!jwt) {
      return helpers.error('any.custom', {
        message: 'Definir JWT_SECRET o SUPABASE_JWT_SECRET (HS256)',
      });
    }
    return value;
  })
  .prefs({ convert: true });
