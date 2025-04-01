import { Request } from "express"

export interface IPagination {
  page: number
  limit: number
  paginate?: boolean
}

export interface IRequest extends Request {
  auth?: {
    id: string
  }
}