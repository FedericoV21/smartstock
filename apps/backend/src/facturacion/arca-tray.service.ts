import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { TIPOS_FISCALES_ARCA } from './constants/tipos-fiscales-arca';
import { Comprobante } from './entities/comprobante.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';

const ARCA_TRAY_LIMIT = 500;

@Injectable()
export class ArcaTrayService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
  ) {}

  async listTray(sucursalId?: string) {
    const tenantId = this.tenantContext.getTenantId();
    if (sucursalId) {
      await this.assertSucursal(tenantId, sucursalId);
    }

    const qb = this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.tipo IN (:...tipos)', { tipos: TIPOS_FISCALES_ARCA })
      .andWhere('c.estado IN (:...estados)', {
        estados: [EstadoComprobante.error_arca, EstadoComprobante.pendiente_arca],
      })
      .orderBy('c.ultimo_intento_arca_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .take(ARCA_TRAY_LIMIT);

    if (sucursalId) {
      qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    }

    const rows = await qb.getMany();
    const clienteIds = [...new Set(rows.map((r) => r.clienteId).filter((id): id is string => !!id))];
    const clientes =
      clienteIds.length > 0
        ? await this.clienteRepo.find({
            where: { tenantId, id: In(clienteIds) },
            select: {
              id: true,
              nombre: true,
              razonSocial: true,
              cuitDni: true,
              telefono: true,
            },
          })
        : [];
    const clienteMap = new Map(clientes.map((c) => [c.id, c]));

    return {
      data: rows.map((c) => this.serializeTrayItem(c, clienteMap.get(c.clienteId ?? '') ?? null)),
    };
  }

  async getAlertCount(sucursalId?: string) {
    const tenantId = this.tenantContext.getTenantId();
    if (sucursalId) {
      await this.assertSucursal(tenantId, sucursalId);
    }

    const qb = this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.tipo IN (:...tipos)', { tipos: TIPOS_FISCALES_ARCA })
      .andWhere('c.estado IN (:...estados)', {
        estados: [EstadoComprobante.error_arca, EstadoComprobante.pendiente_arca],
      });

    if (sucursalId) {
      qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    }

    const count = await qb.getCount();
    return { data: { count } };
  }

  private async assertSucursal(tenantId: string, sucursalId: string) {
    const ok = await this.sucursalRepo.exist({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!ok) {
      throw new NotFoundException('Sucursal no encontrada o inactiva.');
    }
  }

  private serializeTrayItem(
    c: Comprobante,
    cliente: Pick<Cliente, 'id' | 'nombre' | 'razonSocial' | 'cuitDni' | 'telefono'> | null | undefined,
  ) {
    return {
      id: c.id,
      tipo: c.tipo,
      estado: c.estado,
      total: Number(c.total),
      numeroOrden: c.numeroOrden ?? c.numero,
      numero: c.numero,
      createdAt: c.createdAt.toISOString(),
      intentosArca: c.intentosArca,
      ultimoErrorArcaCodigo: c.ultimoErrorArcaCodigo,
      ultimoErrorArcaMensaje: c.ultimoErrorArcaMensaje,
      ultimoIntentoArcaAt: c.ultimoIntentoArcaAt?.toISOString() ?? null,
      pdfUrl: c.pdfUrl,
      sucursalId: c.sucursalId,
      cliente: cliente
        ? {
            id: cliente.id,
            nombre: cliente.nombre,
            razonSocial: cliente.razonSocial,
            cuitDni: cliente.cuitDni,
            telefono: cliente.telefono,
          }
        : null,
    };
  }
}
