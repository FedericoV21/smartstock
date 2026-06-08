import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LectorFacturaLog } from './entities/lector-factura-log.entity';
import { LectorFacturasBaseService } from './lector-facturas-base.service';

@Injectable()
export class LectorFacturasLogsService {
  constructor(
    private readonly base: LectorFacturasBaseService,
    @InjectRepository(LectorFacturaLog)
    private readonly logRepo: Repository<LectorFacturaLog>,
  ) {}

  async listLogs() {
    await this.base.assertModuloLector();

    const logs = await this.logRepo.find({
      where: { tenantId: this.base.getTenantId() },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        estado: true,
        direccion: true,
        archivoNombre: true,
        comprobanteId: true,
        errorMensaje: true,
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        created_at: log.createdAt.toISOString(),
        updated_at: log.updatedAt.toISOString(),
        estado: log.estado,
        direccion: log.direccion,
        archivo_nombre: log.archivoNombre,
        comprobante_id: log.comprobanteId,
        error_mensaje: log.errorMensaje,
      })),
    };
  }
}
