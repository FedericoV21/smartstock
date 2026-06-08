import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { normalizarTextoBusqueda } from '../pos/utils/normalize-busqueda.util';
import { DespieceBaseService } from './despiece-base.service';
import { serializeProductoCorte } from './utils/despiece-serialize.util';

@Injectable()
export class DespieceProductosCorteService {
  constructor(
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    private readonly base: DespieceBaseService,
  ) {}

  async list(q?: string, user?: AccessTokenPayload) {
    if (user) {
      await this.base.assertModuloDespiece();
      await this.base.assertPermisoVer(user);
    }

    const tenantId = this.base.getTenantId();
    const qTrim = (q ?? '').trim();
    const qNorm = qTrim ? normalizarTextoBusqueda(qTrim) : '';

    const qb = this.productoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true')
      .andWhere('p.es_pesable = true')
      .andWhere('p.unidad IN (:...unidades)', {
        unidades: [UnidadMedida.kg, UnidadMedida.gramo],
      })
      .orderBy('p.nombre', 'ASC')
      .take(50);

    if (qNorm) {
      qb.andWhere(
        '(p.nombre ILIKE :q OR p.codigo ILIKE :q OR COALESCE(p.plu, \'\') ILIKE :q)',
        { q: `%${qNorm}%` },
      );
    }

    const rows = await qb.getMany();
    return { productos: rows.map(serializeProductoCorte) };
  }
}
