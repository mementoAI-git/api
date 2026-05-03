export interface ICreateMemoryPayload {
  title: string;
  body: string;
  tags: string[];
  status: string;
  level: number;
  attachments: string[];
  /** Group IDs that have access (user can tag more than one group). */
  groups?: string[];
  /** Beneficiary IDs who have access. */
  beneficiaries?: string[];
}

export interface IAddMessageToMemory {
  messages: {
    text: string;
    role: 'user' | 'ai';
    duration?: number;
    is_voice?: boolean;
  }[];
  memory_id?: string;
  session_id?: string;
}

export interface IDeleteMemoryPayload {
  memory_id: string;
  delete_permanently: boolean;
}

export interface IQuickCapturePayload {
  body?: string;
  attachments?: string[] | string;
  /** Comma-separated or JSON array of beneficiary IDs */
  beneficiaries?: string[] | string;
  transcript_uncertain?: boolean | string;
  /** Idempotency / client reference (optional) */
  capture_client_id?: string;
  /** Daily prompt: catalog prompt id when prompt_type is static */
  prompt_id?: string;
  prompt_text?: string;
  prompt_type?: 'static' | 'ai-generated';
  /** YYYY-MM-DD (user local) from dashboard */
  reflection_day_key?: string;
}
