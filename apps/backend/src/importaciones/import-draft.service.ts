import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { ImportPreviewRowDto } from './dto/import-preview-row.dto';
import { ListImportDraftsQueryDto } from './dto/list-import-drafts-query.dto';
import { PrepareImportDraftConfirmationDto } from './dto/prepare-import-draft-confirmation.dto';
import { ReplaceImportDraftChunksDto } from './dto/replace-import-draft-chunks.dto';
import { UpsertImportDraftDto } from './dto/upsert-import-draft.dto';
import { ImportacionArchivo } from './entities/importacion-archivo.entity';
import { ImportacionBorradorArchivo } from './entities/importacion-borrador-archivo.entity';
import { ImportacionBorradorChunk } from './entities/importacion-borrador-chunk.entity';
import { ImportacionBorrador } from './entities/importacion-borrador.entity';
import { draftRowsToImportPreviewRows } from './utils/borrador-rows-to-preview.util';
import {
  IMPORT_DRAFT_CHUNK_SIZE,
  IMPORT_DRAFT_MAX_BYTES,
  chunkDraftRows,
  includedRowsFromDraftPayload,
  metadataFromDraftPayload,
  normalizeDraftRows,
  validateDraftPayload,
} from './utils/import-draft-payload.util';

const FILE_EXT_OK = new Set(['.xlsx', '.xls', '.csv', '.pdf']);

@Injectable()
export class ImportDraftService {
  constructor(
    @InjectRepository(ImportacionBorrador)
    private readonly draftRepo: Repository<ImportacionBorrador>,
    @InjectRepository(ImportacionBorradorChunk)
    private readonly chunkRepo: Repository<ImportacionBorradorChunk>,
    @InjectRepository(ImportacionBorradorArchivo)
    private readonly draftFileRepo: Repository<ImportacionBorradorArchivo>,
    @InjectRepository(ImportacionArchivo)
    private readonly importFileRepo: Repository<ImportacionArchivo>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async list(query: ListImportDraftsQueryDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const limit = Math.min(80, Math.max(1, query.limit ?? 40));
    const qb = this.draftRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere("d.estado = 'activo'")
      .orderBy('d.updated_at', 'DESC')
      .take(limit);

    if (query.flujo) {
      qb.andWhere('d.flujo = :flujo', { flujo: query.flujo });
    }
    if (!this.isDraftAdmin(user)) {
      qb.andWhere('d.usuario_id = :userId', { userId: user.sub });
    }

    const drafts = await qb.getMany();
    const mapped = await Promise.all(drafts.map((d) => this.mapListItem(d)));
    return { data: { drafts: mapped } };
  }

  async create(dto: UpsertImportDraftDto, user: AccessTokenPayload) {
    let payload;
    try {
      payload = validateDraftPayload(dto.payload);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Payload invalido');
    }

    const sucursalId = await this.sucursalContext.resolveSucursalId();
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const meta = metadataFromDraftPayload(payload);
    const tenantId = this.tenantContext.getTenantId();
    const saved = await this.draftRepo.save(
      this.draftRepo.create({
        tenantId,
        usuarioId: user.sub,
        sucursalId,
        ...meta,
        estado: 'activo',
      }),
    );

    const mapped = await this.mapListItem(saved);
    return { data: { draft: mapped } };
  }

  async getById(id: string, user: AccessTokenPayload) {
    const draft = await this.loadActiveDraft(id);
    this.assertDraftAccess(user, draft);
    const filas = await this.readAllDraftRows(id);
    const mapped = await this.mapListItem(draft);
    return {
      data: {
        draft: {
          ...mapped,
          payload: draft.payload,
          filas,
        },
      },
    };
  }

  async update(id: string, dto: UpsertImportDraftDto, user: AccessTokenPayload) {
    const draft = await this.loadActiveDraft(id);
    this.assertDraftAccess(user, draft);

    let payload;
    try {
      payload = validateDraftPayload(dto.payload);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Payload invalido');
    }

    const meta = metadataFromDraftPayload(payload);
    Object.assign(draft, meta);
    const saved = await this.draftRepo.save(draft);
    const mapped = await this.mapListItem(saved);
    return { data: { draft: mapped } };
  }

  async remove(id: string, user: AccessTokenPayload) {
    const draft = await this.loadActiveDraft(id);
    this.assertDraftAccess(user, draft);
    await this.draftRepo.delete({ id, tenantId: this.tenantContext.getTenantId() });
    return { data: {} };
  }

  async replaceChunks(id: string, dto: ReplaceImportDraftChunksDto, user: AccessTokenPayload) {
    const draft = await this.loadActiveDraft(id);
    this.assertDraftAccess(user, draft);

    const filas = normalizeDraftRows(dto.filas);

    await this.chunkRepo.delete({ borradorId: id });
    const chunks = chunkDraftRows(filas);
    if (chunks.length > 0) {
      await this.chunkRepo.save(
        chunks.map((chunk, chunkIndex) =>
          this.chunkRepo.create({
            borradorId: id,
            chunkIndex,
            rowCount: chunk.length,
            filas: chunk,
          }),
        ),
      );
    }

    draft.totalFilas = filas.length;
    await this.draftRepo.save(draft);

    return { data: { totalFilas: filas.length, chunkCount: chunks.length } };
  }

  async uploadFile(id: string, file: Express.Multer.File, user: AccessTokenPayload) {
    const draft = await this.loadActiveDraft(id);
    this.assertDraftAccess(user, draft);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }
    if (file.size > IMPORT_DRAFT_MAX_BYTES) {
      throw new BadRequestException('El archivo no puede superar 20 MB');
    }

    const nombre = file.originalname || 'archivo';
    const ext = this.fileExtension(nombre);
    const esPdf =
      file.mimetype === 'application/pdf' || nombre.toLowerCase().endsWith('.pdf');
    if (!FILE_EXT_OK.has(ext) && !esPdf) {
      throw new BadRequestException('Solo se aceptan archivos .xlsx, .xls, .csv o PDF');
    }

    await this.draftFileRepo.upsert(
      {
        borradorId: id,
        archivoNombre: nombre,
        archivoMime: file.mimetype || null,
        archivoTamano: String(file.size),
        archivoBytes: file.buffer,
      },
      ['borradorId'],
    );

    draft.archivoMime = file.mimetype || null;
    draft.archivoTamano = String(file.size);
    await this.draftRepo.save(draft);

    return {
      data: {
        archivoMime: file.mimetype || null,
        archivoTamano: file.size,
      },
    };
  }

  async prepareConfirmation(
    id: string,
    dto: PrepareImportDraftConfirmationDto,
    user: AccessTokenPayload,
  ) {
    const draft = await this.loadActiveDraft(id);
    this.assertDraftAccess(user, draft);

    if (Array.isArray(dto.filasIncluidas) && dto.filasIncluidas.length > 0) {
      let payload;
      try {
        payload = validateDraftPayload(draft.payload);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Payload invalido');
      }
      const filasIncluidas = dto.filasIncluidas.filter(
        (n): n is number => typeof n === 'number' && Number.isFinite(n),
      );
      const nextPayload = {
        ...payload,
        preview: {
          ...payload.preview,
          importConfirm: {
            ...payload.preview?.importConfirm,
            filas_incluidas: filasIncluidas,
          },
        },
      };
      const meta = metadataFromDraftPayload(nextPayload);
      Object.assign(draft, meta);
      await this.draftRepo.save(draft);
    }

    const cargaId = randomUUID();
    const tenantId = this.tenantContext.getTenantId();
    const archivo = await this.draftFileRepo.findOne({ where: { borradorId: id } });

    let archivoMime: string | null = null;
    let archivoTamano: number | null = null;

    if (archivo?.archivoBytes?.length) {
      await this.importFileRepo.save(
        this.importFileRepo.create({
          tenantId,
          cargaId,
          archivoNombre: archivo.archivoNombre ?? draft.archivoNombre ?? 'importacion',
          archivoMime: archivo.archivoMime ?? null,
          archivoBytes: archivo.archivoBytes,
        }),
      );
      archivoMime = archivo.archivoMime ?? null;
      archivoTamano = Number(archivo.archivoTamano) || archivo.archivoBytes.length;
    }

    const chunkCount = await this.chunkRepo.count({ where: { borradorId: id } });

    return {
      data: {
        cargaId,
        sucursalId: draft.sucursalId ?? null,
        archivoStoragePath: null,
        archivoMime,
        archivoTamano,
        chunkCount,
      },
    };
  }

  async resolveExecuteRows(
    draftId: string,
    user: AccessTokenPayload,
    chunkStart = 0,
    chunksToProcess = 1,
  ): Promise<ImportPreviewRowDto[]> {
    const draft = await this.loadActiveDraft(draftId);
    this.assertDraftAccess(user, draft);

    let payload;
    try {
      payload = validateDraftPayload(draft.payload);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Payload invalido');
    }

    const filasIncluidas = includedRowsFromDraftPayload(payload);
    const start = Math.max(0, Math.trunc(chunkStart));
    const count = Math.max(1, Math.trunc(chunksToProcess));
    const end = start + count - 1;

    const chunks = await this.chunkRepo.find({
      where: { borradorId: draftId },
      order: { chunkIndex: 'ASC' },
    });

    const selected = chunks.filter(
      (c) => c.chunkIndex >= start && c.chunkIndex <= end,
    );

    const out: ImportPreviewRowDto[] = [];
    for (const chunk of selected) {
      const rowOffset = chunk.chunkIndex * IMPORT_DRAFT_CHUNK_SIZE;
      out.push(
        ...draftRowsToImportPreviewRows(
          chunk.filas,
          payload.mapeo,
          filasIncluidas,
          rowOffset,
        ),
      );
    }
    return out;
  }

  private async loadActiveDraft(id: string): Promise<ImportacionBorrador> {
    const tenantId = this.tenantContext.getTenantId();
    const draft = await this.draftRepo.findOne({
      where: { id, tenantId, estado: 'activo' },
    });
    if (!draft) {
      throw new NotFoundException('Borrador no encontrado');
    }
    return draft;
  }

  private async readAllDraftRows(draftId: string) {
    const chunks = await this.chunkRepo.find({
      where: { borradorId: draftId },
      order: { chunkIndex: 'ASC' },
    });
    return chunks.flatMap((c) => normalizeDraftRows(c.filas));
  }

  private isDraftAdmin(user: AccessTokenPayload): boolean {
    return resolveAppRole(user) === 'admin';
  }

  private assertDraftAccess(user: AccessTokenPayload, draft: ImportacionBorrador): void {
    if (this.isDraftAdmin(user)) return;
    if (draft.usuarioId !== user.sub) {
      throw new ForbiddenException('Sin permisos sobre el borrador');
    }
  }

  private fileExtension(nombre: string): string {
    const i = nombre.lastIndexOf('.');
    return i >= 0 ? nombre.slice(i).toLowerCase() : '';
  }

  private async mapListItem(draft: ImportacionBorrador) {
    const tenantId = this.tenantContext.getTenantId();
    const [proveedor, sucursal, usuario, archivo] = await Promise.all([
      draft.proveedorId
        ? this.proveedorRepo.findOne({
            where: { id: draft.proveedorId, tenantId },
            select: { nombre: true },
          })
        : Promise.resolve(null),
      draft.sucursalId
        ? this.sucursalRepo.findOne({
            where: { id: draft.sucursalId, tenantId },
            select: { nombre: true },
          })
        : Promise.resolve(null),
      draft.usuarioId
        ? this.usuarioRepo.findOne({
            where: { id: draft.usuarioId, tenantId },
            select: { nombre: true, email: true },
          })
        : Promise.resolve(null),
      this.draftFileRepo.exist({ where: { borradorId: draft.id } }),
    ]);

    return {
      id: draft.id,
      flujo: draft.flujo,
      paso: draft.paso,
      origen: draft.origen,
      archivoNombre: draft.archivoNombre,
      archivoMime: draft.archivoMime,
      archivoTamano: draft.archivoTamano != null ? Number(draft.archivoTamano) : null,
      totalFilas: draft.totalFilas,
      proveedorId: draft.proveedorId,
      sucursalId: draft.sucursalId,
      usuarioId: draft.usuarioId,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
      proveedor: proveedor ? { nombre: proveedor.nombre } : null,
      sucursal: sucursal ? { nombre: sucursal.nombre } : null,
      usuario: usuario ? { nombre: usuario.nombre, email: usuario.email } : null,
      tieneArchivo: archivo,
    };
  }
}
