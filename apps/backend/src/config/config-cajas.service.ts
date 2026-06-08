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
import { CajaService } from '../caja/caja.service';
import { cajaUuidComoCajaIdText, normalizarCaja } from '../caja/utils/caja-id.util';
import { CajaTurno } from '../caja/entities/caja-turno.entity';
import { CajaApertura } from '../caja/entities/caja-apertura.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CierreZ } from '../caja/entities/cierre-z.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { UsersService } from '../users/users.service';
import type { CreateCajaDto, PatchCajaDto } from './dto/config-cajas.dto';
import { Tenant } from './entities/tenant.entity';
import { effectiveBusinessPrefsFromRows, normalizeBusinessPrefs } from './utils/business-prefs.util';
import {
  isCajaPrefsPayload,
  mergeCajaPrefsPatch,
  normalizeCajaPrefs,
} from './utils/caja-prefs.util';

@Injectable()
export class ConfigCajasService {
  constructor(
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(CajaTurno)
    private readonly turnoRepo: Repository<CajaTurno>,
    @InjectRepository(CajaApertura)
    private readonly aperturaRepo: Repository<CajaApertura>,
    @InjectRepository(CierreZ)
    private readonly cierreRepo: Repository<CierreZ>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
    private readonly cajaService: CajaService,
  ) {}

  puedeGestionar(user: AccessTokenPayload): boolean {
    if (user.es_super_admin === true) return true;
    return resolveAppRole(user) === 'admin';
  }

  async list(user: AccessTokenPayload, sucursalIdParam?: string) {
    const tenantId = this.tenantContext.getTenantId();
    const role = resolveAppRole(user);
    const operables = await this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
    const puede = this.puedeGestionar(user);

    if (operables.length === 0) {
      return {
        sucursales: [],
        sucursal_id: null,
        cajas: [],
        cajas_gestion: [],
        puede_gestionar: puede,
        usuarios_opciones: [],
      };
    }

    const sucursales = await this.sucursalRepo.find({
      where: { tenantId, activa: true, id: In(operables) },
      order: { nombre: 'ASC' },
      select: ['id', 'nombre', 'codigo'],
    });

    let sucursalId = sucursalIdParam?.trim() || '';
    if (!sucursalId || !operables.includes(sucursalId)) {
      sucursalId = sucursales[0]?.id ?? operables[0] ?? '';
    }
    if (!operables.includes(sucursalId)) {
      throw new ForbiddenException('Sucursal no disponible.');
    }

    const cajasEnSucursal = await this.cajaRepo.find({
      where: { tenantId, sucursalId },
      order: { numero: 'ASC' },
    });

    let cajasGestion = cajasEnSucursal;
    if (puede) {
      cajasGestion = await this.cajaRepo.find({
        where: { tenantId, sucursalId: In(operables) },
        order: { sucursalId: 'ASC', numero: 'ASC' },
      });
    }

    const cajasGestionConEstado = await this.enriquecerConTurno(tenantId, cajasGestion);

    let usuariosOpciones: Array<{ id: string; label: string }> = [];
    if (puede) {
      const users = await this.usuarioRepo.find({
        where: { tenantId, activo: true },
        order: { createdAt: 'ASC' },
      });
      usuariosOpciones = users.map((u) => ({
        id: u.id,
        label: this.labelUsuario(u),
      }));
    }

    return {
      sucursales: sucursales.map((s) => ({ id: s.id, nombre: s.nombre, codigo: s.codigo })),
      sucursal_id: sucursalId,
      cajas: cajasEnSucursal.map((c) => this.serializeCajaRow(c)),
      cajas_gestion: cajasGestionConEstado,
      puede_gestionar: puede,
      usuarios_opciones: usuariosOpciones,
    };
  }

  async create(user: AccessTokenPayload, dto: CreateCajaDto) {
    if (!this.puedeGestionar(user)) {
      throw new ForbiddenException('Sin permisos para crear cajas.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const role = resolveAppRole(user);
    const operables = await this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
    if (!operables.includes(dto.sucursal_id)) {
      throw new ForbiddenException('No podés crear cajas en esa sucursal.');
    }

    const sucursal = await this.sucursalRepo.findOne({
      where: { id: dto.sucursal_id, tenantId },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada.');
    }

    let usuarioDefaultId: string | null = null;
    if (dto.usuario_default_id?.trim()) {
      const u = await this.usuarioRepo.findOne({
        where: { id: dto.usuario_default_id, tenantId, activo: true },
      });
      if (!u) {
        throw new BadRequestException('Usuario por defecto inválido para este negocio.');
      }
      usuarioDefaultId = u.id;
    }

    try {
      const row = await this.cajaRepo.save(
        this.cajaRepo.create({
          tenantId,
          sucursalId: dto.sucursal_id,
          numero: dto.numero,
          nombre: dto.nombre.trim(),
          usuarioDefaultId,
          activa: true,
        }),
      );
      return this.serializeCajaRow(row);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException('Ya existe una caja con ese número en la sucursal.');
      }
      throw err;
    }
  }

  async patch(user: AccessTokenPayload, cajaId: string, dto: PatchCajaDto) {
    const ctx = await this.requireCajaGestionable(user, cajaId);
    const patch: Partial<Caja> = {};

    if (dto.nombre !== undefined) {
      const nombre = dto.nombre.trim();
      if (!nombre) throw new BadRequestException('nombre no puede quedar vacío.');
      patch.nombre = nombre;
    }

    if (dto.sucursal_id !== undefined) {
      const destinoId = dto.sucursal_id.trim();
      if (!ctx.operables.includes(destinoId)) {
        throw new ForbiddenException('No podés mover cajas a esa sucursal.');
      }
      if (destinoId !== ctx.row.sucursalId) {
        await this.assertSinTurnoAbierto(cajaId, 'moverla de sucursal');
        const destino = await this.sucursalRepo.findOne({
          where: { id: destinoId, tenantId: ctx.tenantId, activa: true },
        });
        if (!destino) {
          throw new BadRequestException('Sucursal destino no encontrada o inactiva.');
        }
        const dup = await this.cajaRepo.findOne({
          where: {
            tenantId: ctx.tenantId,
            sucursalId: destinoId,
            numero: ctx.row.numero,
          },
        });
        if (dup && dup.id !== cajaId) {
          throw new ConflictException(
            `Ya existe una caja Nº ${ctx.row.numero} en la sucursal destino.`,
          );
        }
        patch.sucursalId = destinoId;
      }
    }

    if (dto.activa === false) {
      await this.assertSinTurnoAbierto(cajaId, 'desactivarla');
      patch.activa = false;
    } else if (dto.activa === true) {
      patch.activa = true;
    }

    if (dto.usuario_default_id !== undefined) {
      if (dto.usuario_default_id === null || dto.usuario_default_id === '') {
        patch.usuarioDefaultId = null;
      } else {
        const u = await this.usuarioRepo.findOne({
          where: { id: dto.usuario_default_id, tenantId: ctx.tenantId, activo: true },
        });
        if (!u) throw new BadRequestException('Usuario por defecto inválido.');
        patch.usuarioDefaultId = u.id;
      }
    }

    if (dto.auto_cierre_horas !== undefined) {
      if (dto.auto_cierre_horas === null) {
        patch.autoCierreHoras = null;
      } else if (dto.auto_cierre_horas >= 1 && dto.auto_cierre_horas <= 168) {
        patch.autoCierreHoras = dto.auto_cierre_horas;
      } else {
        throw new BadRequestException(
          'auto_cierre_horas debe ser un entero entre 1 y 168, o vacío para desactivar.',
        );
      }
    }

    if (dto.prefs !== undefined) {
      if (!isCajaPrefsPayload(dto.prefs)) {
        throw new BadRequestException('prefs inválido.');
      }
      const sucursal = await this.sucursalRepo.findOne({
        where: { id: ctx.row.sucursalId, tenantId: ctx.tenantId },
      });
      const tenant = await this.tenantRepo.findOne({ where: { id: ctx.tenantId } });
      const biz = effectiveBusinessPrefsFromRows(tenant?.businessPrefs, sucursal?.businessPrefs);
      if (!biz.cuentaCorrienteDistribuidora.permitirAjustesPorCaja) {
        throw new ConflictException(
          'Activá «Permitir ajustes por caja» en preferencias de la sucursal antes de configurar esta caja.',
        );
      }
      const current = normalizeCajaPrefs(ctx.row.prefs);
      patch.prefs = mergeCajaPrefsPatch(current, dto.prefs as Parameters<typeof mergeCajaPrefsPatch>[1]);
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nada para actualizar.');
    }

    Object.assign(ctx.row, patch);
    const saved = await this.cajaRepo.save(ctx.row);
    return this.serializeCajaRow(saved, true);
  }

  async delete(user: AccessTokenPayload, cajaId: string) {
    const ctx = await this.requireCajaGestionable(user, cajaId);
    const tenantId = ctx.tenantId;

    const cajaIdText = normalizarCaja(cajaUuidComoCajaIdText(cajaId));

    const [turnos, comprobantes, aperturas, cierres] = await Promise.all([
      this.turnoRepo.count({ where: { tenantId, cajaId } }),
      this.comprobanteRepo.count({ where: { tenantId, cajaUuid: cajaId } }),
      this.aperturaRepo.count({ where: { tenantId, cajaId: cajaIdText } }),
      this.cierreRepo.count({ where: { tenantId, cajaId: cajaIdText } }),
    ]);

    const usos: string[] = [];
    if (turnos > 0) usos.push(`${turnos} turnos`);
    if (comprobantes > 0) usos.push(`${comprobantes} comprobantes`);
    if (aperturas > 0) usos.push(`${aperturas} aperturas`);
    if (cierres > 0) usos.push(`${cierres} cierres`);
    if (usos.length > 0) {
      throw new ConflictException(
        `No se puede borrar esta caja porque tiene historial asociado (${usos.join(', ')}). Desactivala si ya no se usa.`,
      );
    }

    await this.cajaRepo.delete({ id: cajaId, tenantId });
    return { ok: true };
  }

  async forzarCierre(user: AccessTokenPayload, cajaId: string) {
    if (!this.puedeGestionar(user)) {
      throw new ForbiddenException('Sin permisos para gestionar cajas.');
    }
    return this.cajaService.forzarCierreAdmin(user.sub, cajaId);
  }

  private async requireCajaGestionable(user: AccessTokenPayload, cajaId: string) {
    if (!this.puedeGestionar(user)) {
      throw new ForbiddenException('Sin permisos para editar cajas.');
    }
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.cajaRepo.findOne({ where: { id: cajaId, tenantId } });
    if (!row) {
      throw new NotFoundException('Caja no encontrada.');
    }
    const role = resolveAppRole(user);
    const operables = await this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
    if (!operables.includes(row.sucursalId)) {
      throw new ForbiddenException('No podés editar cajas de esa sucursal.');
    }
    return { tenantId, row, operables };
  }

  private async assertSinTurnoAbierto(cajaId: string, accion: string) {
    const count = await this.turnoRepo.count({
      where: { cajaId, estado: 'abierto' },
    });
    if (count > 0) {
      throw new ConflictException(
        `Hay un turno de caja abierto en esta caja. Cerralo antes de ${accion}.`,
      );
    }
  }

  private async enriquecerConTurno(tenantId: string, cajas: Caja[]) {
    const ids = cajas.map((c) => c.id);
    if (ids.length === 0) return [];

    const turnos = await this.turnoRepo.find({
      where: { tenantId, estado: 'abierto', cajaId: In(ids) },
    });
    const userIds = [...new Set(turnos.map((t) => t.usuarioId))];
    const users =
      userIds.length > 0
        ? await this.usuarioRepo.find({ where: { id: In(userIds) } })
        : [];
    const userMap = new Map(users.map((u) => [u.id, this.labelUsuario(u)]));
    const turnoByCaja = new Map(turnos.map((t) => [t.cajaId, t]));

    return cajas.map((c) => {
      const turno = turnoByCaja.get(c.id);
      return {
        ...this.serializeCajaRow(c, true),
        estado_turno: turno ? 'abierta' : 'cerrada',
        turno_abierto: turno
          ? {
              id: turno.id,
              abierto_at: turno.abiertoAt.toISOString(),
              usuario_id: turno.usuarioId,
              usuario_label: userMap.get(turno.usuarioId) ?? 'Usuario sin nombre',
            }
          : null,
      };
    });
  }

  private serializeCajaRow(c: Caja, includePrefs = false) {
    return {
      id: c.id,
      sucursal_id: c.sucursalId,
      numero: c.numero,
      nombre: c.nombre,
      activa: c.activa,
      usuario_default_id: c.usuarioDefaultId,
      auto_cierre_horas: c.autoCierreHoras,
      ...(includePrefs ? { prefs: normalizeCajaPrefs(c.prefs) } : {}),
    };
  }

  private labelUsuario(u: Pick<Usuario, 'nombre' | 'apellido' | 'email'>) {
    const n = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
    if (n) return n;
    return u.email?.trim() || '—';
  }
}
