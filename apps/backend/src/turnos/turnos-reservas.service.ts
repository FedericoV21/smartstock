import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { FacturacionService } from '../facturacion/facturacion.service';
import { Producto } from '../products/entities/producto.entity';
import { CobrarReservaDto } from './dto/cobrar-reserva.dto';
import { ConfirmarCobroReservaDto } from './dto/confirmar-cobro-reserva.dto';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { ListReservasQueryDto } from './dto/list-reservas-query.dto';
import { UpdateReservaDto } from './dto/update-reserva.dto';
import { TurnoAgendaDisponibilidad } from './entities/turno-agenda-disponibilidad.entity';
import { TurnoAgendaExtraHorario } from './entities/turno-agenda-extra-horario.entity';
import { TurnoAgenda } from './entities/turno-agenda.entity';
import { TurnoBloqueo } from './entities/turno-bloqueo.entity';
import { TurnoReservaFija } from './entities/turno-reserva-fija.entity';
import { TurnoReserva } from './entities/turno-reserva.entity';
import { TurnoReservaEstado } from './enums/turno-reserva-estado.enum';
import { TurnosBaseService } from './turnos-base.service';
import { ensureAgendaServiceProduct } from './utils/agenda-service-product.util';
import {
  money,
  parseFechaYmd,
  parseHoraReq,
  strOrNull,
  UUID_RE,
} from './utils/turnos-api.util';
import { serializeReserva } from './utils/turnos-serialize.util';
import {
  addDaysYmd,
  calcularExtraHorario,
  estaDisponible,
  minutesToTime,
  rangeDurationMinutes,
  timeToMinutes,
  type BloqueoTurno,
  type DisponibilidadSemanal,
  type ExtraHorarioTurno,
  type ReservaFijaTurno,
  type ReservaTurno,
} from './utils/turnos-slots.util';

const METODOS_PAGO = new Set([
  'efectivo',
  'debito',
  'credito',
  'transferencia',
  'cuenta_corriente',
]);

@Injectable()
export class TurnosReservasService {
  constructor(
    @InjectRepository(TurnoAgenda) private readonly agendaRepo: Repository<TurnoAgenda>,
    @InjectRepository(TurnoAgendaDisponibilidad)
    private readonly disponibilidadRepo: Repository<TurnoAgendaDisponibilidad>,
    @InjectRepository(TurnoAgendaExtraHorario)
    private readonly extraHorarioRepo: Repository<TurnoAgendaExtraHorario>,
    @InjectRepository(TurnoBloqueo) private readonly bloqueoRepo: Repository<TurnoBloqueo>,
    @InjectRepository(TurnoReserva) private readonly reservaRepo: Repository<TurnoReserva>,
    @InjectRepository(TurnoReservaFija) private readonly reservaFijaRepo: Repository<TurnoReservaFija>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    private readonly base: TurnosBaseService,
    private readonly facturacionService: FacturacionService,
  ) {}

  async list(query: ListReservasQueryDto) {
    await this.base.assertModuloTurnos();
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId(query.sucursal_id);

    const desde = parseFechaYmd(query.desde);
    const hasta = parseFechaYmd(query.hasta) ?? desde;
    if (!desde || !hasta) {
      throw new BadRequestException('desde y hasta son requeridos');
    }

    const agendaId = query.agenda_id?.trim() ?? '';
    if (agendaId && !UUID_RE.test(agendaId)) {
      throw new BadRequestException('agenda_id invalido');
    }

    const qb = this.reservaRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.agenda', 'agenda')
      .leftJoinAndSelect('r.cliente', 'cliente')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.sucursal_id = :sucursalId', { sucursalId })
      .andWhere('r.fecha >= :desde', { desde })
      .andWhere('r.fecha <= :hasta', { hasta })
      .orderBy('r.fecha', 'ASC')
      .addOrderBy('r.hora_inicio', 'ASC');

    if (agendaId) {
      qb.andWhere('r.agenda_id = :agendaId', { agendaId });
    }

    const reservas = await qb.getMany();
    return {
      reservas: reservas.map(serializeReserva),
      sucursal_id: sucursalId,
    };
  }

  async create(dto: CreateReservaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    const agendaId = String(dto.agenda_id ?? '').trim();
    const fecha = parseFechaYmd(dto.fecha);
    const horaInicio = parseHoraReq(dto.hora_inicio);
    if (!UUID_RE.test(agendaId) || !fecha || !horaInicio) {
      throw new BadRequestException('agenda_id, fecha y hora_inicio son requeridos');
    }

    const agenda = await this.agendaRepo.findOne({
      where: { id: agendaId, tenantId, sucursalId, activa: true },
    });
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }

    const inicioMin = timeToMinutes(horaInicio);
    const duracion = Number(agenda.duracionMinutos ?? 60);
    if (inicioMin == null || !Number.isFinite(duracion) || duracion <= 0 || duracion >= 24 * 60) {
      throw new BadRequestException('Horario invalido');
    }
    const horaFin = minutesToTime(inicioMin + duracion);
    if (rangeDurationMinutes(horaInicio, horaFin) == null) {
      throw new BadRequestException('Horario invalido');
    }

    const clienteIdRaw = String(dto.cliente_id ?? '').trim();
    const clienteId = clienteIdRaw ? clienteIdRaw : null;
    if (clienteId && !UUID_RE.test(clienteId)) {
      throw new BadRequestException('cliente_id invalido');
    }

    let nombre = strOrNull(dto.nombre, 180);
    if (clienteId) {
      const cliente = await this.clienteRepo.findOne({ where: { id: clienteId, tenantId } });
      if (!cliente) {
        throw new NotFoundException('Cliente no encontrado');
      }
      nombre = nombre ?? cliente.razonSocial ?? cliente.nombre;
    }
    if (!nombre) {
      throw new BadRequestException('El nombre de la reserva es obligatorio');
    }

    const fechaDesdeCheck = addDaysYmd(fecha, -1);
    const fechaHastaCheck = addDaysYmd(fecha, 1);

    const [disponibilidad, bloqueos, reservas, reservasFijas, extrasHorarios] = await Promise.all([
      this.disponibilidadRepo.find({ where: { tenantId, agendaId } }),
      this.bloqueoRepo
        .createQueryBuilder('b')
        .where('b.tenant_id = :tenantId', { tenantId })
        .andWhere('b.agenda_id = :agendaId', { agendaId })
        .andWhere('b.fecha >= :desde', { desde: fechaDesdeCheck })
        .andWhere('b.fecha <= :hasta', { hasta: fechaHastaCheck })
        .getMany(),
      this.reservaRepo
        .createQueryBuilder('r')
        .where('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.agenda_id = :agendaId', { agendaId })
        .andWhere('r.fecha >= :desde', { desde: fechaDesdeCheck })
        .andWhere('r.fecha <= :hasta', { hasta: fechaHastaCheck })
        .andWhere('r.estado != :cancelado', { cancelado: TurnoReservaEstado.cancelado })
        .getMany(),
      this.reservaFijaRepo.find({ where: { tenantId, agendaId, activa: true } }),
      this.extraHorarioRepo.find({ where: { tenantId, agendaId, activa: true } }),
    ]);

    let reservasParaCheck = this.mapReservasTurno(reservas);
    let reservasFijasParaCheck = this.mapReservasFijasTurno(reservasFijas);

    if (agenda.agendaPrincipalId) {
      const [reservasPrincipal, reservasFijasPrincipal] = await Promise.all([
        this.reservaRepo
          .createQueryBuilder('r')
          .where('r.tenant_id = :tenantId', { tenantId })
          .andWhere('r.agenda_id = :agendaId', { agendaId: agenda.agendaPrincipalId })
          .andWhere('r.fecha >= :desde', { desde: fechaDesdeCheck })
          .andWhere('r.fecha <= :hasta', { hasta: fechaHastaCheck })
          .andWhere('r.estado != :cancelado', { cancelado: TurnoReservaEstado.cancelado })
          .getMany(),
        this.reservaFijaRepo.find({
          where: { tenantId, agendaId: agenda.agendaPrincipalId, activa: true },
        }),
      ]);
      reservasParaCheck = [...reservasParaCheck, ...this.mapReservasTurno(reservasPrincipal)];
      reservasFijasParaCheck = [
        ...reservasFijasParaCheck,
        ...this.mapReservasFijasTurno(reservasFijasPrincipal),
      ];
    }

    const disponible = estaDisponible({
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      disponibilidad: this.mapDisponibilidad(disponibilidad),
      bloqueos: this.mapBloqueos(bloqueos),
      reservas: reservasParaCheck,
      reservasFijas: reservasFijasParaCheck,
    });
    if (!disponible) {
      throw new ConflictException('El horario ya no esta disponible');
    }

    const extraMonto = calcularExtraHorario({
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      extrasHorarios: this.mapExtras(extrasHorarios),
    });
    const precioSnapshot = Math.round((Number(agenda.precio ?? 0) + extraMonto) * 100) / 100;
    const senaMonto = money(dto.sena_monto);
    if (senaMonto > precioSnapshot) {
      throw new BadRequestException('La seña no puede superar el precio de la reserva');
    }

    try {
      const entity = this.reservaRepo.create({
        tenantId,
        sucursalId,
        agendaId,
        clienteId,
        nombre,
        telefono: strOrNull(dto.telefono, 80),
        email: strOrNull(dto.email, 120),
        notas: strOrNull(dto.notas, 1000),
        fecha,
        horaInicio,
        horaFin,
        precioSnapshot: precioSnapshot.toFixed(2),
        senaMonto: senaMonto.toFixed(2),
        estado: TurnoReservaEstado.reservado,
        createdBy: user.sub,
      });
      const saved = await this.reservaRepo.save(entity);
      const full = await this.reservaRepo.findOne({
        where: { id: saved.id },
        relations: ['agenda', 'cliente'],
      });
      return { reserva: serializeReserva(full ?? saved) };
    } catch (e) {
      if (isReservaUniqueConflict(e)) {
        throw new ConflictException('El horario ya fue reservado');
      }
      throw e;
    }
  }

  async patch(id: string, dto: UpdateReservaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    if (!UUID_RE.test(id)) {
      throw new BadRequestException('Reserva invalida');
    }

    const updates: {
      nombre?: string;
      telefono?: string | null;
      email?: string | null;
      notas?: string | null;
      senaMonto?: string;
    } = {};
    if (dto.nombre !== undefined) {
      const nombre = strOrNull(dto.nombre, 180);
      if (!nombre) {
        throw new BadRequestException('El nombre de la reserva es obligatorio');
      }
      updates.nombre = nombre;
    }
    if (dto.telefono !== undefined) updates.telefono = strOrNull(dto.telefono, 80);
    if (dto.email !== undefined) updates.email = strOrNull(dto.email, 120);
    if (dto.notas !== undefined) updates.notas = strOrNull(dto.notas, 1000);
    if (dto.sena_monto !== undefined) updates.senaMonto = money(dto.sena_monto).toFixed(2);

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No hay cambios para guardar');
    }

    const result = await this.reservaRepo.update(
      { id, tenantId, sucursalId, estado: TurnoReservaEstado.reservado },
      updates,
    );
    if (!result.affected) {
      throw new NotFoundException('La reserva no existe o no se puede editar');
    }

    const reserva = await this.reservaRepo.findOne({
      where: { id, tenantId, sucursalId },
      relations: ['agenda', 'cliente'],
    });
    return { reserva: serializeReserva(reserva!) };
  }

  async cancelar(id: string, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    if (!UUID_RE.test(id)) {
      throw new BadRequestException('Reserva invalida');
    }

    const actual = await this.reservaRepo.findOne({
      where: { id, tenantId, sucursalId },
      select: { id: true, estado: true },
    });
    if (!actual) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (actual.estado === TurnoReservaEstado.cobrado) {
      throw new ConflictException('La reserva ya esta cobrada');
    }

    const result = await this.reservaRepo.update(
      { id, tenantId, sucursalId, estado: Not(TurnoReservaEstado.cobrado) },
      {
        estado: TurnoReservaEstado.cancelado,
        canceladoAt: new Date(),
        canceladoPor: user.sub,
      },
    );
    if (!result.affected) {
      throw new BadRequestException('No se pudo cancelar la reserva');
    }

    const reserva = await this.reservaRepo.findOne({ where: { id, tenantId, sucursalId } });
    return { reserva: serializeReserva(reserva!) };
  }

  async cobrar(id: string, dto: CobrarReservaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    const destinoPos = esDestinoPos(dto.destino);
    if (destinoPos) {
      await this.base.assertFacturadorPos();
    } else {
      await this.base.assertFacturadorSimple();
    }
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    if (!UUID_RE.test(id)) {
      throw new BadRequestException('Reserva invalida');
    }

    const fechaVencimiento =
      dto.fecha_vencimiento_pago == null || dto.fecha_vencimiento_pago === ''
        ? null
        : parseFechaYmd(dto.fecha_vencimiento_pago);
    if (dto.fecha_vencimiento_pago && !fechaVencimiento) {
      throw new BadRequestException('fecha_vencimiento_pago debe ser YYYY-MM-DD');
    }

    const reserva = await this.reservaRepo.findOne({
      where: { id, tenantId, sucursalId },
      relations: ['agenda'],
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (reserva.estado === TurnoReservaEstado.cobrado) {
      throw new ConflictException('La reserva ya esta cobrada');
    }
    if (reserva.estado !== TurnoReservaEstado.reservado) {
      throw new ConflictException('La reserva no esta disponible para cobrar');
    }

    const agenda = reserva.agenda;
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }

    let productoId = agenda.productoId;
    if (!productoId) {
      const tenant = await this.tenantRepo.findOne({
        where: { id: tenantId },
        select: { ivaPorcentajeDefault: true },
      });
      productoId = await ensureAgendaServiceProduct(this.productoRepo, {
        tenantId,
        sucursalId,
        agendaId: agenda.id,
        nombre: agenda.nombre,
        precio: Number(agenda.precio ?? reserva.precioSnapshot ?? 0),
        ivaPorcentaje: Number(tenant?.ivaPorcentajeDefault ?? 21),
      });
      await this.agendaRepo.update({ id: agenda.id, tenantId }, { productoId });
    }

    const precio = Math.round(Number(reserva.precioSnapshot ?? agenda.precio ?? 0) * 100) / 100;
    const senaMonto = Math.min(
      precio,
      Math.max(0, Math.round(Number(reserva.senaMonto ?? 0) * 100) / 100),
    );

    if (destinoPos) {
      const producto = await this.productoRepo.findOne({
        where: { id: productoId, tenantId },
      });
      if (!producto) {
        throw new NotFoundException('Producto de servicio no encontrado');
      }
      const horaInicio = String(reserva.horaInicio ?? '').slice(0, 5);
      return {
        pos_payload: {
          turnoReservaId: reserva.id,
          turnoLabel: `${agenda.nombre} - ${reserva.fecha} ${horaInicio}`,
          clienteId: reserva.clienteId ?? '',
          senaMonto,
          items: [
            {
              producto: {
                id: producto.id,
                codigo: producto.codigo ?? `TURNO-${String(agenda.id).slice(0, 8).toUpperCase()}`,
                codigo_barras: producto.codigoBarras ?? null,
                nombre: producto.nombre ?? `Turno - ${agenda.nombre}`,
                precio_venta: precio,
                stock_actual: 999999,
                iva_porcentaje: producto.ivaPorcentaje ? Number(producto.ivaPorcentaje) : null,
                unidad: producto.unidad ?? 'unidad',
                es_servicio: true,
              },
              cantidad: 1,
            },
          ],
        },
      };
    }

    const lock = await this.reservaRepo.update(
      { id, tenantId, sucursalId, estado: TurnoReservaEstado.reservado },
      { estado: TurnoReservaEstado.cobrando },
    );
    if (!lock.affected) {
      throw new ConflictException('La reserva ya fue tomada por otro cobro');
    }

    const notasExtra = strOrNull(dto.notas, 500);
    const notas = [
      `Turno: ${agenda.nombre}`,
      `Reserva: ${reserva.fecha} ${String(reserva.horaInicio).slice(0, 5)}`,
      senaMonto > 0 ? `Seña descontada: ${senaMonto.toFixed(2)}` : null,
      notasExtra,
    ]
      .filter(Boolean)
      .join(' | ');

    const precioUnitario = Math.round((precio - senaMonto) * 100) / 100;
    const tipo = normalizarTipo(dto.tipo);
    const metodoPago = normalizarMetodoPago(dto.metodo_pago);

    try {
      const emit = await this.facturacionService.emitir(
        {
          tipo,
          sucursalId,
          clienteId: reserva.clienteId ?? undefined,
          items: [{ productoId, cantidad: 1, precioUnitario }],
          notas,
          metodoPago,
          medioPagoOpcionId: UUID_RE.test(String(dto.medio_pago_opcion_id ?? ''))
            ? String(dto.medio_pago_opcion_id)
            : undefined,
        },
        user.sub,
      );

      await this.reservaRepo.update(
        { id, tenantId },
        {
          estado: TurnoReservaEstado.cobrado,
          comprobanteId: emit.data.id,
        },
      );

      const reservaCobrada = await this.reservaRepo.findOne({ where: { id, tenantId } });
      return {
        reserva: serializeReserva(reservaCobrada!),
        comprobante: {
          id: emit.data.id,
          tipo: emit.data.tipo,
          numero: emit.data.numero,
          fecha: emit.data.fecha,
          estado: emit.data.estado,
          total: emit.data.total,
          pdf_url: emit.data.pdf?.pdfUrl ?? null,
        },
        importes: {
          subtotal: emit.data.subtotal,
          iva_monto: emit.data.ivaMonto,
          total: emit.data.total,
        },
        qr_url: emit.data.pdf?.pdfUrl ?? null,
      };
    } catch (err) {
      await this.reservaRepo.update(
        { id, tenantId, estado: TurnoReservaEstado.cobrando },
        { estado: TurnoReservaEstado.reservado },
      );
      throw err;
    }
  }

  async confirmarCobro(id: string, dto: ConfirmarCobroReservaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    await this.base.assertFacturadorPos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    if (!UUID_RE.test(id)) {
      throw new BadRequestException('Reserva invalida');
    }
    const comprobanteId = String(dto.comprobante_id ?? '').trim();
    if (!UUID_RE.test(comprobanteId)) {
      throw new BadRequestException('comprobante_id invalido');
    }

    const comprobante = await this.comprobanteRepo.findOne({
      where: { id: comprobanteId, tenantId, sucursalId },
      select: { id: true, estado: true },
    });
    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    if (comprobante.estado === EstadoComprobante.borrador) {
      throw new ConflictException('El comprobante todavia no fue emitido.');
    }

    const upd = await this.reservaRepo.update(
      {
        id,
        tenantId,
        sucursalId,
        comprobanteId: IsNull(),
        estado: In([TurnoReservaEstado.reservado, TurnoReservaEstado.cobrando]),
      },
      {
        estado: TurnoReservaEstado.cobrado,
        comprobanteId,
      },
    );

    if (upd.affected) {
      const reserva = await this.reservaRepo.findOne({ where: { id, tenantId, sucursalId } });
      return { reserva: serializeReserva(reserva!) };
    }

    const actual = await this.reservaRepo.findOne({
      where: { id, tenantId, sucursalId },
      select: { id: true, estado: true, comprobanteId: true },
    });
    if (!actual) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (
      actual.estado === TurnoReservaEstado.cobrado &&
      actual.comprobanteId === comprobanteId
    ) {
      const reserva = await this.reservaRepo.findOne({
        where: { id, tenantId, sucursalId },
        relations: ['agenda', 'cliente'],
      });
      return { reserva: serializeReserva(reserva!), already_linked: true };
    }

    throw new ConflictException(
      'La reserva ya fue cobrada, cancelada o vinculada a otro comprobante.',
    );
  }

  private mapDisponibilidad(rows: TurnoAgendaDisponibilidad[]): DisponibilidadSemanal[] {
    return rows.map((d) => ({
      id: d.id,
      dia_semana: d.diaSemana,
      hora_inicio: d.horaInicio.slice(0, 5),
      hora_fin: d.horaFin.slice(0, 5),
    }));
  }

  private mapBloqueos(rows: TurnoBloqueo[]): BloqueoTurno[] {
    return rows.map((b) => ({
      id: b.id,
      fecha: b.fecha,
      hora_inicio: b.horaInicio.slice(0, 5),
      hora_fin: b.horaFin.slice(0, 5),
      motivo: b.motivo,
    }));
  }

  private mapReservasTurno(rows: TurnoReserva[]): ReservaTurno[] {
    return rows.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      hora_inicio: r.horaInicio.slice(0, 5),
      hora_fin: r.horaFin.slice(0, 5),
      estado: r.estado,
      nombre: r.nombre,
    }));
  }

  private mapReservasFijasTurno(rows: TurnoReservaFija[]): ReservaFijaTurno[] {
    return rows.map((r) => ({
      id: r.id,
      dia_semana: r.diaSemana,
      hora_inicio: r.horaInicio.slice(0, 5),
      hora_fin: r.horaFin.slice(0, 5),
      activa: r.activa,
      nombre: r.nombre,
    }));
  }

  private mapExtras(rows: TurnoAgendaExtraHorario[]): ExtraHorarioTurno[] {
    return rows.map((e) => ({
      id: e.id,
      dia_semana: e.diaSemana,
      hora_inicio: e.horaInicio.slice(0, 5),
      hora_fin: e.horaFin.slice(0, 5),
      extra_monto: Number(e.extraMonto),
      activa: e.activa,
    }));
  }
}

function esDestinoPos(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'pos' || raw === 'facturacion_pos';
}

function normalizarMetodoPago(value: unknown): string {
  const raw = String(value ?? 'efectivo').trim();
  return METODOS_PAGO.has(raw) ? raw : 'efectivo';
}

function normalizarTipo(value: unknown): TipoComprobante {
  const raw = String(value ?? 'factura').trim();
  if (raw === 'factura_a') return TipoComprobante.factura_a;
  if (raw === 'factura_b') return TipoComprobante.factura_b;
  if (raw === 'factura_c') return TipoComprobante.factura_c;
  return TipoComprobante.factura_b;
}

function isReservaUniqueConflict(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const code =
    (err as QueryFailedError & { code?: string; driverError?: { code?: string } }).code ??
    (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
  const msg = String(err.message ?? '');
  return code === '23505' || msg.includes('uq_turno_reserva_slot_activo');
}
