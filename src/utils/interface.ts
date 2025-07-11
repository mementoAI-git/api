import { Request } from "express"

export interface IPagination {
  page: number
  limit: number
  paginate?: boolean
  search?: string // optional search string
  tags?: string | string[] // optional tags filter
}

export interface IRequest extends Request {
  auth?: {
    id: string
  }
}