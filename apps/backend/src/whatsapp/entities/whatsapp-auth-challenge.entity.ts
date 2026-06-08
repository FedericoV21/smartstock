import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { WhatsappAuthChallengeStatus } from '../enums/whatsapp-auth-challenge-status.enum';

@Entity({ name: 'whatsapp_auth_challenge' })
export class WhatsappAuthChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ name: 'channel_phone_number_id', type: 'text', nullable: true })
  channelPhoneNumberId: string | null;

  @Column({ name: 'otp_hash', type: 'text' })
  otpHash: string;

  @Column({ name: 'otp_salt', type: 'text' })
  otpSalt: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  maxAttempts: number;

  @Column({ name: 'resend_count', type: 'int', default: 0 })
  resendCount: number;

  @Column({ name: 'blocked_until', type: 'timestamptz', nullable: true })
  blockedUntil: Date | null;

  @Column({
    type: 'enum',
    enum: WhatsappAuthChallengeStatus,
    enumName: 'whatsapp_auth_challenge_status',
    default: WhatsappAuthChallengeStatus.pending,
  })
  status: WhatsappAuthChallengeStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;
}
