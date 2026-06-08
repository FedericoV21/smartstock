import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { WhatsappAgentTurnLog } from './entities/whatsapp-agent-turn-log.entity';
import { serializeTurnLog } from './utils/whatsapp-serialize.util';
import { WhatsappBaseService } from './whatsapp-base.service';

const ALLOWED_CHANNELS = new Set(['live', 'sandbox']);
const ALLOWED_STATUSES = new Set(['success', 'fallback', 'error', 'blocked']);

function cleanText(value: string | null | undefined, max = 120): string | null {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

function cleanSearch(value: string | null | undefined): string | null {
  return cleanText(value, 80)?.replace(/[%_,]/g, ' ').replace(/\s+/g, ' ') ?? null;
}

function parseLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Number(value)));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class WhatsappLogsService {
  constructor(
    private readonly base: WhatsappBaseService,
    @InjectRepository(WhatsappAgentTurnLog)
    private readonly logRepo: Repository<WhatsappAgentTurnLog>,
  ) {}

  async listLogs(
    user: AccessTokenPayload,
    query: {
      limit?: number;
      cursor?: string;
      from?: string;
      to?: string;
      actor_id?: string;
      channel?: string;
      status?: string;
      tool?: string;
      intent?: string;
      q?: string;
    },
  ) {
    await this.base.assertModuloWhatsApp();
    this.base.assertAdminOrSuper(user);

    const tenantId = this.base.getTenantId();
    const limit = parseLimit(query.limit);
    const cursor = parseDate(query.cursor);
    const from = parseDate(query.from);
    const to = parseDate(query.to);
    const actorId = cleanText(query.actor_id, 80);
    const channel = cleanText(query.channel, 20);
    const status = cleanText(query.status, 20);
    const tool = cleanText(query.tool, 120);
    const intent = cleanText(query.intent, 120);
    const q = cleanSearch(query.q);

    const qb = this.logRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actor', 'actor')
      .leftJoinAndSelect('actor.usuario', 'usuario')
      .where('log.tenant_id = :tenantId', { tenantId })
      .orderBy('log.created_at', 'DESC')
      .take(limit + 1);

    if (cursor) qb.andWhere('log.created_at < :cursor', { cursor });
    if (from) qb.andWhere('log.created_at >= :from', { from });
    if (to) qb.andWhere('log.created_at <= :to', { to });
    if (actorId) qb.andWhere('log.actor_id = :actorId', { actorId });
    if (channel && ALLOWED_CHANNELS.has(channel)) {
      qb.andWhere('log.channel = :channel', { channel });
    }
    if (status && ALLOWED_STATUSES.has(status)) {
      qb.andWhere('log.status = :status', { status });
    }
    if (tool) qb.andWhere('log.tool_name = :tool', { tool });
    if (intent) qb.andWhere('log.intent = :intent', { intent });
    if (q) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('log.input_body ILIKE :q', { q: `%${q}%` })
            .orWhere('log.reply_body ILIKE :q', { q: `%${q}%` })
            .orWhere('log.from_wa_id ILIKE :q', { q: `%${q}%` })
            .orWhere('log.intent ILIKE :q', { q: `%${q}%` })
            .orWhere('log.tool_name ILIKE :q', { q: `%${q}%` })
            .orWhere('log.fallback_reason ILIKE :q', { q: `%${q}%` });
        }),
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const logs = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? logs.at(-1)?.createdAt?.toISOString() ?? null : null;

    return {
      logs: logs.map(serializeTurnLog),
      nextCursor,
    };
  }
}
