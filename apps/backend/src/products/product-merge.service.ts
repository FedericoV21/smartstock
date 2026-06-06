import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { MergeProductsDto } from './dto/merge-products.dto';
import { buildFusionarProductoCamposPayload } from './utils/fusionar-producto-campos.util';

@Injectable()
export class ProductMergeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
  ) {}

  async merge(dto: MergeProductsDto) {
    const tenantId = this.tenantContext.getTenantId();
    const loserId = dto.loserIds[0]?.trim();

    if (!loserId) {
      throw new BadRequestException('loserIds debe ser un array con un UUID');
    }
    if (loserId === dto.survivorId) {
      throw new BadRequestException('El destino y el origen no pueden ser el mismo producto');
    }

    let campos: Record<string, string>;
    try {
      campos = buildFusionarProductoCamposPayload(dto.campos);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT public.fusionar_productos($1::uuid, $2::uuid, $3::uuid[], $4::jsonb, $5::boolean) AS result`,
        [tenantId, dto.survivorId, [loserId], JSON.stringify(campos), dto.dryRun ?? false],
      );
      const result = rows[0]?.result ?? rows[0]?.fusionar_productos;
      return { data: result ?? {} };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Error al fusionar productos';

      const isUser =
        /no encontrado|distintos|Indic├í|mismo|coincidir|unicidad|PLU|pesable|permitida|usar survivor|Conflicto de unicidad|dep├│sito|proveedor|unidad/i.test(
          msg,
        );
      if (isUser) {
        throw new BadRequestException(msg);
      }
      throw new InternalServerErrorException(msg);
    }
  }
}
