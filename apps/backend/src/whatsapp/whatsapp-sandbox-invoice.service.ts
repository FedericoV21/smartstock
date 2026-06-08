import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { SucursalContext } from '../branches/sucursal-context.service';
import { LectorConfirmacionChatbotService } from '../lector-facturas/lector-confirmacion-chatbot.service';
import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';
import { LectorFacturasExtractService } from '../lector-facturas/lector-facturas-extract.service';
import { LectorFacturasBaseService } from '../lector-facturas/lector-facturas-base.service';
import { LectorStorageService } from '../lector-facturas/lector-storage.service';
import type { ArchivoFacturaEntrada } from '../lector-facturas/utils/extraer-factura-ia-pura.util';
import { validarArchivosFacturaIa } from '../lector-facturas/utils/extraer-factura-ia-pura.util';
import type {
  SandboxInvoiceTicketDto,
  WhatsappSandboxMessageDto,
} from './types/whatsapp-sandbox.types';
import {
  buildInvoiceTicketChatSummary,
  buildSandboxInvoiceTicketSnapshot,
} from './utils/whatsapp-sandbox-ticket.util';
import { WhatsappSandboxService } from './whatsapp-sandbox.service';

function uploadedFilesSummary(archivos: ArchivoFacturaEntrada[]): string {
  const names = archivos.map((a) => a.name || 'factura').slice(0, 4);
  const rest = archivos.length > names.length ? ` y ${archivos.length - names.length} mas` : '';
  return `${names.join(', ')}${rest}`;
}

function jobFilesFromPreview(result: unknown) {
  const obj = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
  const multipagina =
    obj.multipagina && typeof obj.multipagina === 'object' && !Array.isArray(obj.multipagina)
      ? (obj.multipagina as Record<string, unknown>)
      : {};
  const archivos = Array.isArray(multipagina.archivos) ? multipagina.archivos : [];
  return archivos
    .map((archivo) => {
      const row =
        archivo && typeof archivo === 'object' && !Array.isArray(archivo)
          ? (archivo as Record<string, unknown>)
          : {};
      const storagePath = typeof row.storagePath === 'string' ? row.storagePath : '';
      if (!storagePath) return null;
      return {
        nombre: typeof row.nombre === 'string' ? row.nombre : 'factura',
        mimeType: typeof row.mimeType === 'string' ? row.mimeType : 'application/octet-stream',
        size: Number.isFinite(Number(row.size)) ? Number(row.size) : 0,
        storageBucket: 'facturas-recibidas',
        storagePath,
      };
    })
    .filter(
      (
        row,
      ): row is {
        nombre: string;
        mimeType: string;
        size: number;
        storageBucket: string;
        storagePath: string;
      } => row != null,
    );
}

function rawIaSnippet(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 600) : null;
}

@Injectable()
export class WhatsappSandboxInvoiceService {
  constructor(
    private readonly lectorBase: LectorFacturasBaseService,
    private readonly extractService: LectorFacturasExtractService,
    private readonly chatbot: LectorConfirmacionChatbotService,
    private readonly storage: LectorStorageService,
    private readonly sandbox: WhatsappSandboxService,
    private readonly sucursalContext: SucursalContext,
    @InjectRepository(LectorFacturaJob) private readonly jobRepo: Repository<LectorFacturaJob>,
  ) {}

  multerToEntrada(files: Express.Multer.File[] | undefined): ArchivoFacturaEntrada[] {
    return (files ?? []).map((file, i) => ({
      name: file.originalname || `factura-${i + 1}`,
      type: file.mimetype,
      size: file.size || file.buffer.byteLength,
      bytes: new Uint8Array(file.buffer),
    }));
  }

  async processSandboxInvoiceUpload(params: {
    user: AccessTokenPayload;
    sucursalId: string;
    archivos: ArchivoFacturaEntrada[];
  }): Promise<
    | {
        ok: true;
        messages: WhatsappSandboxMessageDto[];
        job_id: string;
        impact_hash: string;
        action_id: string | null;
        ticket: SandboxInvoiceTicketDto;
      }
    | {
        ok: false;
        status: number;
        error: string;
        messages: WhatsappSandboxMessageDto[];
      }
  > {
    await this.lectorBase.assertModuloLector();
    const tenantId = this.lectorBase.getTenantId();
    const role = this.sandbox.sandboxRoleFromUser(params.user);

    const validacion = validarArchivosFacturaIa(params.archivos);
    if (!validacion.ok) {
      return {
        ok: false,
        status: validacion.status,
        error: validacion.error,
        messages: await this.sandbox.loadMessages(params.user),
      };
    }

    const actor = await this.sandbox.ensureSandboxActor({
      tenantId,
      userId: params.user.sub,
      role,
    });

    await this.sandbox.insertMessage({
      tenantId,
      userId: params.user.sub,
      actorId: actor.id,
      role: 'user',
      content: `Subi una factura: ${uploadedFilesSummary(params.archivos)}`,
      metadata: {
        kind: 'sandbox_invoice_upload',
        filenames: params.archivos.map((a) => a.name),
      },
    });

    const result = await this.extractService.procesarFacturaIa({
      tenantId,
      userId: params.user.sub,
      archivos: params.archivos,
      source: 'whatsapp',
    });

    if (!result.ok) {
      const rawSnippet = rawIaSnippet(result.respuesta_raw);
      await this.sandbox.insertMessage({
        tenantId,
        userId: params.user.sub,
        actorId: actor.id,
        role: 'assistant',
        content: [
          `No pude procesar la factura con IA: ${result.error}`,
          rawSnippet ? `Respuesta IA recibida: ${rawSnippet}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        metadata: {
          kind: 'sandbox_invoice_error',
          status: result.status,
          raw_snippet: rawSnippet,
        },
      });
      return {
        ok: false,
        status: result.status,
        error: result.error,
        messages: await this.sandbox.loadMessages(params.user),
      };
    }

    const prepared = await this.chatbot.prepararDesdeResultado({
      tenantId,
      sucursalId: params.sucursalId,
      resultado: result.payload,
    });
    const snapshot = buildSandboxInvoiceTicketSnapshot({
      resultado: result.payload,
      prepared,
    });

    const archivosJob: unknown[] = [];
    for (const archivo of params.archivos) {
      const ref = await this.storage.subirArchivoLectorFacturaJob({
        tenantId,
        source: 'whatsapp',
        archivo: {
          name: archivo.name,
          type: archivo.type,
          size: archivo.size,
          bytes: archivo.bytes,
        },
      });
      archivosJob.push(ref);
    }
    const jobFiles = jobFilesFromPreview(result.payload);
    if (jobFiles.length > 0) {
      archivosJob.push(...jobFiles);
    }

    const now = new Date();
    const job = await this.jobRepo.save(
      this.jobRepo.create({
        tenantId,
        sucursalId: params.sucursalId,
        usuarioId: params.user.sub,
        source: 'whatsapp',
        status: 'completed',
        externalId: `sandbox:${randomUUID()}`,
        archivos: archivosJob,
        lectorFacturaLogId: result.payload.log_id,
        resultado: result.payload as never,
        startedAt: now,
        finishedAt: now,
        impactoPreview: prepared.impacto as never,
        impactHash: prepared.impactHash,
        confirmPayload: prepared.confirmPayload as never,
        applicationStatus: snapshot.status === 'ready' ? 'pending' : 'blocked',
        appliedError: snapshot.status === 'ready' ? null : snapshot.blockingReasons.join(' | '),
      }),
    );

    let token: string | undefined;
    let actionId: string | null = null;
    if (snapshot.status === 'ready') {
      const action = await this.sandbox.createOrReuseInvoiceAction({
        tenantId,
        actorId: actor.id,
        fromWaId: actor.fromWaId,
        lectorJobId: job.id,
        impactHash: prepared.impactHash,
      });
      token = action.token;
      actionId = action.actionId;
    }

    const ticket = await this.sandbox.insertInvoiceTicket({
      tenantId,
      userId: params.user.sub,
      actorId: actor.id,
      fromWaId: actor.fromWaId,
      lectorFacturaJobId: job.id,
      actionLogId: actionId,
      snapshot,
    });

    await this.sandbox.insertMessage({
      tenantId,
      userId: params.user.sub,
      actorId: actor.id,
      role: 'assistant',
      content: buildInvoiceTicketChatSummary(ticket, token, null),
      metadata: {
        kind: 'sandbox_invoice_ticket',
        ticket_id: ticket.id,
        lector_factura_job_id: job.id,
        impact_hash: prepared.impactHash,
        action_id: actionId,
        real_confirmation: Boolean(token),
      },
    });

    return {
      ok: true,
      messages: await this.sandbox.loadMessages(params.user),
      job_id: job.id,
      impact_hash: prepared.impactHash,
      action_id: actionId,
      ticket,
    };
  }

  async resolveSucursalForUpload(user: AccessTokenPayload, sucursalIdRaw?: string): Promise<string> {
    if (sucursalIdRaw?.trim()) {
      this.sucursalContext.setActiveSucursalId(sucursalIdRaw.trim());
    }
    return this.sucursalContext.requireSucursalId();
  }
}
