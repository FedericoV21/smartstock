import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { CreateBranchTransferDto } from './dto/create-branch-transfer.dto';
import { PreviewBranchTransferQueryDto } from './dto/list-branch-transfers-query.dto';
import { StockTransferenciaSucursal } from './entities/stock-transferencia-sucursal.entity';
import {
  ACEPTAR_TRANSFERENCIA_STOCK_SQL,
  CREAR_TRANSFERENCIA_STOCK_SQL,
} from './sql/branch-transfer.sql';

@Injectable()
export class BranchTransfersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(StockTransferenciaSucursal)
    private readonly transferRepo: Repository<StockTransferenciaSucursal>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(StockSucursal)
    private readonly stockRepo: Repository<StockSucursal>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  async preview(query: PreviewBranchTransferQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    if (query.sucursalOrigenId === query.sucursalDestinoId) {
      throw new BadRequestException('Eleg├¡ una sucursal de destino distinta a la de origen.');
    }

    const producto = await this.productoRepo.findOne({
      where: { id: query.productoId, tenantId, activo: true },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado.');
    }

    await this.assertSucursal(tenantId, query.sucursalOrigenId);
    await this.assertSucursal(tenantId, query.sucursalDestinoId);

    const stockOrigen = await this.stockRepo.findOne({
      where: {
        tenantId,
        productoId: query.productoId,
        sucursalId: query.sucursalOrigenId,
      },
    });
    const stockDestino = await this.stockRepo.findOne({
      where: {
        tenantId,
        productoId: query.productoId,
        sucursalId: query.sucursalDestinoId,
      },
    });

    return {
      data: {
        ok: true,
        status: stockDestino ? 'ready' : 'will_create_depot',
        producto: {
          id: producto.id,
          codigo: producto.codigo,
          nombre: producto.nombre,
          activo: producto.activo,
        },
        stockOrigen: {
          sucursalId: query.sucursalOrigenId,
          stockActual: Number(stockOrigen?.stockActual ?? 0),
        },
        stockDestino: {
          sucursalId: query.sucursalDestinoId,
          stockActual: Number(stockDestino?.stockActual ?? 0),
        },
        message: stockDestino
          ? undefined
          : 'En destino a├║n no existe el dep├│sito para este producto. Se crear├í al aceptar la recepci├│n.',
      },
    };
  }

  async listPending(sucursalDestinoId: string, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertOperableSucursal(user, tenantId, sucursalDestinoId);

    const rows = await this.transferRepo.find({
      where: { tenantId, sucursalDestinoId, estado: 'pendiente' },
      order: { enviadoAt: 'DESC' },
      take: 100,
    });

    const productIds = [...new Set(rows.map((r) => r.productoId))];
    const sucursalIds = [
      ...new Set(rows.flatMap((r) => [r.sucursalOrigenId, r.sucursalDestinoId])),
    ];

    const [productos, sucursales] = await Promise.all([
      productIds.length
        ? this.productoRepo.find({ where: productIds.map((id) => ({ id, tenantId })) })
        : [],
      sucursalIds.length
        ? this.sucursalRepo.find({ where: sucursalIds.map((id) => ({ id, tenantId })) })
        : [],
    ]);

    const productoMap = new Map(productos.map((p) => [p.id, p]));
    const sucursalMap = new Map(sucursales.map((s) => [s.id, s]));

    return {
      data: {
        sucursalDestinoId,
        transfers: rows.map((r) => this.serializeListItem(r, productoMap, sucursalMap)),
      },
    };
  }

  async create(dto: CreateBranchTransferDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    if (dto.sucursalOrigenId === dto.sucursalDestinoId) {
      throw new BadRequestException('La sucursal de destino no puede ser la de origen.');
    }

    await this.assertOperableSucursal(user, tenantId, dto.sucursalOrigenId);
    await this.assertOperableSucursal(user, tenantId, dto.sucursalDestinoId);

    const producto = await this.productoRepo.findOne({
      where: { id: dto.productoId, tenantId, activo: true },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado.');
    }

    try {
      const rows = (await this.dataSource.query(CREAR_TRANSFERENCIA_STOCK_SQL, [
        tenantId,
        dto.productoId,
        dto.sucursalOrigenId,
        dto.sucursalDestinoId,
        dto.cantidad,
        dto.motivo ?? null,
        user.sub,
      ])) as { data: Record<string, unknown> }[];

      return { data: rows[0]?.data ?? null };
    } catch (err) {
      this.rethrowRpc(err);
      throw err;
    }
  }

  async receive(transferId: string, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const transfer = await this.transferRepo.findOne({
      where: { id: transferId, tenantId },
    });
    if (!transfer) {
      throw new NotFoundException('Transferencia no encontrada.');
    }
    if (transfer.estado !== 'pendiente') {
      throw new ConflictException('La transferencia ya no est├í pendiente.');
    }

    await this.assertOperableSucursal(user, tenantId, transfer.sucursalDestinoId);

    try {
      const rows = (await this.dataSource.query(ACEPTAR_TRANSFERENCIA_STOCK_SQL, [
        tenantId,
        transferId,
        user.sub,
      ])) as { data: Record<string, unknown> }[];

      return { data: rows[0]?.data ?? null };
    } catch (err) {
      this.rethrowRpc(err);
      throw err;
    }
  }

  private async assertOperableSucursal(
    user: AccessTokenPayload,
    tenantId: string,
    sucursalId: string,
  ) {
    const appRole = resolveAppRole(user);
    try {
      await this.usersService.assertCanOperateSucursal(
        user.sub,
        tenantId,
        sucursalId,
        appRole,
      );
    } catch {
      throw new ForbiddenException('No ten├®s permisos para operar en esa sucursal.');
    }
  }

  private async assertSucursal(tenantId: string, sucursalId: string) {
    const ok = await this.sucursalRepo.exist({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!ok) {
      throw new NotFoundException('Sucursal no encontrada o inactiva.');
    }
  }

  private rethrowRpc(err: unknown): void {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err && 'message' in err
          ? String((err as { message: unknown }).message)
          : '';

    const lower = message.toLowerCase();
    if (lower.includes('insuficiente') || lower.includes('cantidad')) {
      throw new BadRequestException(message);
    }
    if (lower.includes('no encontrado') || lower.includes('no encontrada')) {
      throw new NotFoundException(message);
    }
    if (lower.includes('no esta pendiente') || lower.includes('no est├í pendiente')) {
      throw new ConflictException(message);
    }
    if (message) {
      throw new BadRequestException(message);
    }
  }

  private serializeListItem(
    row: StockTransferenciaSucursal,
    productoMap: Map<string, Producto>,
    sucursalMap: Map<string, Sucursal>,
  ) {
    const producto = productoMap.get(row.productoId);
    const origen = sucursalMap.get(row.sucursalOrigenId);
    const destino = sucursalMap.get(row.sucursalDestinoId);

    return {
      id: row.id,
      cantidad: Number(row.cantidad),
      motivo: row.motivo,
      estado: row.estado,
      enviadoAt: row.enviadoAt.toISOString(),
      depositoDestinoExistia: row.depositoDestinoExistia,
      producto: producto
        ? {
            id: producto.id,
            codigo: producto.codigo,
            nombre: producto.nombre,
            unidad: producto.unidad,
          }
        : null,
      sucursalOrigen: origen
        ? { id: origen.id, codigo: origen.codigo, nombre: origen.nombre }
        : null,
      sucursalDestino: destino
        ? { id: destino.id, codigo: destino.codigo, nombre: destino.nombre }
        : null,
    };
  }
}
