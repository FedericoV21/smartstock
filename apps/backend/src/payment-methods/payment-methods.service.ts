import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CreateMedioPagoDto, UpdateMedioPagoDto } from './dto/upsert-medio-pago.dto';
import { MedioPagoOpcionDto } from './dto/medio-pago-opcion.dto';
import { UpsertRapidosDto } from './dto/upsert-rapidos.dto';
import { MedioPagoOpcion } from './entities/medio-pago-opcion.entity';
import { MedioPagoRapido } from './entities/medio-pago-rapido.entity';
import { MedioPago } from './entities/medio-pago.entity';
import {
  CODIGOS_MEDIO_RAPIDO,
  CodigoMedioRapido,
  DEFAULT_RAPIDOS,
} from './enums/codigo-medio-rapido.enum';

@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectRepository(MedioPago)
    private readonly medioPagoRepo: Repository<MedioPago>,
    @InjectRepository(MedioPagoOpcion)
    private readonly opcionRepo: Repository<MedioPagoOpcion>,
    @InjectRepository(MedioPagoRapido)
    private readonly rapidoRepo: Repository<MedioPagoRapido>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
  ) {}

  async listAll() {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();

    const [medios, rapidosMap] = await Promise.all([
      this.loadMedios(tenantId),
      this.loadRapidosMap(tenantId),
    ]);

    return {
      data: {
        medios,
        rapidos: rapidosMap,
      },
    };
  }

  async listRapidosOnly() {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();
    const rapidos = await this.loadRapidosMap(tenantId);
    return { data: { rapidos } };
  }

  async create(dto: CreateMedioPagoDto) {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();
    const opciones = this.parseOpciones(dto.opciones);

    const medio = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(MedioPago, {
          tenantId,
          nombre: dto.nombre.trim(),
          activo: dto.activo !== false,
          orden: dto.orden ?? 0,
        }),
      );

      await manager.save(
        MedioPagoOpcion,
        opciones.map((o) =>
          manager.create(MedioPagoOpcion, {
            medioPagoId: saved.id,
            cuotas: o.cuotas,
            recargoPorcentaje: o.recargo_porcentaje.toFixed(4),
          }),
        ),
      );

      return saved;
    });

    const completo = await this.getMedioById(tenantId, medio.id);
    return { data: { medio: completo } };
  }

  async update(id: string, dto: UpdateMedioPagoDto) {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();

    const existente = await this.medioPagoRepo.findOne({ where: { id, tenantId } });
    if (!existente) {
      throw new NotFoundException('Medio de pago no encontrado.');
    }

    await this.dataSource.transaction(async (manager) => {
      const patch: Partial<MedioPago> = {};
      if (dto.nombre?.trim()) patch.nombre = dto.nombre.trim();
      if (typeof dto.activo === 'boolean') patch.activo = dto.activo;
      if (typeof dto.orden === 'number') patch.orden = dto.orden;

      if (Object.keys(patch).length > 0) {
        await manager.update(MedioPago, { id, tenantId }, patch);
      }

      if (dto.opciones && dto.opciones.length > 0) {
        const opciones = this.parseOpciones(dto.opciones);
        await manager.delete(MedioPagoOpcion, { medioPagoId: id });
        await manager.save(
          MedioPagoOpcion,
          opciones.map((o) =>
            manager.create(MedioPagoOpcion, {
              medioPagoId: id,
              cuotas: o.cuotas,
              recargoPorcentaje: o.recargo_porcentaje.toFixed(4),
            }),
          ),
        );
      }
    });

    const medio = await this.getMedioById(tenantId, id);
    return { data: { medio } };
  }

  async remove(id: string) {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();

    const result = await this.medioPagoRepo.delete({ id, tenantId });
    if (!result.affected) {
      throw new NotFoundException('Medio de pago no encontrado.');
    }

    return { data: { ok: true } };
  }

  async upsertRapidos(dto: UpsertRapidosDto) {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();

    const values: Record<CodigoMedioRapido, number> = { ...DEFAULT_RAPIDOS };
    for (const codigo of CODIGOS_MEDIO_RAPIDO) {
      const raw = dto[codigo];
      if (raw === undefined || raw === null || raw === ('' as unknown)) {
        values[codigo] = 0;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(`Porcentaje inv├ílido para ${codigo}`);
      }
      values[codigo] = n;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(MedioPagoRapido, { tenantId });
      const toInsert = CODIGOS_MEDIO_RAPIDO.filter((c) => values[c] !== 0).map((codigo) =>
        manager.create(MedioPagoRapido, {
          tenantId,
          codigo,
          recargoPorcentaje: values[codigo].toFixed(4),
        }),
      );
      if (toInsert.length > 0) {
        await manager.save(MedioPagoRapido, toInsert);
      }
    });

    const rapidos = await this.loadRapidosMap(tenantId);
    return { data: { rapidos } };
  }

  private async loadMedios(tenantId: string) {
    const rows = await this.medioPagoRepo.find({
      where: { tenantId },
      relations: { opciones: true },
      order: { orden: 'ASC', nombre: 'ASC' },
    });

    return rows.map((m) => this.serializeMedio(m));
  }

  private async getMedioById(tenantId: string, id: string) {
    const row = await this.medioPagoRepo.findOne({
      where: { id, tenantId },
      relations: { opciones: true },
    });
    if (!row) {
      throw new NotFoundException('Medio de pago no encontrado.');
    }
    return this.serializeMedio(row);
  }

  private serializeMedio(m: MedioPago) {
    const opciones = [...(m.opciones ?? [])].sort((a, b) => a.cuotas - b.cuotas);
    return {
      id: m.id,
      nombre: m.nombre,
      activo: m.activo,
      orden: m.orden,
      created_at: m.createdAt.toISOString(),
      medio_pago_opcion: opciones.map((o) => ({
        id: o.id,
        cuotas: o.cuotas,
        recargo_porcentaje: Number(o.recargoPorcentaje),
      })),
    };
  }

  private async loadRapidosMap(tenantId: string): Promise<Record<CodigoMedioRapido, number>> {
    const rows = await this.rapidoRepo.find({ where: { tenantId } });
    const rapidos = { ...DEFAULT_RAPIDOS };
    for (const row of rows) {
      if (row.codigo in rapidos) {
        rapidos[row.codigo] = Number(row.recargoPorcentaje);
      }
    }
    return rapidos;
  }

  private parseOpciones(opcionesRaw: MedioPagoOpcionDto[]): MedioPagoOpcionDto[] {
    if (!Array.isArray(opcionesRaw) || opcionesRaw.length === 0) {
      throw new BadRequestException('Agreg├í al menos una fila de cuotas y recargo/descuento (%).');
    }

    const opciones: MedioPagoOpcionDto[] = [];
    for (const row of opcionesRaw) {
      const cuotas = Math.floor(Number(row.cuotas));
      const pct = Number(row.recargo_porcentaje);
      if (!Number.isFinite(cuotas) || cuotas < 1) {
        throw new BadRequestException('Cada opci├│n debe tener cuotas ÔëÑ 1.');
      }
      if (!Number.isFinite(pct)) {
        throw new BadRequestException('Porcentaje inv├ílido en las opciones.');
      }
      opciones.push({ cuotas, recargo_porcentaje: pct });
    }

    const cuotasSet = new Set(opciones.map((o) => o.cuotas));
    if (cuotasSet.size !== opciones.length) {
      throw new BadRequestException('No puede haber dos filas con la misma cantidad de cuotas.');
    }

    return opciones;
  }

  private async assertFacturadorSimple(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos?.facturadorSimple) {
      throw new ForbiddenException('El m├│dulo facturador_simple no est├í habilitado.');
    }
  }
}
