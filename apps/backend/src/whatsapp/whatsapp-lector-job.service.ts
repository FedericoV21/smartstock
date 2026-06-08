import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';

export type LectorFacturaJobArchivo = {
  nombre: string;
  mimeType: string;
  size: number;
  storageBucket: string;
  storagePath: string;
};

@Injectable()
export class WhatsappLectorJobService {
  constructor(
    @InjectRepository(LectorFacturaJob)
    private readonly lectorJobRepo: Repository<LectorFacturaJob>,
  ) {}

  async crearLectorFacturaJob(params: {
    tenantId: string;
    sucursalId: string | null;
    userId: string;
    source: 'whatsapp';
    whatsappProcessingJobId?: string | null;
    externalId?: string | null;
    idempotencyKey?: string | null;
    archivos: LectorFacturaJobArchivo[];
  }): Promise<{ id: string; status: string }> {
    const row = await this.lectorJobRepo.save({
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      usuarioId: params.userId,
      apiKeyId: null,
      whatsappProcessingJobId: params.whatsappProcessingJobId ?? null,
      source: params.source,
      status: 'queued',
      externalId: params.externalId?.trim() || null,
      idempotencyKey: params.idempotencyKey?.trim() || null,
      archivos: params.archivos,
    });

    return { id: row.id, status: row.status };
  }
}
