export interface ITallyWebhookPayload {
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  data?: {
    responseId?: string;
    submissionId?: string;
    respondentId?: string;
    formId?: string;
    formName?: string;
    createdAt?: string;
    fields?: ITallyField[];
  };
}

/** Tally field; value can be null for empty inputs (e.g. TEXTAREA). */
export interface ITallyField {
  key?: string;
  label?: string;
  type?: string;
  value?: string | null;
  answer?: string;
}

export interface ITallySubmissionData {
  email: string;
  name?: string;
  formName?: string;
}
