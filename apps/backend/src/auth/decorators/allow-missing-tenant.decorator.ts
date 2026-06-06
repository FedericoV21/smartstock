import { SetMetadata } from '@nestjs/common';

import { ALLOW_MISSING_TENANT_KEY } from '../constants';

/** Rutas autenticadas donde puede faltar `tenant_id` (p. ej. diagn├│stico post-login). */
export const AllowMissingTenant = () => SetMetadata(ALLOW_MISSING_TENANT_KEY, true);
