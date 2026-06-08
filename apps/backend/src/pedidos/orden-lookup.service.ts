import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { UsuarioPedidoWorkflowEstado } from '../rbac/entities/usuario-pedido-workflow-estado.entity';
import { Pedido } from './entities/pedido.entity';
import {
  mapComprobanteADocumento,
  mapPedidoADocumento,
} from './utils/orden-lookup.util';

@Injectable()
export class OrdenLookupService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Pedido) private readonly pedidoRepo: Repository<Pedido>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(UsuarioPedidoWorkflowEstado)
    private readonly workflowUsuarioRepo: Repository<UsuarioPedidoWorkflowEstado>,
    private readonly tenantContext: TenantContext,
  ) {}

  async lookup(numeroOrdenRaw: string, user: AccessTokenPayload) {
    await this.assertModulo();

    const numeroOrden = Number(numeroOrdenRaw);
    if (!Number.isInteger(numeroOrden) || numeroOrden <= 0) {
      throw new BadRequestException('numero_orden inválido');
    }

    const tenantId = this.tenantContext.getTenantId();
    const filterWorkflowIds = await this.resolveWorkflowFilterIds(user);

    const [comps, peds] = await Promise.all([
      this.comprobanteRepo.find({
        where: { tenantId, numeroOrden },
        select: {
          id: true,
          tipo: true,
          numero: true,
          fecha: true,
          createdAt: true,
          estado: true,
          total: true,
        },
        order: { createdAt: 'ASC' },
      }),
      this.pedidoRepo.find({
        where: {
          tenantId,
          numeroOrden,
          ...(filterWorkflowIds && filterWorkflowIds.length > 0
            ? { workflowEstadoId: In(filterWorkflowIds) }
            : {}),
        },
        select: {
          id: true,
          estado: true,
          fecha: true,
          createdAt: true,
          total: true,
        },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const documentosConOrden = [
      ...comps.map((c) => ({ createdAt: c.createdAt, doc: mapComprobanteADocumento(c) })),
      ...peds.map((p) => ({ createdAt: p.createdAt, doc: mapPedidoADocumento(p) })),
    ]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((x) => x.doc);

    return {
      numero_orden: numeroOrden,
      documentos: documentosConOrden,
    };
  }

  private async resolveWorkflowFilterIds(user: AccessTokenPayload): Promise<string[] | null> {
    if (user.es_super_admin === true || resolveAppRole(user) === 'admin') {
      return null;
    }

    const rows = await this.workflowUsuarioRepo.find({
      where: {
        tenantId: this.tenantContext.getTenantId(),
        usuarioId: user.sub,
      },
      select: { workflowEstadoId: true },
    });

    if (rows.length === 0) {
      return null;
    }

    const unique = [...new Set(rows.map((r) => r.workflowEstadoId).filter(Boolean))];
    return unique.length > 0 ? unique : null;
  }

  private async assertModulo(): Promise<void> {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.facturadorSimple && !mod?.pedidos && !mod?.presupuestos) {
      throw new ForbiddenException(
        'Requiere al menos uno de: facturador_simple, pedidos o presupuestos.',
      );
    }
  }
}
