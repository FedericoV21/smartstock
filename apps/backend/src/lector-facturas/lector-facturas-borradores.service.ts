import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { LectorFacturaLog } from './entities/lector-factura-log.entity';
import { LectorFacturasBaseService } from './lector-facturas-base.service';
import {
  datosExtraidosConPayloadBorrador,
  esAdminBorradoresLector,
  logEntityToJsonRecord,
  mapLectorFacturaBorradorListItem,
  metadataUpdateDesdePayload,
  payloadBorradorDesdeLog,
  uuidOk,
  validarPayloadBorradorLector,
} from './utils/borradores-server.util';

function parseLimit(value: string | undefined): number {
  const parsed = value != null ? Number.parseInt(value, 10) : 40;
  if (!Number.isFinite(parsed)) return 40;
  return Math.min(80, Math.max(1, parsed));
}

@Injectable()
export class LectorFacturasBorradoresService {
  constructor(
    private readonly base: LectorFacturasBaseService,
    @InjectRepository(LectorFacturaLog)
    private readonly logRepo: Repository<LectorFacturaLog>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {}

  async list(user: AccessTokenPayload, limitRaw?: string) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    const tenantId = this.base.getTenantId();
    const limit = parseLimit(limitRaw);

    const where: Record<string, unknown> = {
      tenantId,
      estado: 'extraido',
    };
    if (!esAdminBorradoresLector(user)) {
      where.usuarioId = user.sub;
    }

    const rows = await this.logRepo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    const borradores = await Promise.all(
      rows.map(async (row) =>
        mapLectorFacturaBorradorListItem(await this.logToJsonRecord(row)),
      ),
    );
    return { borradores };
  }

  async getById(user: AccessTokenPayload, id: string) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    const log = await this.cargarBorrador(user, id);
    const ivaDefault = await this.ivaDefaultTenant();
    const row = await this.logToJsonRecord(log);
    const payload = payloadBorradorDesdeLog(row, ivaDefault);

    return {
      borrador: {
        ...mapLectorFacturaBorradorListItem(row),
        payload,
      },
    };
  }

  async update(user: AccessTokenPayload, id: string, body: { payload?: unknown }) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    const log = await this.cargarBorrador(user, id);
    const payload = validarPayloadBorradorLector(body.payload);

    if (payload.extraccion.log_id !== id) {
      throw new BadRequestException('El borrador no coincide con la extraccion');
    }

    const metadata = metadataUpdateDesdePayload(payload);
    const datosExtraidos = datosExtraidosConPayloadBorrador(log.datosExtraidos, payload);

    log.datosExtraidos = datosExtraidos as Record<string, unknown>;
    log.direccion = metadata.direccion;
    log.proveedorId = metadata.proveedor_id;
    log.clienteId = metadata.cliente_id;
    const updated = await this.logRepo.save(log);

    if (!updated) {
      throw new NotFoundException('Borrador no encontrado');
    }

    return {
      borrador: mapLectorFacturaBorradorListItem(await this.logToJsonRecord(updated)),
    };
  }

  async discard(user: AccessTokenPayload, id: string) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    await this.cargarBorrador(user, id);

    await this.logRepo.update(
      { id, tenantId: this.base.getTenantId() },
      { estado: 'descartado' },
    );

    return {};
  }

  private async cargarBorrador(user: AccessTokenPayload, id: string): Promise<LectorFacturaLog> {
    if (!uuidOk(id)) {
      throw new BadRequestException('ID invalido');
    }

    const log = await this.logRepo.findOne({
      where: { id, tenantId: this.base.getTenantId(), estado: 'extraido' },
    });

    if (!log) {
      throw new NotFoundException('Borrador no encontrado');
    }

    if (!esAdminBorradoresLector(user) && log.usuarioId !== user.sub) {
      throw new ForbiddenException('Sin permisos');
    }

    return log;
  }

  private async logToJsonRecord(log: LectorFacturaLog) {
    const [proveedor, cliente, usuario] = await Promise.all([
      log.proveedorId
        ? this.proveedorRepo.findOne({
            where: { id: log.proveedorId, tenantId: log.tenantId },
            select: { nombre: true },
          })
        : null,
      log.clienteId
        ? this.clienteRepo.findOne({
            where: { id: log.clienteId, tenantId: log.tenantId },
            select: { nombre: true, razonSocial: true },
          })
        : null,
      this.usuarioRepo.findOne({
        where: { id: log.usuarioId, tenantId: log.tenantId },
        select: { nombre: true, email: true },
      }),
    ]);

    return logEntityToJsonRecord(log, {
      proveedor: proveedor ? { nombre: proveedor.nombre } : null,
      cliente: cliente
        ? { nombre: cliente.nombre, razon_social: cliente.razonSocial }
        : null,
      usuario: usuario ? { nombre: usuario.nombre, email: usuario.email } : null,
    });
  }

  private async ivaDefaultTenant(): Promise<number> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: this.base.getTenantId() },
      select: { ivaPorcentajeDefault: true },
    });
    const iva = tenant?.ivaPorcentajeDefault;
    const n = iva != null ? Number.parseFloat(String(iva)) : NaN;
    return Number.isFinite(n) ? n : 21;
  }
}
