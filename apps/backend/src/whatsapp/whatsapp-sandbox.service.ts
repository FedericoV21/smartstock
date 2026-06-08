import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { ILike, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { LectorConfirmacionChatbotService } from '../lector-facturas/lector-confirmacion-chatbot.service';
import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';
import { Producto } from '../products/entities/producto.entity';
import { WhatsappActionLog } from './entities/whatsapp-action-log.entity';
import { WhatsappActor } from './entities/whatsapp-actor.entity';
import { WhatsappSandboxInvoiceTicket } from './entities/whatsapp-sandbox-invoice-ticket.entity';
import { WhatsappSandboxMessage } from './entities/whatsapp-sandbox-message.entity';
import { WhatsappSandboxPendingAction } from './entities/whatsapp-sandbox-pending-action.entity';
import { WhatsappActionStatus } from './enums/whatsapp-action-status.enum';
import { WhatsappActorTrustLevel } from './enums/whatsapp-actor-trust-level.enum';
import type {
  SandboxInvoiceTicketDto,
  WhatsappSandboxMessageDto,
  WhatsappSandboxRole,
  WhatsappTextHandlerReply,
} from './types/whatsapp-sandbox.types';
import {
  buildInvoiceActionSignature,
  buildInvoiceTicketChatSummary,
  buildSandboxInvoiceTicketSnapshot,
  buildSandboxWaId,
  resumenAplicacionLectorFactura,
  sandboxRoleFromSession,
  ticketEntityToDto,
} from './utils/whatsapp-sandbox-ticket.util';
import { WhatsappBaseService } from './whatsapp-base.service';
import { WhatsappReadOnlyAgentService } from './whatsapp-read-only-agent.service';

const CONFIRMATION_WINDOW_MINUTES = 10;
const OPEN_TICKET_STATUSES = ['needs_review', 'ready', 'error'];

function textReply(body: string): WhatsappTextHandlerReply {
  return {
    body,
    messageType: 'text',
    documentLink: null,
    documentFilename: null,
    documentCaption: null,
  };
}

function messageEntityToDto(row: WhatsappSandboxMessage): WhatsappSandboxMessageDto {
  const role = row.role;
  return {
    id: row.id,
    role: role === 'user' || role === 'system' ? role : 'assistant',
    content: row.content,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.createdAt.toISOString(),
  };
}

@Injectable()
export class WhatsappSandboxService {
  constructor(
    private readonly base: WhatsappBaseService,
    private readonly agent: WhatsappReadOnlyAgentService,
    private readonly chatbot: LectorConfirmacionChatbotService,
    @InjectRepository(WhatsappSandboxMessage)
    private readonly messageRepo: Repository<WhatsappSandboxMessage>,
    @InjectRepository(WhatsappSandboxPendingAction)
    private readonly pendingActionRepo: Repository<WhatsappSandboxPendingAction>,
    @InjectRepository(WhatsappSandboxInvoiceTicket)
    private readonly ticketRepo: Repository<WhatsappSandboxInvoiceTicket>,
    @InjectRepository(WhatsappActor) private readonly actorRepo: Repository<WhatsappActor>,
    @InjectRepository(WhatsappActionLog) private readonly actionLogRepo: Repository<WhatsappActionLog>,
    @InjectRepository(LectorFacturaJob) private readonly jobRepo: Repository<LectorFacturaJob>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
  ) {}

  sandboxRoleFromUser(user: AccessTokenPayload): WhatsappSandboxRole {
    return sandboxRoleFromSession({
      rol: resolveAppRole(user) ?? 'operador',
      isSuperAdmin: this.base.isSuperAdmin(user),
    });
  }

  async loadMessages(user: AccessTokenPayload, limit = 200): Promise<WhatsappSandboxMessageDto[]> {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();
    const capped = Math.max(1, Math.min(300, limit));
    const rows = await this.messageRepo.find({
      where: { tenantId, usuarioId: user.sub },
      order: { createdAt: 'DESC' },
      take: capped,
    });
    return rows.reverse().map(messageEntityToDto);
  }

  async insertMessage(params: {
    tenantId: string;
    userId: string;
    actorId: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.messageRepo.save(
      this.messageRepo.create({
        tenantId: params.tenantId,
        usuarioId: params.userId,
        actorId: params.actorId,
        role: params.role,
        content: params.content,
        metadata: params.metadata ?? {},
      }),
    );
  }

  async clearChat(user: AccessTokenPayload): Promise<void> {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();
    const fromWaId = buildSandboxWaId({ tenantId, userId: user.sub });
    const actor = await this.actorRepo.findOne({ where: { tenantId, fromWaId } });

    await this.messageRepo.delete({ tenantId, usuarioId: user.sub });
    await this.pendingActionRepo.delete({ tenantId, usuarioId: user.sub });
    if (actor) {
      // conversation_state deferred — no table in Nest MVP
    }
  }

  async ensureSandboxActor(params: {
    tenantId: string;
    userId: string;
    role: WhatsappSandboxRole;
  }): Promise<{ id: string; fromWaId: string }> {
    const fromWaId = buildSandboxWaId({ tenantId: params.tenantId, userId: params.userId });
    let actor = await this.actorRepo.findOne({ where: { tenantId: params.tenantId, fromWaId } });
    const now = new Date();
    if (actor) {
      const needsUpdate =
        actor.rolWhatsapp !== params.role ||
        actor.trustLevel !== WhatsappActorTrustLevel.verified ||
        actor.activo !== true ||
        actor.usuarioId !== params.userId;
      if (needsUpdate) {
        actor.usuarioId = params.userId;
        actor.rolWhatsapp = params.role;
        actor.trustLevel = WhatsappActorTrustLevel.verified;
        actor.activo = true;
        actor.verifiedAt = now;
        await this.actorRepo.save(actor);
      }
      return { id: actor.id, fromWaId };
    }

    actor = this.actorRepo.create({
      tenantId: params.tenantId,
      usuarioId: params.userId,
      fromWaId,
      rolWhatsapp: params.role,
      trustLevel: WhatsappActorTrustLevel.verified,
      activo: true,
      verifiedAt: now,
    });
    try {
      await this.actorRepo.save(actor);
    } catch {
      actor = await this.actorRepo.findOneOrFail({ where: { tenantId: params.tenantId, fromWaId } });
    }
    return { id: actor.id, fromWaId };
  }

  async sendSandboxChatMessage(
    user: AccessTokenPayload,
    content: string,
  ): Promise<{ messages: WhatsappSandboxMessageDto[]; replies: WhatsappTextHandlerReply[] }> {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();
    const trimmed = content.trim();
    if (!trimmed) {
      return { messages: await this.loadMessages(user), replies: [] };
    }
    if (trimmed.length > 2000) {
      throw new BadRequestException('El mensaje es demasiado largo.');
    }

    const role = this.sandboxRoleFromUser(user);
    const actor = await this.ensureSandboxActor({ tenantId, userId: user.sub, role });

    await this.insertMessage({
      tenantId,
      userId: user.sub,
      actorId: actor.id,
      role: 'user',
      content: trimmed,
    });

    const ticketHandled = await this.handleInvoiceTicketChatCommand({
      tenantId,
      userId: user.sub,
      actorId: actor.id,
      fromWaId: actor.fromWaId,
      content: trimmed,
      writeSandboxMessage: true,
    });
    if (ticketHandled.handled) return ticketHandled;

    const agentResult = await this.agent.run({
      tenantId,
      textBody: trimmed,
      channel: 'sandbox',
      source: 'sandbox_text',
      actorId: actor.id,
      usuarioId: user.sub,
      fromWaId: actor.fromWaId,
      inboundMessageId: `sandbox:${randomUUID()}`,
    });

    const reply = textReply(agentResult.reply);
    await this.insertMessage({
      tenantId,
      userId: user.sub,
      actorId: actor.id,
      role: 'assistant',
      content: reply.body,
      metadata: {
        intent: agentResult.intent,
        tool: agentResult.tool,
        confidence: agentResult.confidence,
      },
    });

    return {
      messages: await this.loadMessages(user),
      replies: [reply],
    };
  }

  async listInvoiceTickets(user: AccessTokenPayload, limit = 20): Promise<{ tickets: SandboxInvoiceTicketDto[] }> {
    const tenantId = this.base.getTenantId();
    const capped = Math.max(1, Math.min(100, limit));
    const rows = await this.ticketRepo.find({
      where: { tenantId, usuarioId: user.sub },
      order: { createdAt: 'DESC' },
      take: capped,
    });
    return { tickets: rows.map(ticketEntityToDto) };
  }

  async linkTicketItem(params: {
    user: AccessTokenPayload;
    ticketId: string;
    itemIndice: number;
    productoId: string;
    writeSandboxMessage?: boolean;
  }): Promise<{ ticket: SandboxInvoiceTicketDto; messages: WhatsappSandboxMessageDto[]; reply: WhatsappTextHandlerReply }> {
    const writeSandboxMessage = params.writeSandboxMessage !== false;
    const tenantId = this.base.getTenantId();
    const ticket = await this.loadTicket(tenantId, params.user.sub, params.ticketId);
    if (ticket.status === 'closed' || ticket.status === 'applied') {
      throw new BadRequestException('Este ticket ya no admite cambios.');
    }

    const producto = await this.productoRepo.findOne({
      where: { tenantId, id: params.productoId, activo: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado o inactivo.');

    const job = await this.jobRepo.findOne({
      where: { id: ticket.lector_factura_job_id, tenantId },
    });
    if (!job?.resultado) throw new NotFoundException('Job de factura no encontrado.');

    const resultado = { ...job.resultado } as Record<string, unknown>;
    const items = Array.isArray(resultado.items) ? [...(resultado.items as unknown[])] : [];
    const idx = items.findIndex((raw, position) => {
      const item = raw as Record<string, unknown>;
      const indice = Number(item.indice);
      return (Number.isFinite(indice) ? indice : position) === params.itemIndice;
    });
    if (idx < 0) throw new NotFoundException('Item de factura no encontrado en el ticket.');

    const item = { ...(items[idx] as Record<string, unknown>) };
    item.match = {
      producto_id: producto.id,
      confidence: 1,
      metodo: 'manual_ticket',
      producto_nombre: producto.nombre,
      requires_review: false,
    };
    item.producto_unidad = producto.unidad ?? item.producto_unidad ?? null;
    items[idx] = item;
    resultado.items = items;
    job.resultado = resultado;
    await this.jobRepo.save(job);

    const refreshed = await this.refreshTicketFromJob(tenantId, ticket, job);
    const reply = textReply(buildInvoiceTicketChatSummary(refreshed.ticket, refreshed.token, null));
    if (writeSandboxMessage) {
      await this.insertMessage({
        tenantId,
        userId: params.user.sub,
        actorId: ticket.actor_id,
        role: 'assistant',
        content: reply.body,
        metadata: { kind: 'sandbox_invoice_ticket', ticket_id: ticket.id },
      });
    }
    return {
      ticket: refreshed.ticket,
      messages: writeSandboxMessage ? await this.loadMessages(params.user) : [],
      reply,
    };
  }

  async continueTicket(params: {
    user: AccessTokenPayload;
    ticketId: string;
    token?: string | null;
    writeSandboxMessage?: boolean;
  }): Promise<{ ticket: SandboxInvoiceTicketDto; messages: WhatsappSandboxMessageDto[]; reply: WhatsappTextHandlerReply }> {
    const writeSandboxMessage = params.writeSandboxMessage !== false;
    const tenantId = this.base.getTenantId();
    const ticket = await this.loadTicket(tenantId, params.user.sub, params.ticketId);

    if (ticket.status === 'closed') {
      const reply = textReply('Ese ticket ya esta cerrado. Subi la factura otra vez si queres reabrir el analisis.');
      return this.replyWithOptionalMessage({ tenantId, user: params.user, ticket, reply, writeSandboxMessage });
    }
    if (ticket.status === 'applied') {
      const reply = textReply('Ese ticket ya fue cargado.');
      return this.replyWithOptionalMessage({ tenantId, user: params.user, ticket, reply, writeSandboxMessage });
    }

    if (params.token && ticket.action_log_id) {
      const action = await this.actionLogRepo.findOne({
        where: { id: ticket.action_log_id, tenantId },
      });
      if (action?.confirmationToken && action.confirmationToken !== params.token) {
        const reply = textReply('Codigo de confirmacion incorrecto. Revisalo y volve a intentar.');
        return this.replyWithOptionalMessage({ tenantId, user: params.user, ticket, reply, writeSandboxMessage });
      }
    }

    const job = await this.jobRepo.findOneOrFail({
      where: { id: ticket.lector_factura_job_id, tenantId },
    });
    const refreshed = await this.refreshTicketFromJob(tenantId, ticket, job);

    if (refreshed.ticket.status !== 'ready') {
      const reply = textReply(buildInvoiceTicketChatSummary(refreshed.ticket, refreshed.token, null));
      return this.replyWithOptionalMessage({
        tenantId,
        user: params.user,
        ticket: refreshed.ticket,
        reply,
        writeSandboxMessage,
        metadata: { kind: 'sandbox_invoice_ticket', ticket_id: ticket.id },
      });
    }

    try {
      const applied = await this.chatbot.aplicarJob({
        tenantId,
        job,
        sucursalId: job.sucursalId!,
        userId: job.usuarioId ?? params.user.sub,
        acceptedImpactHash: refreshed.prepared.impactHash,
      });

      if (refreshed.actionId) {
        await this.actionLogRepo.update(
          { id: refreshed.actionId, tenantId },
          {
            actionStatus: WhatsappActionStatus.executed,
            confirmedAt: new Date(),
            executedAt: new Date(),
            resultPayload: {
              comprobante_id: applied.comprobante_id,
              actualizaciones_costos: applied.actualizaciones_costos,
              idempotent_replay: applied.idempotent_replay,
            },
            errorDetail: null,
          },
        );
      }

      const entity = await this.ticketRepo.save({
        ...await this.ticketRepo.findOneOrFail({ where: { id: ticket.id, tenantId } }),
        status: 'applied',
        appliedAt: new Date(),
        errorDetail: null,
      });
      const appliedTicket = ticketEntityToDto(entity);
      const reply = textReply(
        resumenAplicacionLectorFactura({
          comprobanteId: applied.comprobante_id,
          actualizacionesCostos: applied.actualizaciones_costos,
        }),
      );
      return this.replyWithOptionalMessage({
        tenantId,
        user: params.user,
        ticket: appliedTicket,
        reply,
        writeSandboxMessage,
        metadata: { kind: 'sandbox_invoice_ticket_applied', ticket_id: ticket.id },
      });
    } catch (e) {
      const entity = await this.ticketRepo.save({
        ...await this.ticketRepo.findOneOrFail({ where: { id: ticket.id, tenantId } }),
        status: 'error',
        errorDetail: (e as Error).message,
      });
      const reply = textReply(`No pude cargar la factura: ${(e as Error).message}`);
      return this.replyWithOptionalMessage({
        tenantId,
        user: params.user,
        ticket: ticketEntityToDto(entity),
        reply,
        writeSandboxMessage,
      });
    }
  }

  async closeTicket(params: {
    user: AccessTokenPayload;
    ticketId: string;
    writeSandboxMessage?: boolean;
  }): Promise<{ ticket: SandboxInvoiceTicketDto; messages: WhatsappSandboxMessageDto[]; reply: WhatsappTextHandlerReply }> {
    const writeSandboxMessage = params.writeSandboxMessage !== false;
    const tenantId = this.base.getTenantId();
    const ticket = await this.loadTicket(tenantId, params.user.sub, params.ticketId);

    if (ticket.status === 'applied') {
      const reply = textReply('La factura ya fue cargada; no puedo cerrar ese ticket.');
      return this.replyWithOptionalMessage({ tenantId, user: params.user, ticket, reply, writeSandboxMessage });
    }

    if (ticket.action_log_id) {
      await this.actionLogRepo.update(
        { id: ticket.action_log_id, tenantId, actionStatus: WhatsappActionStatus.pending_confirmation },
        { actionStatus: WhatsappActionStatus.cancelled, errorDetail: 'ticket_closed_by_user' },
      );
    }

    const entity = await this.ticketRepo.save({
      ...await this.ticketRepo.findOneOrFail({ where: { id: ticket.id, tenantId } }),
      status: 'closed',
      closedAt: new Date(),
      errorDetail: null,
    });
    const closedTicket = ticketEntityToDto(entity);
    const reply = textReply('Ticket cerrado. No se cargo la factura ni se modificaron datos.');
    return this.replyWithOptionalMessage({
      tenantId,
      user: params.user,
      ticket: closedTicket,
      reply,
      writeSandboxMessage,
    });
  }

  async insertInvoiceTicket(params: {
    tenantId: string;
    userId: string;
    actorId: string;
    fromWaId: string;
    lectorFacturaJobId: string;
    actionLogId: string | null;
    snapshot: ReturnType<typeof buildSandboxInvoiceTicketSnapshot>;
  }): Promise<SandboxInvoiceTicketDto> {
    const entity = await this.ticketRepo.save(
      this.ticketRepo.create({
        tenantId: params.tenantId,
        usuarioId: params.userId,
        actorId: params.actorId,
        fromWaId: params.fromWaId,
        lectorFacturaJobId: params.lectorFacturaJobId,
        actionLogId: params.actionLogId,
        status: params.snapshot.status,
        summary: params.snapshot.summary as never,
        pendingItems: params.snapshot.pendingItems as never,
        impactHash: params.snapshot.summary.impact_hash,
        errorDetail:
          params.snapshot.status === 'needs_review'
            ? params.snapshot.blockingReasons.join(' | ') || null
            : null,
      }),
    );
    return ticketEntityToDto(entity);
  }

  async createOrReuseInvoiceAction(params: {
    tenantId: string;
    actorId: string;
    fromWaId: string;
    lectorJobId: string;
    impactHash: string;
  }): Promise<{ token: string; actionId: string | null }> {
    const actionSignature = buildInvoiceActionSignature({
      tenantId: params.tenantId,
      lectorJobId: params.lectorJobId,
      impactHash: params.impactHash,
    });

    const existing = await this.actionLogRepo.findOne({
      where: { tenantId: params.tenantId, actionSignature },
    });
    if (existing?.actionStatus === WhatsappActionStatus.pending_confirmation && existing.confirmationToken) {
      return { token: existing.confirmationToken, actionId: existing.id };
    }
    if (existing?.actionStatus === WhatsappActionStatus.executed) {
      throw new BadRequestException('La accion de carga de esta factura ya fue ejecutada.');
    }

    const token = String(randomInt(0, 10_000)).padStart(4, '0');
    const expiresAt = new Date(Date.now() + CONFIRMATION_WINDOW_MINUTES * 60_000);
    const actionPayload = {
      lector_factura_job_id: params.lectorJobId,
      impact_hash: params.impactHash,
      tool_version: 'sandbox-v1',
    };

    if (existing) {
      await this.actionLogRepo.update(existing.id, {
        actorId: params.actorId,
        fromWaId: params.fromWaId,
        actionType: 'lector_factura_confirmar_importado',
        actionStatus: WhatsappActionStatus.pending_confirmation,
        confirmationToken: token,
        confirmationExpiresAt: expiresAt,
        actionPayload,
        resultPayload: null,
        errorDetail: null,
        confirmedAt: null,
        executedAt: null,
      });
      return { token, actionId: existing.id };
    }

    const inserted = await this.actionLogRepo.save(
      this.actionLogRepo.create({
        tenantId: params.tenantId,
        actorId: params.actorId,
        fromWaId: params.fromWaId,
        actionType: 'lector_factura_confirmar_importado',
        actionStatus: WhatsappActionStatus.pending_confirmation,
        actionSignature,
        confirmationToken: token,
        confirmationExpiresAt: expiresAt,
        actionPayload,
      }),
    );
    return { token, actionId: inserted.id };
  }

  private async loadTicket(
    tenantId: string,
    userId: string,
    ticketId: string,
  ): Promise<SandboxInvoiceTicketDto> {
    const row = await this.ticketRepo.findOne({
      where: { id: ticketId, tenantId, usuarioId: userId },
    });
    if (!row) throw new NotFoundException('Ticket de factura no encontrado.');
    return ticketEntityToDto(row);
  }

  private async refreshTicketFromJob(
    tenantId: string,
    ticket: SandboxInvoiceTicketDto,
    job: LectorFacturaJob,
  ): Promise<{
    prepared: Awaited<ReturnType<LectorConfirmacionChatbotService['prepararDesdeResultado']>>;
    snapshot: ReturnType<typeof buildSandboxInvoiceTicketSnapshot>;
    ticket: SandboxInvoiceTicketDto;
    token: string | null;
    actionId: string | null;
  }> {
    const prepared = await this.chatbot.prepararDesdeResultado({
      tenantId,
      sucursalId: job.sucursalId,
      resultado: job.resultado,
    });
    const snapshot = buildSandboxInvoiceTicketSnapshot({ resultado: job.resultado, prepared });

    let token: string | null = null;
    let actionId = ticket.action_log_id;
    if (snapshot.status === 'ready') {
      const action = await this.createOrReuseInvoiceAction({
        tenantId,
        actorId: ticket.actor_id,
        fromWaId: ticket.from_wa_id,
        lectorJobId: ticket.lector_factura_job_id,
        impactHash: prepared.impactHash,
      });
      token = action.token;
      actionId = action.actionId;
    } else if (ticket.action_log_id) {
      await this.actionLogRepo.update(
        { id: ticket.action_log_id, tenantId, actionStatus: WhatsappActionStatus.pending_confirmation },
        { actionStatus: WhatsappActionStatus.cancelled, errorDetail: 'ticket_requires_review' },
      );
      actionId = null;
    }

    await this.jobRepo.update(job.id, {
      resultado: job.resultado as never,
      impactoPreview: prepared.impacto as never,
      impactHash: prepared.impactHash,
      confirmPayload: prepared.confirmPayload as never,
      applicationStatus: snapshot.status === 'ready' ? 'pending' : 'blocked',
      appliedError: snapshot.status === 'ready' ? null : snapshot.blockingReasons.join(' | '),
    });

    const entity = await this.ticketRepo.save({
      ...(await this.ticketRepo.findOneOrFail({ where: { id: ticket.id, tenantId } })),
      status: snapshot.status,
      summary: { ...snapshot.summary, can_apply: snapshot.status === 'ready' } as never,
      pendingItems: snapshot.pendingItems as never,
      impactHash: snapshot.summary.impact_hash,
      actionLogId: actionId,
      errorDetail:
        snapshot.status === 'needs_review' ? snapshot.blockingReasons.join(' | ') || null : null,
      chatState: {},
    });

    return { prepared, snapshot, ticket: ticketEntityToDto(entity), token, actionId };
  }

  private async replyWithOptionalMessage(params: {
    tenantId: string;
    user: AccessTokenPayload;
    ticket: SandboxInvoiceTicketDto;
    reply: WhatsappTextHandlerReply;
    writeSandboxMessage: boolean;
    metadata?: Record<string, unknown>;
  }) {
    if (params.writeSandboxMessage) {
      await this.insertMessage({
        tenantId: params.tenantId,
        userId: params.user.sub,
        actorId: params.ticket.actor_id,
        role: 'assistant',
        content: params.reply.body,
        metadata: params.metadata ?? { kind: 'sandbox_invoice_ticket_status', ticket_id: params.ticket.id },
      });
    }
    return {
      ticket: params.ticket,
      messages: params.writeSandboxMessage ? await this.loadMessages(params.user) : [],
      reply: params.reply,
    };
  }

  private async handleInvoiceTicketChatCommand(params: {
    tenantId: string;
    userId: string;
    actorId: string;
    fromWaId: string;
    content: string;
    writeSandboxMessage: boolean;
  }): Promise<{ handled: boolean; messages: WhatsappSandboxMessageDto[]; replies: WhatsappTextHandlerReply[] }> {
    const tickets = await this.ticketRepo.find({
      where: { tenantId: params.tenantId, usuarioId: params.userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const active = tickets.find(
      (t) => OPEN_TICKET_STATUSES.includes(t.status) && t.fromWaId === params.fromWaId,
    );
    if (!active) return { handled: false, messages: [], replies: [] };

    const normalized = params.content
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    if (/^(cerrar|cancelar|cancelo|no)(\s+ticket)?$/.test(normalized)) {
      const result = await this.closeTicket({
        user: { sub: params.userId } as AccessTokenPayload,
        ticketId: active.id,
        writeSandboxMessage: params.writeSandboxMessage,
      });
      return { handled: true, messages: result.messages, replies: [result.reply] };
    }

    if (/^(cargar|continuar|confirmar|aplicar|si|ok|dale)(\s+factura)?$/.test(normalized) || /^\d{4}$/.test(normalized)) {
      const tokenMatch = normalized.match(/^(\d{4})$/);
      const result = await this.continueTicket({
        user: { sub: params.userId } as AccessTokenPayload,
        ticketId: active.id,
        token: tokenMatch?.[1] ?? null,
        writeSandboxMessage: params.writeSandboxMessage,
      });
      return { handled: true, messages: result.messages, replies: [result.reply] };
    }

    return { handled: false, messages: [], replies: [] };
  }

  async searchProductsForTicket(tenantId: string, query: string) {
    const like = `%${query.replace(/[%_,]/g, ' ').trim()}%`;
    if (!like.replace(/%/g, '').trim()) return [];
    let rows = await this.productoRepo.find({
      where: { tenantId, activo: true, nombre: ILike(like) },
      select: { id: true, codigo: true, nombre: true, precioCosto: true, unidad: true },
      order: { nombre: 'ASC' },
      take: 5,
    });
    if (rows.length === 0) {
      rows = await this.productoRepo.find({
        where: { tenantId, activo: true, codigo: ILike(like) },
        select: { id: true, codigo: true, nombre: true, precioCosto: true, unidad: true },
        order: { nombre: 'ASC' },
        take: 5,
      });
    }
    return rows.map((row, index) => ({
      option: index + 1,
      producto_id: row.id,
      nombre: row.nombre,
      codigo: row.codigo,
      precio_costo: row.precioCosto == null ? null : Number(row.precioCosto),
      unidad: row.unidad,
    }));
  }
}
