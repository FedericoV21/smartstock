import { SetMetadata } from '@nestjs/common';

import type { AppRole } from '../interfaces/access-token-payload.interface';
import { ROLES_KEY } from '../constants';

export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
