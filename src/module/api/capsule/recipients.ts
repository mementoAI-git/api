import {randomUUID} from 'crypto';
import {isValidObjectId} from 'mongoose';
import Beneficiary, {type IBeneficiary} from '../../database/model/beneficiary';
import type {
  ICapsuleRecipientInput,
  ICapsuleRecipientSnapshot,
} from '../../database/model/capsule';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';

export type RecipientInput = string | ICapsuleRecipientInput;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function snapshotFromBeneficiary(
  beneficiary: IBeneficiary & {_id?: unknown; id?: string},
): ICapsuleRecipientSnapshot {
  return {
    recipient_id: randomUUID(),
    beneficiary_id: String(beneficiary._id || beneficiary.id),
    ...(beneficiary.user && {linked_user_id: String(beneficiary.user)}),
    email: normalizeEmail(beneficiary.email),
    ...(beneficiary.name && {display_name: beneficiary.name.trim()}),
    delivery_status: 'pending',
  };
}

export async function normalizeCapsuleRecipients(
  inputs: RecipientInput[],
  senderId: string,
): Promise<{snapshots: ICapsuleRecipientSnapshot[]; legacyIds: string[]}> {
  const snapshots: ICapsuleRecipientSnapshot[] = [];
  const seenEmails = new Set<string>();

  for (const input of inputs || []) {
    const canonical = typeof input === 'string' ? null : input;
    const raw = typeof input === 'string' ? input.trim() : '';
    const beneficiaryId =
      canonical?.beneficiary_id ||
      (raw && isValidObjectId(raw) ? raw : undefined);
    let beneficiary: (IBeneficiary & {_id?: unknown; id?: string}) | null =
      null;

    if (beneficiaryId) {
      beneficiary = await Beneficiary.findOne({
        _id: beneficiaryId,
        benefactor: senderId,
      }).lean();
      if (!beneficiary) throw new NotFoundException('Recipient not found');
    } else {
      const email = normalizeEmail(canonical?.email || raw);
      beneficiary = await Beneficiary.findOne({
        benefactor: senderId,
        email: {
          $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
          $options: 'i',
        },
      }).lean();
      if (!beneficiary && !/^\S+@\S+\.\S+$/.test(email)) {
        throw new NotFoundException('Recipient not found');
      }
      if (!beneficiary) {
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);
        snapshots.push({
          recipient_id: canonical?.recipient_id || randomUUID(),
          ...(canonical?.linked_user_id && {
            linked_user_id: canonical.linked_user_id,
          }),
          email,
          ...(canonical?.display_name?.trim() && {
            display_name: canonical.display_name.trim(),
          }),
          delivery_status: 'pending',
        });
        continue;
      }
    }

    if (
      beneficiary &&
      beneficiary.access_scope &&
      !['full_vault', 'capsules_only'].includes(beneficiary.access_scope)
    ) {
      throw new BadRequestException(
        `Beneficiary "${beneficiary.name || beneficiary.email}" does not have capsule access permissions (${beneficiary.access_scope}).`,
      );
    }

    const snapshot = snapshotFromBeneficiary(beneficiary);
    if (seenEmails.has(snapshot.email)) continue;
    seenEmails.add(snapshot.email);
    snapshots.push(snapshot);
  }

  return {
    snapshots,
    legacyIds: snapshots.flatMap(snapshot =>
      snapshot.beneficiary_id ? [snapshot.beneficiary_id] : [],
    ),
  };
}
