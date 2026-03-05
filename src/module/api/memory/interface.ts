
export interface ICreateMemoryPayload {
  title: string
  body: string
  tags: string[]
  status: string
  level: number
  attachments: string[]
  /** Group IDs that have access (user can tag more than one group). */
  groups?: string[]
  /** Beneficiary IDs who have access. */
  beneficiaries?: string[]
}

export interface IAddMessageToMemory {
  messages: {
    text: string
    role: 'user' | 'ai'
    duration?: number
    is_voice?: boolean
  }[]
  memory_id?: string
  session_id?: string
}

export interface IDeleteMemoryPayload {
  memory_id: string
  delete_permanently: boolean
}
