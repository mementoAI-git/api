
export interface ICreateMemoryPayload {
  title: string
  body: string
  tags: string[]
  status: string
  level: number
  attachments: string[]
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