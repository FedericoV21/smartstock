import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { MergeSuppliersDto } from './dto/merge-suppliers.dto';

@Injectable()
export class SupplierMergeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
  ) {}

  async merge(dto: MergeSuppliersDto) {
    await this.assertStockModuleEnabled();

    const tenantId = this.tenantContext.getTenantId();
    const loserIds = [...new Set(dto.loserIds.map((id) => id.trim()).filter(Boolean))];

    if (loserIds.length === 0) {
      throw new BadRequestException('loserIds debe ser un array de UUID no vac├¡o');
    }
    if (loserIds.includes(dto.survivorId)) {
      throw new BadRequestException('El proveedor destino no puede figurar entre los fusionados');
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT public.fusionar_proveedores($1::uuid, $2::uuid, $3::uuid[], $4::boolean) AS result`,
        [tenantId, dto.survivorId, loserIds, dto.dryRun ?? false],
      );
      const result = rows[0]?.result ?? rows[0]?.fusionar_proveedores;
      return { data: result ?? {} };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Error al fusionar proveedores';

      const isUser = /no encontrado|distintos|autorizado|Indic├í|receptor|tenant/i.test(msg);
      if (isUser) {
        throw new BadRequestException(msg);
      }
      throw new InternalServerErrorException(msg);
    }
  }

  private async assertStockModuleEnabled(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuraci├│n de m├│dulos no encontrada');
    }
    if (!modulos.stock) {
      throw new ForbiddenException('M├│dulo stock no habilitado');
    }
  }
}
