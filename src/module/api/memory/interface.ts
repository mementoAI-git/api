
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
    is_voice?: boolean
  }[]
  memory_id: string
}