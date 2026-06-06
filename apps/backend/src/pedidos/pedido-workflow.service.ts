import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CreateWorkflowEstadoDto } from './dto/create-workflow-estado.dto';
import { ListWorkflowEstadosQueryDto } from './dto/list-workflow-estados-query.dto';
import { UpdateWorkflowEstadoDto } from './dto/update-workflow-estado.dto';
import { PedidoWorkflowEstado } from './entities/pedido-workflow-estado.entity';
import { PedidoWorkflowTransicion } from './entities/pedido-workflow-transicion.entity';
import { normalizeWorkflowHexColor } from './utils/workflow-hex.util';

@Injectable()
export class PedidoWorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PedidoWorkflowEstado)
    private readonly estadoRepo: Repository<PedidoWorkflowEstado>,
    @InjectRepository(PedidoWorkflowTransicion)
    private readonly transicionRepo: Repository<PedidoWorkflowTransicion>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async list(query: ListWorkflowEstadosQueryDto) {
    await this.assertPedidosModule();
    const tenantId = this.tenantContext.getTenantId();
    await this.ensureTenantDefaults(tenantId);

    const forConfig = query.forConfig === true;
    const where = forConfig ? { tenantId } : { tenantId, activo: true };

    const estados = await this.estadoRepo.find({
      where,
      order: { orden: 'ASC', createdAt: 'ASC' },
    });
    const transiciones = await this.transicionRepo.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });

    return {
      data: {
        estados: estados.map((e) => this.serializeEstado(e)),
        transiciones: transiciones.map((t) => ({
          desde_id: t.desdeId,
          hacia_id: t.haciaId,
          created_at: t.createdAt.toISOString(),
        })),
      },
    };
  }

  async create(dto: CreateWorkflowEstadoDto) {
    await this.assertPedidosModule();
    const tenantId = this.tenantContext.getTenantId();
    await this.ensureTenantDefaults(tenantId);

    const slug = dto.slug.trim();
    const nombre = dto.nombre.trim();
    if (!slug) throw new BadRequestException('slug es obligatorio');
    if (!nombre) throw new BadRequestException('nombre es obligatorio');

    let color: string | null = null;
    if (dto.color != null && String(dto.color).trim()) {
      color = normalizeWorkflowHexColor(dto.color);
      if (!color) {
        throw new BadRequestException('color debe ser hexadecimal #RRGGBB o vac├¡o');
      }
    }

    const orden = dto.orden ?? 0;
    if (!Number.isFinite(orden)) throw new BadRequestException('orden inv├ílido');

    try {
      const entity = this.estadoRepo.create({
        tenantId,
        slug,
        nombre,
        color,
        fase: dto.fase,
        orden,
        activo: dto.activo !== false,
      });
      const saved = await this.estadoRepo.save(entity);
      return { data: { estado: this.serializeEstado(saved) } };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`Ya existe un estado con slug '${slug}'`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateWorkflowEstadoDto) {
    await this.assertPedidosModule();
    const tenantId = this.tenantContext.getTenantId();

    const entity = await this.estadoRepo.findOne({ where: { id, tenantId } });
    if (!entity) throw new NotFoundException('Estado workflow no encontrado');

    if (dto.slug !== undefined) {
      const slug = dto.slug.trim();
      if (!slug) throw new BadRequestException('slug no puede estar vac├¡o');
      entity.slug = slug;
    }
    if (dto.nombre !== undefined) {
      const nombre = dto.nombre.trim();
      if (!nombre) throw new BadRequestException('nombre no puede estar vac├¡o');
      entity.nombre = nombre;
    }
    if (dto.color !== undefined) {
      if (dto.color == null || !String(dto.color).trim()) {
        entity.color = null;
      } else {
        const normalized = normalizeWorkflowHexColor(dto.color);
        if (!normalized) {
          throw new BadRequestException('color debe ser hexadecimal #RRGGBB o vac├¡o');
        }
        entity.color = normalized;
      }
    }
    if (dto.fase !== undefined) entity.fase = dto.fase;
    if (dto.orden !== undefined) {
      if (!Number.isFinite(dto.orden)) throw new BadRequestException('orden inv├ílido');
      entity.orden = dto.orden;
    }
    if (dto.activo !== undefined) entity.activo = dto.activo !== false;

    if (
      dto.slug === undefined &&
      dto.nombre === undefined &&
      dto.color === undefined &&
      dto.fase === undefined &&
      dto.orden === undefined &&
      dto.activo === undefined
    ) {
      throw new BadRequestException('No hay campos para actualizar');
    }

    try {
      const saved = await this.estadoRepo.save(entity);
      return { data: { estado: this.serializeEstado(saved) } };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`Ya existe un estado con slug '${entity.slug}'`);
      }
      throw err;
    }
  }

  async resolveEstadoIdBySlug(slug: string): Promise<string | null> {
    const estado = await this.findEstadoBySlug(slug);
    return estado?.id ?? null;
  }

  async assertPedidosModuleEnabled(): Promise<void> {
    await this.assertPedidosModule();
  }

  async findEstadoById(id: string): Promise<PedidoWorkflowEstado | null> {
    const tenantId = this.tenantContext.getTenantId();
    await this.ensureTenantDefaults(tenantId);
    return this.estadoRepo.findOne({ where: { id, tenantId } });
  }

  async findEstadoBySlug(slug: string): Promise<PedidoWorkflowEstado | null> {
    const tenantId = this.tenantContext.getTenantId();
    await this.ensureTenantDefaults(tenantId);
    return this.estadoRepo
      .createQueryBuilder('w')
      .where('w.tenant_id = :tenantId', { tenantId })
      .andWhere('lower(w.slug) = lower(:slug)', { slug: slug.trim() })
      .getOne();
  }

  async hasTransition(desdeId: string, haciaId: string): Promise<boolean> {
    const tenantId = this.tenantContext.getTenantId();
    const count = await this.transicionRepo.count({
      where: { tenantId, desdeId, haciaId },
    });
    return count > 0;
  }

  async replaceTransiciones(edges: Array<{ desdeId: string; haciaId: string }>) {
    await this.assertPedidosModule();
    const tenantId = this.tenantContext.getTenantId();
    await this.ensureTenantDefaults(tenantId);

    const normalized = edges.map((e) => ({
      desdeId: e.desdeId.trim(),
      haciaId: e.haciaId.trim(),
    }));

    for (const edge of normalized) {
      if (!edge.desdeId || !edge.haciaId) {
        throw new BadRequestException('transiciones inv├ílidas');
      }
      if (edge.desdeId === edge.haciaId) {
        throw new BadRequestException('Una transici├│n no puede apuntar al mismo estado');
      }
    }

    const estadoIds = [...new Set(normalized.flatMap((e) => [e.desdeId, e.haciaId]))];
    if (estadoIds.length > 0) {
      const found = await this.estadoRepo.find({
        where: estadoIds.map((id) => ({ id, tenantId })),
        select: { id: true },
      });
      if (found.length !== estadoIds.length) {
        throw new BadRequestException('Estado de workflow inv├ílido o de otro negocio');
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      await manager.delete(PedidoWorkflowTransicion, { tenantId });
      if (normalized.length === 0) return [];

      const entities = normalized.map((e) =>
        manager.create(PedidoWorkflowTransicion, {
          tenantId,
          desdeId: e.desdeId,
          haciaId: e.haciaId,
        }),
      );
      return manager.save(PedidoWorkflowTransicion, entities);
    });

    return {
      data: {
        ok: true,
        transiciones: saved.map((t) => ({
          desde_id: t.desdeId,
          hacia_id: t.haciaId,
          created_at: t.createdAt.toISOString(),
        })),
      },
    };
  }

  private serializeEstado(e: PedidoWorkflowEstado) {
    return {
      id: e.id,
      slug: e.slug,
      nombre: e.nombre,
      color: e.color,
      fase: e.fase,
      orden: e.orden,
      activo: e.activo,
      created_at: e.createdAt.toISOString(),
      updated_at: e.updatedAt.toISOString(),
    };
  }

  private async assertPedidosModule(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuraci├│n de m├│dulos no encontrada');
    }
    if (!modulos.pedidos) {
      throw new ForbiddenException('M├│dulo pedidos no habilitado');
    }
  }

  private async ensureTenantDefaults(tenantId: string): Promise<void> {
    const count = await this.estadoRepo.count({ where: { tenantId } });
    if (count > 0) return;

    await this.dataSource.query(
      `
INSERT INTO public.pedido_estado_workflow (tenant_id, slug, nombre, color, fase, orden, activo)
SELECT $1::uuid, x.slug, x.nombre, x.color, x.fase::public.estado_pedido, x.orden, true
FROM (
  VALUES
    ('borrador',   'Borrador',   NULL, 'borrador',   10),
    ('confirmado', 'Confirmado', NULL, 'confirmado', 20),
    ('entregado',  'Enviado',    NULL, 'entregado',  30),
    ('cancelado',  'Cancelado',  NULL, 'cancelado',  40)
) AS x(slug, nombre, color, fase, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pedido_estado_workflow w
  WHERE w.tenant_id = $1::uuid AND lower(w.slug) = lower(x.slug)
)`,
      [tenantId],
    );

    await this.dataSource.query(
      `
INSERT INTO public.pedido_estado_workflow_transicion (tenant_id, desde_id, hacia_id)
SELECT w_from.tenant_id, w_from.id, w_to.id
FROM public.pedido_estado_workflow w_from
JOIN public.pedido_estado_workflow w_to ON w_to.tenant_id = w_from.tenant_id
WHERE w_from.tenant_id = $1::uuid
  AND lower(w_from.slug) = 'borrador'
  AND lower(w_to.slug) IN ('confirmado', 'cancelado')
  AND NOT EXISTS (
    SELECT 1 FROM public.pedido_estado_workflow_transicion tr
    WHERE tr.tenant_id = w_from.tenant_id AND tr.desde_id = w_from.id AND tr.hacia_id = w_to.id
  )`,
      [tenantId],
    );

    await this.dataSource.query(
      `
INSERT INTO public.pedido_estado_workflow_transicion (tenant_id, desde_id, hacia_id)
SELECT w_from.tenant_id, w_from.id, w_to.id
FROM public.pedido_estado_workflow w_from
JOIN public.pedido_estado_workflow w_to ON w_to.tenant_id = w_from.tenant_id
WHERE w_from.tenant_id = $1::uuid
  AND lower(w_from.slug) = 'confirmado'
  AND lower(w_to.slug) IN ('entregado', 'cancelado')
  AND NOT EXISTS (
    SELECT 1 FROM public.pedido_estado_workflow_transicion tr
    WHERE tr.tenant_id = w_from.tenant_id AND tr.desde_id = w_from.id AND tr.hacia_id = w_to.id
  )`,
      [tenantId],
    );
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
