import {createHmac, timingSafeEqual} from 'crypto';
import {TALLY_WEBHOOK_SECRET} from '../../../utils/config';
import {UnauthorizedException} from '../../../utils/service-error';
import type {ITallyWebhookPayload, ITallySubmissionData} from './interface';
import * as authService from '../auth/service';
import {compareStrings} from '../../../utils';
import {verifyPolarWebhookSignature} from '../billing/providers/polar';

export function verifyTallySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined = TALLY_WEBHOOK_SECRET,
): void {
  if (!secret)
    throw new UnauthorizedException('Tally webhook is not configured');
  if (!signature) {
    throw new UnauthorizedException('Missing Tally-Signature header');
  }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(rawBody).digest('base64'),
  );
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new UnauthorizedException('Invalid Tally webhook signature');
  }
}

/**
 * Extract email and optional name from Tally payload fields.
 */
export function parseTallySubmission(
  payload: ITallyWebhookPayload,
): ITallySubmissionData | null {
  const data = payload.data;
  const fields = data?.fields ?? [];
  if (fields.length === 0) return null;

  const emailField = fields.find(
    field =>
      compareStrings(field.key, 'question_EWjeWq') &&
      compareStrings(field.type, 'INPUT_EMAIL'),
  );
  if (!emailField) return null;

  const email = emailField.value;
  if (!email) return null;

  const nameField = fields.find(
    field =>
      compareStrings(field.key, 'question_POMLOd') &&
      compareStrings(field.type, 'INPUT_TEXT'),
  );

  return {
    email: email.trim(),
    name: nameField?.value ? nameField.value.trim() : undefined,
    formName: data?.formName,
  };
}

export async function processTallySubmission(
  payload: ITallyWebhookPayload,
): Promise<{
  message: string;
  data: {
    email?: string;
    inviteSent: boolean;
  };
}> {
  const submission = parseTallySubmission(payload);
  if (!submission) {
    return {
      message: 'No email in submission; skipped',
      data: {inviteSent: false},
    };
  }

  try {
    await authService.sendInviteCode({email: submission.email});
  } catch (error) {
    return {
      message: 'Failed to send invite code',
      data: {inviteSent: false},
    };
  }

  return {
    message: 'Early access invite sent',
    data: {email: submission.email, inviteSent: true},
  };
}

export function verifyPolarSignature(
  rawBody: Buffer,
  signature: string | undefined | Record<string, string | string[] | undefined>,
): void {
  verifyPolarWebhookSignature(rawBody, signature);
}
