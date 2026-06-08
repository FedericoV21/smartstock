import { Sucursal } from '../../branches/entities/sucursal.entity';
import { WhatsappActor } from '../entities/whatsapp-actor.entity';
import { WhatsappAgentTurnLog } from '../entities/whatsapp-agent-turn-log.entity';
import { WhatsappBranchRule } from '../entities/whatsapp-branch-rule.entity';
import { WhatsappInboundAttachment } from '../entities/whatsapp-inbound-attachment.entity';
import { WhatsappInboundMessage } from '../entities/whatsapp-inbound-message.entity';
import { WhatsappProcessingJob } from '../entities/whatsapp-processing-job.entity';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function serializeInboundMessageBrief(msg: WhatsappInboundMessage | null | undefined) {
  if (!msg) return null;
  return {
    wamid: msg.wamid,
    from_wa_id: msg.fromWaId,
    message_type: msg.messageType,
    text_body: msg.textBody,
    received_at: iso(msg.receivedAt),
  };
}

export function serializeInboundAttachmentBrief(att: WhatsappInboundAttachment | null | undefined) {
  if (!att) return null;
  return {
    mime_type: att.mimeType,
    filename: att.filename,
    storage_bucket: att.storageBucket,
    storage_path: att.storagePath,
    archivo_tamano: att.archivoTamano != null ? Number(att.archivoTamano) : null,
  };
}

export function serializeJob(job: WhatsappProcessingJob) {
  return {
    id: job.id,
    status: job.status,
    document_type: job.documentType,
    branch_resolution_status: job.branchResolutionStatus,
    branch_resolution_reason: job.branchResolutionReason,
    error_code: job.errorCode,
    error_detail: job.errorDetail,
    created_at: iso(job.createdAt),
    started_at: iso(job.startedAt),
    finished_at: iso(job.finishedAt),
    retry_count: job.retryCount,
    last_error_at: iso(job.lastErrorAt),
    target_entity_type: job.targetEntityType,
    target_entity_id: job.targetEntityId,
    whatsapp_inbound_message: serializeInboundMessageBrief(job.inboundMessage),
    whatsapp_inbound_attachment: serializeInboundAttachmentBrief(job.inboundAttachment),
  };
}

export function serializeSucursalBrief(sucursal: Sucursal | null | undefined) {
  if (!sucursal) return null;
  return {
    id: sucursal.id,
    nombre: sucursal.nombre,
    codigo: sucursal.codigo,
    es_principal: sucursal.esPrincipal,
    activa: sucursal.activa,
  };
}

export function serializeBranchRule(rule: WhatsappBranchRule) {
  return {
    id: rule.id,
    sucursal_id: rule.sucursalId,
    from_wa_id: rule.fromWaId,
    phone_number_id: rule.phoneNumberId,
    prioridad: rule.prioridad,
    activa: rule.activa,
    created_at: iso(rule.createdAt),
    sucursal: serializeSucursalBrief(rule.sucursal),
  };
}

function serializeActorBrief(actor: WhatsappActor | null | undefined) {
  if (!actor) return null;
  const usuario = actor.usuario;
  return {
    id: actor.id,
    from_wa_id: actor.fromWaId,
    rol_whatsapp: actor.rolWhatsapp,
    trust_level: actor.trustLevel,
    usuario: usuario
      ? {
          id: usuario.id,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          email: usuario.email,
          rol: usuario.rol,
        }
      : null,
  };
}

export function serializeTurnLog(row: WhatsappAgentTurnLog) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    actor_id: row.actorId,
    usuario_id: row.usuarioId,
    inbound_message_id: row.inboundMessageId,
    action_log_id: row.actionLogId,
    from_wa_id: row.fromWaId,
    channel: row.channel,
    source: row.source,
    input_body: row.inputBody,
    resolved_message: row.resolvedMessage,
    reply_body: row.replyBody,
    replies: row.replies,
    intent: row.intent,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    fallback_reason: row.fallbackReason,
    status: row.status,
    tool_name: row.toolName,
    tool_args: row.toolArgs,
    tool_result: row.toolResult,
    tool_trace: row.toolTrace,
    processing_trace: row.processingTrace,
    duration_ms: row.durationMs,
    error_detail: row.errorDetail,
    created_at: iso(row.createdAt),
    expires_at: iso(row.expiresAt),
    actor: serializeActorBrief(row.actor),
  };
}
