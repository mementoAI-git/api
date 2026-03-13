import { createHmac } from "crypto";
import { TALLY_WEBHOOK_SECRET } from "../../../utils/config";
import { UnauthorizedException } from "../../../utils/service-error";
import type { ITallyWebhookPayload, ITallySubmissionData } from "./interface";
import * as authService from "../auth/service";
import { compareStrings } from "../../../utils";

export function verifyTallySignature(rawBody: ITallyWebhookPayload, signature: string | undefined): void {
  if (!TALLY_WEBHOOK_SECRET) {
    return;
  }
  if (!signature) {
    throw new UnauthorizedException("Missing Tally-Signature header");
  }

  const calculatedSignature = createHmac("sha256", TALLY_WEBHOOK_SECRET)
    .update(JSON.stringify(rawBody))
    .digest("base64");

  if (signature !== calculatedSignature) {
    throw new UnauthorizedException("Invalid Tally webhook signature");
  }
}

/**
 * Extract email and optional name from Tally payload fields.
 */
export function parseTallySubmission(payload: ITallyWebhookPayload): ITallySubmissionData | null {
  const data = payload.data;
  const fields = (data?.fields) ?? [];
  if (fields.length === 0) return null;

  const emailField = fields.find(field =>
    compareStrings(field.key, "question_EWjeWq") &&
    compareStrings(field.type, "INPUT_EMAIL"))
  if (!emailField) return null;

  const email = emailField.value;
  if (!email) return null;

  const nameField = fields.find(field =>
    compareStrings(field.key, "question_POMLOd") &&
    compareStrings(field.type, "INPUT_TEXT"))

  return {
    email: email.trim(),
    name: nameField?.value ? nameField.value.trim() : undefined,
    formName: data?.formName,
  };
}

export async function processTallySubmission(payload: ITallyWebhookPayload): Promise<{
  message: string;
  data: {
    email?: string;
    inviteSent: boolean
  };
}> {
  const submission = parseTallySubmission(payload);
  if (!submission) {
    return {
      message: "No email in submission; skipped",
      data: { inviteSent: false },
    };
  }

  try {
    await authService.sendInviteCode({ email: submission.email });
  } catch (error) {
    return {
      message: "Failed to send invite code",
      data: { inviteSent: false },
    };
  }

  return {
    message: "Early access invite sent",
    data: { email: submission.email, inviteSent: true },
  };
}
