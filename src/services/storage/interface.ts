export interface IKeys {
  private_key: string
  public_key: string
}

export interface ISavePayload {
  title: string
  content: string
  files: string[],
  urls?: string[]
  tags: string[]
}