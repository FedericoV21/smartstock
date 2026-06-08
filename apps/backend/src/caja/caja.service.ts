import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { hoyEnArgentina } from '../facturacion/utils/fecha-argentina';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { UsersService } from '../users/users.service';
import { CajaCierreService } from './caja-cierre.service';
import { CajaApertura } from './entities/caja-apertura.entity';
import { CajaTurno } from './entities/caja-turno.entity';
import { CajaUsuario } from './entities/caja-usuario.entity';
import { Caja } from './entities/caja.entity';
import { CierreZMedioPago } from './entities/cierre-z-medio-pago.entity';
import { CierreZ } from './entities/cierre-z.entity';
import { AbrirTurnoDto, CerrarTurnoDto } from './dto/turno.dto';
import {
  cajaUuidComoCajaIdText,
  fechaYmdArgentina,
  normalizarCaja,
  redondear2,
} from './utils/caja-id.util';
import {
  esNotaCredito,
  tipoIncluido,
} from './utils/cierre-z-calculo.util';
import { aplanarRepresentativosVentaPorOrden } from './utils/ventas-representativas-por-orden.util';
import {
  aperturaEstaCerrada,
  serializeAperturaVigente,
} from './utils/sesion-caja.util';

@Injectable()
export class CajaService {
  constructor(
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(CajaUsuario)
    private readonly cajaUsuarioRepo: Repository<CajaUsuario>,
    @InjectRepository(CajaTurno)
    private readonly turnoRepo: Repository<CajaTurno>,
    @InjectRepository(CajaApertura)
    private readonly aperturaRepo: Repository<CajaApertura>,
    @InjectRepository(CierreZ)
    private readonly cierreRepo: Repository<CierreZ>,
    @InjectRepository(CierreZMedioPago)
    private readonly cierreMedioRepo: Repository<CierreZMedioPago>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly usersService: UsersService,
    private readonly cajaCierreService: CajaCierreService,
  ) {}

  async assertFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException('El m├│dulo POS no est├í habilitado para este negocio.');
    }
  }

  async getDisponibles(user: AccessTokenPayload, sucursalIdParam?: string) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;
    const role = resolveAppRole(user);

    const operables = await this.usersService.listOperableSucursalIds(userId, tenantId, role);
    if (operables.length === 0) {
      return { cajas: [], caja_sugerida_id: null, todas_con_turno_abierto: false };
    }

    let idsFiltro = operables;
    if (sucursalIdParam?.trim()) {
      if (!operables.includes(sucursalIdParam.trim())) {
        throw new ForbiddenException('Sucursal no disponible para tu usuario.');
      }
      idsFiltro = [sucursalIdParam.trim()];
    } else {
      const def = await this.usersService.getSucursalDefaultId(userId, tenantId);
      if (def && operables.includes(def)) {
        idsFiltro = [def];
      } else if (operables.length === 1) {
        idsFiltro = [operables[0]!];
      }
    }

    const candidatas = await this.cajaRepo.find({
      where: { tenantId, activa: true, sucursalId: In(idsFiltro) },
      order: { sucursalId: 'ASC', numero: 'ASC' },
    });

    const permitidas: Caja[] = [];
    for (const caja of candidatas) {
      if (await this.usuarioPuedeOperarCaja(userId, tenantId, role, caja)) {
        permitidas.push(caja);
      }
    }

    const idsPermitidas = permitidas.map((c) => c.id);
    const turnosAb =
      idsPermitidas.length > 0
        ? await this.turnoRepo.find({
            where: { tenantId, estado: 'abierto', cajaId: In(idsPermitidas) },
            select: ['cajaId'],
          })
        : [];
    const cajaIdsConTurnoAbierto = new Set(turnosAb.map((t) => t.cajaId));

    const miembros =
      idsPermitidas.length > 0
        ? await this.cajaUsuarioRepo.find({
            where: { usuarioId: userId, cajaId: In(idsPermitidas) },
            select: ['cajaId'],
          })
        : [];
    const cajaIdsMiembro = [...new Set(miembros.map((m) => m.cajaId))];

    const outSinTurno = permitidas.filter((c) => !cajaIdsConTurnoAbierto.has(c.id));
    const cajaIdsMiembroLibres = cajaIdsMiembro.filter((id) =>
      outSinTurno.some((c) => c.id === id),
    );

    const caja_sugerida_id = this.elegirCajaSugeridaId(userId, outSinTurno, cajaIdsMiembroLibres);
    const todas_con_turno_abierto = permitidas.length > 0 && outSinTurno.length === 0;

    return {
      cajas: permitidas.map((c) => ({
        id: c.id,
        sucursal_id: c.sucursalId,
        numero: c.numero,
        nombre: c.nombre,
        activa: c.activa,
        usuario_default_id: c.usuarioDefaultId,
        turno_abierto: cajaIdsConTurnoAbierto.has(c.id),
      })),
      caja_sugerida_id,
      todas_con_turno_abierto,
    };
  }

  async getTurnoActual(user: AccessTokenPayload, sucursalIdParam?: string) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;

    await this.sucursalContext.resolveSucursalId();
    if (sucursalIdParam?.trim()) {
      await this.usersService.assertCanOperateSucursal(
        userId,
        tenantId,
        sucursalIdParam.trim(),
        resolveAppRole(user),
      );
      this.sucursalContext.setActiveSucursalId(sucursalIdParam.trim());
    }

    const sucursalId = this.sucursalContext.getSucursalId();
    if (!sucursalId) {
      return { turno: null };
    }

    const cajas = await this.cajaRepo.find({
      where: { tenantId, sucursalId },
      select: ['id'],
    });
    const cajaIds = cajas.map((c) => c.id);
    if (cajaIds.length === 0) {
      return { turno: null };
    }

    const turno = await this.turnoRepo.findOne({
      where: { tenantId, usuarioId: userId, estado: 'abierto', cajaId: In(cajaIds) },
      order: { abiertoAt: 'DESC' },
    });
    if (!turno) {
      return { turno: null };
    }

    const caja = await this.cajaRepo.findOne({ where: { id: turno.cajaId } });
    let sucursalNombre: string | null = null;
    if (caja?.sucursalId) {
      const sur = await this.sucursalRepo.findOne({
        where: { id: caja.sucursalId, tenantId },
        select: ['nombre', 'codigo'],
      });
      if (sur) {
        const nom = sur.nombre?.trim() ?? '';
        const cod = sur.codigo?.trim() ?? '';
        sucursalNombre = cod ? `${nom || 'Sucursal'} (${cod})` : nom || null;
      }
    }

    const ach = caja?.autoCierreHoras;
    const auto_cierre_horas =
      typeof ach === 'number' && Number.isInteger(ach) && ach >= 1 ? ach : null;

    return {
      turno: {
        id: turno.id,
        abierto_at: turno.abiertoAt.toISOString(),
        monto_inicial: Number(turno.montoInicial),
        estado: turno.estado,
        caja: caja
          ? {
              id: caja.id,
              nombre: caja.nombre,
              numero: caja.numero,
              sucursal_id: caja.sucursalId,
              sucursal_nombre: sucursalNombre,
              auto_cierre_horas,
              prefs: caja.prefs ?? {},
            }
          : null,
      },
    };
  }

  async abrirTurno(user: AccessTokenPayload, dto: AbrirTurnoDto) {
    await this.assertFacturadorPos();
    const role = resolveAppRole(user);
    if (role === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden operar caja.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;
    const cajaId = dto.caja_id?.trim();
    if (!cajaId) {
      throw new BadRequestException('caja_id es obligatorio (UUID de la caja).');
    }

    const montoNum =
      dto.monto_inicial === null || dto.monto_inicial === undefined
        ? 0
        : Number(dto.monto_inicial);
    if (!Number.isFinite(montoNum) || montoNum < 0) {
      throw new BadRequestException('monto_inicial debe ser un n├║mero ÔëÑ 0.');
    }

    const caja = await this.cajaRepo.findOne({ where: { id: cajaId, tenantId } });
    if (!caja || !caja.activa) {
      throw new NotFoundException('Caja no encontrada o inactiva.');
    }

    await this.usersService.assertCanOperateSucursal(userId, tenantId, caja.sucursalId, role);

    if (!(await this.usuarioPuedeOperarCaja(userId, tenantId, role, caja))) {
      throw new ForbiddenException(
        'No est├ís habilitado para operar en esta caja. Pedile al administrador que te asigne.',
      );
    }

    const turnoUsuario = await this.turnoRepo.findOne({
      where: { tenantId, usuarioId: userId, estado: 'abierto' },
    });
    if (turnoUsuario) {
      throw new ConflictException({
        error:
          'Ya ten├®s un turno de caja abierto. Cerralo con Z antes de abrir otro.',
        codigo: 'turno_usuario_ya_abierto',
        puede_cerrar_turno_actual: true,
      });
    }

    const turnoCaja = await this.turnoRepo.findOne({
      where: { tenantId, cajaId: caja.id, estado: 'abierto' },
    });
    if (turnoCaja) {
      throw new ConflictException(
        'Esta caja ya tiene un turno abierto. Esper├í al cierre o us├í otra caja.',
      );
    }

    const cajaIdText = cajaUuidComoCajaIdText(caja.id);
    const vigente = await this.obtenerAperturaVigente(tenantId, cajaIdText, caja.sucursalId);
    if (vigente) {
      throw new ConflictException(
        'Hay una sesi├│n de caja abierta sin cierre Z para esta caja. Cerrala desde Cierre de caja o contact├í al administrador.',
      );
    }

    const fechaOperativa = hoyEnArgentina();
    const monto = redondear2(montoNum);

    const apertura = await this.aperturaRepo.save(
      this.aperturaRepo.create({
        tenantId,
        sucursalId: caja.sucursalId,
        cajaId: cajaIdText,
        fechaOperativa,
        openedAt: new Date(),
        fondoEfectivo: String(monto),
        usuarioId: userId,
      }),
    );

    let turno: CajaTurno;
    try {
      turno = await this.turnoRepo.save(
        this.turnoRepo.create({
          tenantId,
          cajaId: caja.id,
          usuarioId: userId,
          estado: 'abierto',
          abiertoAt: new Date(),
          montoInicial: String(monto),
        }),
      );
    } catch {
      await this.aperturaRepo.delete({ id: apertura.id });
      throw new ConflictException(
        'No se pudo abrir el turno porque ya existe un turno abierto (tuyo o de la caja elegida). Actualiz├í la p├ígina y cerr├í el turno vigente con Z.',
      );
    }

    return {
      ok: true,
      turno: {
        id: turno.id,
        abierto_at: turno.abiertoAt.toISOString(),
        monto_inicial: monto,
        estado: turno.estado,
      },
      caja: {
        id: caja.id,
        nombre: caja.nombre,
        numero: caja.numero,
        sucursal_id: caja.sucursalId,
      },
      apertura: {
        id: apertura.id,
        opened_at: apertura.openedAt.toISOString(),
        fondo_efectivo: monto,
        fecha_operativa: apertura.fechaOperativa,
      },
      caja_id_text: cajaIdText,
    };
  }

  async cerrarTurno(user: AccessTokenPayload, dto: CerrarTurnoDto) {
    await this.assertFacturadorPos();
    const role = resolveAppRole(user);
    if (role === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden operar caja.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;

    const turno = await this.turnoRepo.findOne({
      where: { tenantId, usuarioId: userId, estado: 'abierto' },
    });
    if (!turno) {
      throw new NotFoundException('No hay turno de caja abierto.');
    }

    const caja = await this.cajaRepo.findOne({ where: { id: turno.cajaId, tenantId } });
    if (!caja) {
      throw new NotFoundException('Caja del turno no encontrada.');
    }

    const cajaIdText = normalizarCaja(cajaUuidComoCajaIdText(caja.id));
    const ap = await this.obtenerAperturaVigente(tenantId, cajaIdText, caja.sucursalId);
    if (!ap) {
      throw new BadRequestException(
        'No hay sesi├│n de caja abierta vinculada a este turno. Abr├¡ turno desde el POS o registr├í apertura en Cierre de caja.',
      );
    }

    const rangoDesde = ap.opened_at;
    let rangoHasta = new Date().toISOString();
    const tDesde = new Date(rangoDesde).getTime();
    const tHasta = new Date(rangoHasta).getTime();
    if (Number.isFinite(tDesde) && Number.isFinite(tHasta) && tHasta < tDesde) {
      rangoHasta = new Date(tDesde + 1000).toISOString();
    }

    const cierreAutomaticoHoras = dto.cierre_automatico_horas === true;
    const cerrarIgualEsperado = dto.usar_efectivo_esperado_del_sistema === true;
    if (cierreAutomaticoHoras && cerrarIgualEsperado) {
      throw new BadRequestException(
        'Eleg├¡ un solo modo de cierre: autom├ítico por horas o efectivo igual al sistema.',
      );
    }

    const usarEsperado = cierreAutomaticoHoras || cerrarIgualEsperado;

    if (cierreAutomaticoHoras) {
      const horasCfg = caja.autoCierreHoras;
      if (horasCfg == null || !Number.isInteger(horasCfg) || horasCfg < 1) {
        throw new BadRequestException('Esta caja no tiene activado el cierre autom├ítico por horas.');
      }
      const abiertoMs = turno.abiertoAt.getTime();
      const limiteMs = abiertoMs + horasCfg * 3600 * 1000;
      if (Date.now() < limiteMs) {
        const restanteMin = Math.ceil((limiteMs - Date.now()) / 60000);
        throw new BadRequestException(
          `El cierre autom├ítico est├í disponible en ${restanteMin} min (desde la apertura del turno).`,
        );
      }
    }

    const bodyPersist: CerrarTurnoDto = {
      ...dto,
      origen_ui: cierreAutomaticoHoras
        ? 'auto_cierre_horas'
        : cerrarIgualEsperado
          ? 'efectivo_igual_sistema_operador'
          : dto.origen_ui,
    };

    const persisted = await this.cajaCierreService.persistCierreZDiarioSesion({
      tenantId,
      userId,
      sucursalId: caja.sucursalId,
      cajaIdNormalizada: cajaIdText,
      sesionAperturaId: ap.id,
      fechaOperativa: ap.fecha_operativa,
      rangoDesde,
      rangoHasta,
      fondoApertura: ap.fondo_efectivo,
      modoPeriodo: 'sesion_apertura',
      body: bodyPersist,
      payloadOrigen: 'api/caja/turno/cerrar',
      usarEfectivoEsperadoComoContado: usarEsperado,
    });

    const cerradoAt = new Date();
    await this.turnoRepo.update(
      { id: turno.id, estado: 'abierto' },
      { estado: 'cerrado', cerradoAt, cierreZId: persisted.cierre_id },
    );

    return {
      ok: true,
      cierre_id: persisted.cierre_id,
      sucursal_id: caja.sucursalId,
      snapshot: persisted.snapshot,
      arqueo_efectivo: persisted.arqueo_efectivo,
      ticket_resumen: persisted.ticket_resumen,
      turno_id: turno.id,
    };
  }

  async listCierreZ(sucursalIdParam?: string, fechaOperativa?: string, cajaId?: string, limit = 60) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    let sucursalId = sucursalIdParam?.trim() || null;
    if (!sucursalId) {
      await this.sucursalContext.resolveSucursalId();
      sucursalId = this.sucursalContext.getSucursalId();
    }
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const qb = this.cierreRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.sucursal_id = :sucursalId', { sucursalId })
      .orderBy('c.caja_id', 'ASC')
      .addOrderBy('c.rango_desde', 'ASC')
      .addOrderBy('c.created_at', 'ASC')
      .take(Math.min(limit, 100));

    if (fechaOperativa?.trim()) {
      qb.andWhere('c.fecha_operativa = :fecha', { fecha: fechaOperativa.trim() });
    }
    const cajaNorm = cajaId ? normalizarCaja(cajaId) : null;
    if (cajaNorm && cajaNorm !== '__sin_caja__') {
      qb.andWhere('c.caja_id = :cajaId', { cajaId: cajaNorm });
    }

    const cierres = await qb.getMany();
    const cierreIds = cierres.map((c) => c.id);
    const medios =
      cierreIds.length > 0
        ? await this.cierreMedioRepo.find({ where: { cierreZId: In(cierreIds) } })
        : [];
    const porCierre = new Map<string, typeof medios>();
    for (const m of medios) {
      const arr = porCierre.get(m.cierreZId) ?? [];
      arr.push(m);
      porCierre.set(m.cierreZId, arr);
    }

    return {
      cierres: cierres.map((c) => ({
        id: c.id,
        caja_id: c.cajaId,
        fecha_operativa: c.fechaOperativa,
        tipo_cierre: c.tipoCierre,
        rango_desde: c.rangoDesde.toISOString(),
        rango_hasta: c.rangoHasta.toISOString(),
        total_comprobantes: c.totalComprobantes,
        ventas_brutas: Number(c.ventasBrutas),
        notas_credito_total: Number(c.notasCreditoTotal),
        ventas_netas: Number(c.ventasNetas),
        pagos_cta_cte_total: Number(c.pagosCtaCteTotal),
        created_at: c.createdAt.toISOString(),
        medios: (porCierre.get(c.id) ?? []).map((m) => ({
          metodo_pago: m.metodoPago,
          monto_neto: Number(m.montoNeto),
          cantidad_comprobantes: m.cantidadComprobantes,
        })),
      })),
    };
  }

  async listTurnosHistorial(sucursalIdParam?: string, limit = 30) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    let sucursalId = sucursalIdParam?.trim() || null;
    if (!sucursalId) {
      await this.sucursalContext.resolveSucursalId();
      sucursalId = this.sucursalContext.getSucursalId();
    }

    const qb = this.turnoRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.estado = :estado', { estado: 'cerrado' })
      .orderBy('t.cerrado_at', 'DESC')
      .take(Math.min(limit, 100));

    if (sucursalId) {
      qb.innerJoin(Caja, 'c', 'c.id = t.caja_id').andWhere('c.sucursal_id = :sucursalId', {
        sucursalId,
      });
    }

    const turnos = await qb.getMany();
    const cajaIds = [...new Set(turnos.map((t) => t.cajaId))];
    const cajas =
      cajaIds.length > 0
        ? await this.cajaRepo.find({ where: { id: In(cajaIds) } })
        : [];
    const cajaMap = new Map(cajas.map((c) => [c.id, c]));

    return {
      turnos: turnos.map((t) => {
        const caja = cajaMap.get(t.cajaId);
        return {
          id: t.id,
          abierto_at: t.abiertoAt.toISOString(),
          cerrado_at: t.cerradoAt?.toISOString() ?? null,
          monto_inicial: Number(t.montoInicial),
          cierre_z_id: t.cierreZId,
          caja: caja
            ? { id: caja.id, nombre: caja.nombre, numero: caja.numero, sucursal_id: caja.sucursalId }
            : null,
        };
      }),
    };
  }

  async listCierresRecientes(sucursalIdParam?: string, limit = 20) {
    const tenantId = this.tenantContext.getTenantId();
    const take = Math.min(limit, 50);

    const qb = this.cierreRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.tipo_cierre = :tipo', { tipo: 'diario' })
      .orderBy('c.created_at', 'DESC')
      .take(take);

    if (sucursalIdParam?.trim()) {
      qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId: sucursalIdParam.trim() });
    }

    const rows = await qb.getMany();
    const cajaUuids = [
      ...new Set(
        rows
          .map((c) => c.cajaId)
          .filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)),
      ),
    ];
    const cajas =
      cajaUuids.length > 0
        ? await this.cajaRepo.find({ where: { tenantId, id: In(cajaUuids) } })
        : [];
    const cajasMap = new Map(
      cajas.map((c) => [c.id, c.nombre?.trim() || `Caja ${c.numero}`]),
    );

    const cierres = rows.map((c) => {
      const arqueo = (c.payloadResumen as { arqueo_efectivo?: { contado?: number } } | null)
        ?.arqueo_efectivo;
      return {
        id: c.id,
        caja_id: c.cajaId,
        fecha_operativa: c.fechaOperativa,
        rango_desde: c.rangoDesde.toISOString(),
        rango_hasta: c.rangoHasta.toISOString(),
        ventas_netas: Number(c.ventasNetas),
        efectivo_contado: arqueo?.contado ?? null,
        created_at: c.createdAt.toISOString(),
        caja_etiqueta: cajasMap.get(String(c.cajaId)) ?? 'Caja',
      };
    });

    return { cierres };
  }

  /** Cierre administrativo (paridad POST configuracion/cajas/:id/forzar-cierre). */
  async forzarCierreAdmin(userId: string, cajaUuid: string) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    const caja = await this.cajaRepo.findOne({ where: { id: cajaUuid, tenantId } });
    if (!caja) {
      throw new NotFoundException('Caja no encontrada.');
    }

    const turno = await this.turnoRepo.findOne({
      where: { tenantId, cajaId: caja.id, estado: 'abierto' },
    });
    if (!turno) {
      throw new NotFoundException('Esta caja no tiene ningún turno abierto.');
    }

    const cajaIdText = normalizarCaja(cajaUuidComoCajaIdText(caja.id));
    const ap = await this.obtenerAperturaVigente(tenantId, cajaIdText, caja.sucursalId);
    if (!ap) {
      throw new BadRequestException(
        'No hay sesión de caja abierta vinculada a este turno. Revisá Cierre de caja o soporte antes de forzar.',
      );
    }

    const rangoDesde = ap.opened_at;
    let rangoHasta = new Date().toISOString();
    const tDesde = new Date(rangoDesde).getTime();
    const tHasta = new Date(rangoHasta).getTime();
    if (Number.isFinite(tDesde) && Number.isFinite(tHasta) && tDesde > tHasta) {
      rangoHasta = new Date(tDesde + 1000).toISOString();
    }

    const persisted = await this.cajaCierreService.persistCierreZDiarioSesion({
      tenantId,
      userId,
      sucursalId: caja.sucursalId,
      cajaIdNormalizada: cajaIdText,
      sesionAperturaId: ap.id,
      fechaOperativa: ap.fecha_operativa,
      rangoDesde,
      rangoHasta,
      fondoApertura: ap.fondo_efectivo,
      modoPeriodo: 'sesion_apertura',
      body: { origen_ui: 'config_forzar_cierre_admin' },
      payloadOrigen: 'api/config/cajas/forzar-cierre',
      usarEfectivoEsperadoComoContado: true,
    });

    const cerradoAt = new Date();
    await this.turnoRepo.update(
      { id: turno.id, estado: 'abierto' },
      { estado: 'cerrado', cerradoAt, cierreZId: persisted.cierre_id },
    );

    return {
      ok: true,
      cierre_id: persisted.cierre_id,
      turno_id: turno.id,
      sucursal_id: caja.sucursalId,
      snapshot: persisted.snapshot,
      arqueo_efectivo: persisted.arqueo_efectivo,
      ticket_resumen: persisted.ticket_resumen,
    };
  }

  async listHistorialMovimientos(
    sucursalIdParam: string | undefined,
    fechaOperativa: string,
    cajaIdParam?: string,
    incluirUltimos = false,
  ) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    let sucursalId = sucursalIdParam?.trim() || null;
    if (!sucursalId) {
      await this.sucursalContext.resolveSucursalId();
      sucursalId = this.sucursalContext.getSucursalId();
    }
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const fecha = fechaOperativa.trim();
    if (!fecha) {
      throw new BadRequestException('fecha_operativa requerida');
    }

    const cajaNorm = normalizarCaja(cajaIdParam);

    const aperturas = await this.aperturaRepo.find({
      where: { tenantId, sucursalId, fechaOperativa: fecha, cajaId: cajaNorm },
      order: { openedAt: 'DESC' },
    });

    let cierres = await this.cierreRepo.find({
      where: { tenantId, sucursalId, fechaOperativa: fecha, cajaId: cajaNorm },
      order: { createdAt: 'DESC' },
    });

    const cierresExtendidos: Array<CierreZ & { reciente_fuera_fecha?: boolean }> = [...cierres];

    if (incluirUltimos) {
      const ultimos = await this.cierreRepo.find({
        where: { tenantId, sucursalId, cajaId: cajaNorm },
        order: { createdAt: 'DESC' },
        take: 6,
      });
      const seen = new Set(cierresExtendidos.map((c) => c.id));
      for (const c of ultimos) {
        if (seen.has(c.id)) continue;
        cierresExtendidos.push({
          ...c,
          reciente_fuera_fecha: String(c.fechaOperativa) !== fecha,
        });
        seen.add(c.id);
      }
    }

    const cierreIds = cierresExtendidos.map((c) => c.id);
    const mediosRows =
      cierreIds.length > 0
        ? await this.cierreMedioRepo.find({ where: { cierreZId: In(cierreIds) } })
        : [];
    const porCierre = new Map<string, typeof mediosRows>();
    for (const m of mediosRows) {
      const arr = porCierre.get(m.cierreZId) ?? [];
      arr.push(m);
      porCierre.set(m.cierreZId, arr);
    }

    type EventoHistorial =
      | {
          tipo: 'apertura';
          id: string;
          at: string;
          fondo_efectivo: number;
          fecha_operativa: string;
        }
      | {
          tipo: 'cierre';
          id: string;
          at: string;
          caja_id: string;
          fecha_operativa: string;
          tipo_cierre: string;
          rango_desde: string;
          rango_hasta: string;
          total_comprobantes: number;
          ventas_netas: number;
          pagos_cta_cte_total: number;
          ventas_brutas: number;
          notas_credito_total: number;
          reciente_fuera_fecha?: boolean;
          payload_resumen: Record<string, unknown> | null;
          medios: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[];
        };

    const eventos: EventoHistorial[] = [];

    for (const a of aperturas) {
      eventos.push({
        tipo: 'apertura',
        id: a.id,
        at: a.openedAt.toISOString(),
        fondo_efectivo: redondear2(Number(a.fondoEfectivo)),
        fecha_operativa: a.fechaOperativa,
      });
    }

    for (const c of cierresExtendidos) {
      eventos.push({
        tipo: 'cierre',
        id: c.id,
        at: c.createdAt.toISOString(),
        caja_id: c.cajaId,
        fecha_operativa: c.fechaOperativa,
        tipo_cierre: c.tipoCierre,
        rango_desde: c.rangoDesde.toISOString(),
        rango_hasta: c.rangoHasta.toISOString(),
        total_comprobantes: c.totalComprobantes,
        ventas_netas: Number(c.ventasNetas),
        pagos_cta_cte_total: Number(c.pagosCtaCteTotal),
        ventas_brutas: Number(c.ventasBrutas),
        notas_credito_total: Number(c.notasCreditoTotal),
        reciente_fuera_fecha: c.reciente_fuera_fecha === true,
        payload_resumen: c.payloadResumen ?? null,
        medios: (porCierre.get(c.id) ?? []).map((m) => ({
          metodo_pago: m.metodoPago,
          monto_neto: Number(m.montoNeto),
          cantidad_comprobantes: m.cantidadComprobantes,
        })),
      });
    }

    eventos.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

    return { eventos, sucursal_id: sucursalId };
  }

  async getCierreZResumen(cierreId: string, sucursalIdParam?: string) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    let sucursalId = sucursalIdParam?.trim() || null;
    if (!sucursalId) {
      await this.sucursalContext.resolveSucursalId();
      sucursalId = this.sucursalContext.getSucursalId();
    }
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const id = cierreId.trim();
    if (!id) {
      throw new BadRequestException('cierre_id requerido');
    }

    const cierre = await this.cierreRepo.findOne({
      where: { id, tenantId, sucursalId },
    });
    if (!cierre) {
      throw new NotFoundException('Cierre no encontrado.');
    }

    const mediosRows = await this.cierreMedioRepo.find({
      where: { tenantId, cierreZId: id },
    });

    const fechas = this.rangoFechasArgentina(
      cierre.rangoDesde.toISOString(),
      cierre.rangoHasta.toISOString(),
    );

    const qb = this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.sucursal_id = :sucursalId', { sucursalId })
      .andWhere('c.created_at >= :desde', { desde: cierre.rangoDesde })
      .andWhere('c.created_at <= :hasta', { hasta: cierre.rangoHasta });

    if (fechas.desde) {
      qb.andWhere('c.fecha >= :fechaDesde', { fechaDesde: fechas.desde }).andWhere(
        'c.fecha <= :fechaHasta',
        { fechaHasta: fechas.hasta },
      );
    }

    if (cierre.cajaId === '__sin_caja__') {
      qb.andWhere('c.caja_id IS NULL');
    } else {
      qb.andWhere('c.caja_id = :cajaId', { cajaId: cierre.cajaId });
    }

    const comprobantesRows = await qb.orderBy('c.created_at', 'ASC').getMany();

    const clienteIds = [...new Set(comprobantesRows.map((c) => c.clienteId).filter(Boolean))] as string[];
    const usuarioIds = [...new Set(comprobantesRows.map((c) => c.usuarioId).filter(Boolean))] as string[];

    const [clientes, usuarios] = await Promise.all([
      clienteIds.length > 0
        ? this.clienteRepo.find({ where: { id: In(clienteIds) } })
        : [],
      usuarioIds.length > 0
        ? this.usuarioRepo.find({ where: { id: In(usuarioIds) } })
        : [],
    ]);

    const clienteMap = new Map(clientes.map((c) => [c.id, c]));
    const usuarioMap = new Map(usuarios.map((u) => [u.id, u]));

    const rowsConJoins = comprobantesRows
      .filter((row) => tipoIncluido(String(row.tipo)))
      .map((row) => ({
        id: row.id,
        tipo: String(row.tipo),
        numero: row.numero,
        numero_caja: row.numeroCaja,
        numero_orden: row.numeroOrden,
        fecha: row.fecha,
        created_at: row.createdAt.toISOString(),
        total: Number(row.total),
        metodo_pago: row.metodoPago,
        metodo_pago_detalle: row.metodoPagoDetalle,
        caja_id: row.cajaId,
        cliente: row.clienteId ? (clienteMap.get(row.clienteId) ?? null) : null,
        usuario: row.usuarioId ? (usuarioMap.get(row.usuarioId) ?? null) : null,
      }));

    const representativos = aplanarRepresentativosVentaPorOrden(rowsConJoins);

    const ordenes = representativos.map((row) => {
      const total = Number(row.total ?? 0);
      return {
        id: row.id,
        numero_orden: row.numero_orden,
        tipo: row.tipo,
        numero: row.numero,
        numero_caja: row.numero_caja,
        numero_visible: this.numeroVisibleComprobante(row),
        fecha: row.fecha,
        created_at: row.created_at,
        cliente: this.nombreCliente(row.cliente),
        usuario: this.nombreUsuario(row.usuario),
        metodo_pago: row.metodo_pago,
        total: esNotaCredito(row.tipo) ? -Math.abs(total) : total,
        url_detalle: `/facturacion/${row.id}`,
      };
    });

    return {
      cierre: {
        id: cierre.id,
        caja_id: cierre.cajaId,
        fecha_operativa: cierre.fechaOperativa,
        tipo_cierre: cierre.tipoCierre,
        rango_desde: cierre.rangoDesde.toISOString(),
        rango_hasta: cierre.rangoHasta.toISOString(),
        total_comprobantes: cierre.totalComprobantes,
        ventas_brutas: Number(cierre.ventasBrutas),
        notas_credito_total: Number(cierre.notasCreditoTotal),
        ventas_netas: Number(cierre.ventasNetas),
        pagos_cta_cte_total: Number(cierre.pagosCtaCteTotal),
        created_at: cierre.createdAt.toISOString(),
        payload_resumen: cierre.payloadResumen ?? null,
      },
      medios: mediosRows.map((m) => ({
        metodo_pago: m.metodoPago,
        monto_neto: Number(m.montoNeto),
        cantidad_comprobantes: m.cantidadComprobantes,
      })),
      ordenes,
    };
  }

  private rangoFechasArgentina(desdeIso: string, hastaIso: string): { desde: string; hasta: string } {
    const desdeDate = new Date(desdeIso);
    const hastaDate = new Date(hastaIso);
    const desde = Number.isFinite(desdeDate.getTime()) ? fechaYmdArgentina(desdeDate) : '';
    const hasta = Number.isFinite(hastaDate.getTime()) ? fechaYmdArgentina(hastaDate) : desde;
    return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
  }

  private numeroVisibleComprobante(row: {
    tipo: string;
    numero: number | null;
    numero_caja: number | null;
    numero_orden: number | null;
    id: string;
  }): string {
    if (row.tipo === 'ticket' && row.numero_caja != null && Number.isFinite(Number(row.numero_caja))) {
      return String(Number(row.numero_caja)).padStart(8, '0');
    }
    if (row.numero != null && Number.isFinite(Number(row.numero))) {
      return String(Number(row.numero)).padStart(8, '0');
    }
    if (row.numero_orden != null && Number.isFinite(Number(row.numero_orden))) {
      return `Orden #${Number(row.numero_orden)}`;
    }
    return row.id.slice(0, 8).toUpperCase();
  }

  private nombreCliente(cliente: Cliente | null): string {
    const razon = cliente?.razonSocial?.trim() ?? '';
    const nombre = cliente?.nombre?.trim() ?? '';
    return razon || nombre || 'Consumidor final';
  }

  private nombreUsuario(usuario: Usuario | null): string | null {
    const nombre = usuario?.nombre?.trim() ?? '';
    const apellido = usuario?.apellido?.trim() ?? '';
    const full = `${nombre} ${apellido}`.trim();
    return full || null;
  }

  private async obtenerAperturaVigente(
    tenantId: string,
    cajaIdNormalizada: string,
    sucursalId: string,
  ) {
    const ap = await this.aperturaRepo.findOne({
      where: { tenantId, sucursalId, cajaId: cajaIdNormalizada },
      order: { openedAt: 'DESC' },
    });
    if (!ap) return null;

    const cierres = await this.cierreRepo.find({
      where: { tenantId, sucursalId, cajaId: cajaIdNormalizada, tipoCierre: 'diario' },
      order: { createdAt: 'DESC' },
      take: 600,
      select: ['id', 'cajaAperturaId', 'payloadResumen', 'rangoDesde'],
    });

    if (
      aperturaEstaCerrada(
        ap.id,
        ap.openedAt.toISOString(),
        cierres.map((r) => ({
          id: r.id,
          caja_apertura_id: r.cajaAperturaId,
          payload_resumen: r.payloadResumen,
          rango_desde: r.rangoDesde?.toISOString?.() ?? String(r.rangoDesde),
        })),
      )
    ) {
      return null;
    }

    const row = serializeAperturaVigente(ap);
    row.fecha_operativa = fechaYmdArgentina(ap.openedAt);
    return row;
  }

  private async usuarioPuedeOperarCaja(
    userId: string,
    tenantId: string,
    role: string | undefined,
    caja: Caja,
  ): Promise<boolean> {
    if (caja.usuarioDefaultId === userId) return true;

    try {
      await this.usersService.assertCanOperateSucursal(userId, tenantId, caja.sucursalId, role);
      const miembroExplicito = await this.cajaUsuarioRepo.count({ where: { cajaId: caja.id } });
      if (miembroExplicito === 0) return true;
    } catch {
      /* sucursal no operable */
    }

    const row = await this.cajaUsuarioRepo.findOne({
      where: { cajaId: caja.id, usuarioId: userId },
    });
    if (row) return true;

    const count = await this.cajaUsuarioRepo.count({ where: { cajaId: caja.id } });
    return count === 0;
  }

  private elegirCajaSugeridaId(
    userId: string,
    cajas: Caja[],
    cajaIdsMiembro: string[],
  ): string | null {
    if (cajas.length === 0) return null;
    const defaultMatch = cajas.find((c) => c.usuarioDefaultId === userId);
    if (defaultMatch) return defaultMatch.id;
    if (cajaIdsMiembro.length === 1) {
      const m = cajas.find((c) => c.id === cajaIdsMiembro[0]);
      if (m) return m.id;
    }
    if (cajas.length === 1) return cajas[0]!.id;
    return cajas[0]?.id ?? null;
  }
}
