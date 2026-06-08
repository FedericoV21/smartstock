import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Tenant } from '../config/entities/tenant.entity';
import { Producto } from '../products/entities/producto.entity';
import { CreateAgendaDto } from './dto/create-agenda.dto';
import { ListTurnosSucursalQueryDto } from './dto/list-turnos-query.dto';
import { UpdateAgendaDto } from './dto/update-agenda.dto';
import { TurnoAgendaDisponibilidad } from './entities/turno-agenda-disponibilidad.entity';
import { TurnoAgendaExtraHorario } from './entities/turno-agenda-extra-horario.entity';
import { TurnoAgenda } from './entities/turno-agenda.entity';
import { TurnosBaseService } from './turnos-base.service';
import { validateAgendaPrincipalId } from './utils/agenda-link.util';
import { ensureAgendaServiceProduct } from './utils/agenda-service-product.util';
import { money, parseDisponibilidad, parseExtrasHorarios, strOrNull } from './utils/turnos-api.util';
import { serializeAgenda } from './utils/turnos-serialize.util';

@Injectable()
export class TurnosAgendasService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TurnoAgenda) private readonly agendaRepo: Repository<TurnoAgenda>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly base: TurnosBaseService,
  ) {}

  async list(query: ListTurnosSucursalQueryDto) {
    await this.base.assertModuloTurnos();
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId(query.sucursal_id);

    const agendas = await this.agendaRepo.find({
      where: { tenantId, sucursalId },
      relations: ['disponibilidad', 'extrasHorarios', 'reservasFijas'],
      order: { activa: 'DESC', nombre: 'ASC' },
    });

    return {
      agendas: agendas.map(serializeAgenda),
      sucursal_id: sucursalId,
    };
  }

  async create(dto: CreateAgendaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    const nombre = strOrNull(dto.nombre, 120);
    if (!nombre) {
      throw new BadRequestException('El nombre de la agenda es obligatorio');
    }
    const disponibilidad = parseDisponibilidad(dto.disponibilidad);
    if (disponibilidad.length === 0) {
      throw new BadRequestException('La agenda necesita al menos un horario semanal.');
    }
    const extrasHorarios = parseExtrasHorarios(dto.extras_horarios ?? []);
    const precio = money(dto.precio);

    const agendaPrincipalId = await validateAgendaPrincipalId({
      agendaRepo: this.agendaRepo,
      tenantId,
      sucursalId,
      agendaId: null,
      agendaPrincipalIdRaw: dto.agenda_principal_id,
    });

    const agenda = await this.dataSource.transaction(async (manager) => {
      const agendaEntity = manager.create(TurnoAgenda, {
        tenantId,
        sucursalId,
        nombre,
        descripcion: strOrNull(dto.descripcion, 500),
        precio: precio.toFixed(2),
        duracionMinutos: 60,
        activa: dto.activa !== false,
        agendaPrincipalId,
      });
      const saved = await manager.save(TurnoAgenda, agendaEntity);

      const tenant = await manager.findOne(Tenant, {
        where: { id: tenantId },
        select: { ivaPorcentajeDefault: true },
      });
      const productoId = await ensureAgendaServiceProduct(this.productoRepo, {
        tenantId,
        sucursalId,
        agendaId: saved.id,
        nombre,
        precio,
        ivaPorcentaje: Number(tenant?.ivaPorcentajeDefault ?? 21),
      });

      await manager.update(TurnoAgenda, { id: saved.id, tenantId }, { productoId });

      await manager.save(
        TurnoAgendaDisponibilidad,
        disponibilidad.map((r) =>
          manager.create(TurnoAgendaDisponibilidad, {
            tenantId,
            agendaId: saved.id,
            diaSemana: r.dia_semana,
            horaInicio: r.hora_inicio,
            horaFin: r.hora_fin,
          }),
        ),
      );

      if (extrasHorarios.length > 0) {
        await manager.save(
          TurnoAgendaExtraHorario,
          extrasHorarios.map((r) =>
            manager.create(TurnoAgendaExtraHorario, {
              tenantId,
              agendaId: saved.id,
              diaSemana: r.dia_semana,
              horaInicio: r.hora_inicio,
              horaFin: r.hora_fin,
              extraMonto: String(r.extra_monto),
              descripcion: r.descripcion,
              activa: r.activa !== false,
            }),
          ),
        );
      }

      return saved.id;
    });

    const created = await this.loadAgendaFull(agenda, tenantId, sucursalId);
    return { agenda: serializeAgenda(created) };
  }

  async update(id: string, dto: UpdateAgendaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    const actual = await this.agendaRepo.findOne({
      where: { id, tenantId, sucursalId },
    });
    if (!actual) {
      throw new NotFoundException('Agenda no encontrada');
    }

    const updates: Partial<TurnoAgenda> = {};
    if (dto.nombre !== undefined) {
      const nombre = strOrNull(dto.nombre, 120);
      if (!nombre) {
        throw new BadRequestException('El nombre de la agenda es obligatorio');
      }
      updates.nombre = nombre;
    }
    if (dto.descripcion !== undefined) updates.descripcion = strOrNull(dto.descripcion, 500);
    if (dto.precio !== undefined) updates.precio = money(dto.precio).toFixed(2);
    if (typeof dto.activa === 'boolean') updates.activa = dto.activa;

    let disponibilidadRows: ReturnType<typeof parseDisponibilidad> | null = null;
    if (dto.disponibilidad !== undefined) {
      disponibilidadRows = parseDisponibilidad(dto.disponibilidad);
      if (disponibilidadRows.length === 0) {
        throw new BadRequestException('La agenda necesita al menos un horario semanal.');
      }
    }

    let extrasHorariosRows: ReturnType<typeof parseExtrasHorarios> | null = null;
    if (dto.extras_horarios !== undefined) {
      extrasHorariosRows = parseExtrasHorarios(dto.extras_horarios);
    }

    if (dto.agenda_principal_id !== undefined) {
      updates.agendaPrincipalId = await validateAgendaPrincipalId({
        agendaRepo: this.agendaRepo,
        tenantId,
        sucursalId,
        agendaId: id,
        agendaPrincipalIdRaw: dto.agenda_principal_id,
      });
    }

    const nextNombre = updates.nombre ?? actual.nombre;
    const nextPrecio = Number(updates.precio ?? actual.precio ?? 0);
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { ivaPorcentajeDefault: true },
    });
    const productoId = await ensureAgendaServiceProduct(this.productoRepo, {
      tenantId,
      sucursalId,
      agendaId: id,
      productoId: actual.productoId,
      nombre: nextNombre,
      precio: nextPrecio,
      ivaPorcentaje: Number(tenant?.ivaPorcentajeDefault ?? 21),
    });
    updates.productoId = productoId;

    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(updates).length > 0) {
        await manager.update(TurnoAgenda, { id, tenantId, sucursalId }, updates);
      }

      if (disponibilidadRows) {
        await manager.delete(TurnoAgendaDisponibilidad, { agendaId: id, tenantId });
        await manager.save(
          TurnoAgendaDisponibilidad,
          disponibilidadRows.map((r) =>
            manager.create(TurnoAgendaDisponibilidad, {
              tenantId,
              agendaId: id,
              diaSemana: r.dia_semana,
              horaInicio: r.hora_inicio,
              horaFin: r.hora_fin,
            }),
          ),
        );
      }

      if (extrasHorariosRows) {
        await manager.delete(TurnoAgendaExtraHorario, { agendaId: id, tenantId });
        if (extrasHorariosRows.length > 0) {
          await manager.save(
            TurnoAgendaExtraHorario,
            extrasHorariosRows.map((r) =>
              manager.create(TurnoAgendaExtraHorario, {
                tenantId,
                agendaId: id,
                diaSemana: r.dia_semana,
                horaInicio: r.hora_inicio,
                horaFin: r.hora_fin,
                extraMonto: String(r.extra_monto),
                descripcion: r.descripcion,
                activa: r.activa !== false,
              }),
            ),
          );
        }
      }
    });

    const agenda = await this.loadAgendaFull(id, tenantId, sucursalId);
    return { agenda: serializeAgenda(agenda) };
  }

  async softDelete(id: string, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    const result = await this.agendaRepo.update(
      { id, tenantId, sucursalId },
      { activa: false },
    );
    if (!result.affected) {
      throw new NotFoundException('Agenda no encontrada');
    }
    return { ok: true };
  }

  private async loadAgendaFull(id: string, tenantId: string, sucursalId: string) {
    const agenda = await this.agendaRepo.findOne({
      where: { id, tenantId, sucursalId },
      relations: ['disponibilidad', 'extrasHorarios', 'reservasFijas'],
    });
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }
    return agenda;
  }
}
