import { Request } from "express"

export interface IPagination {
  page: number
  limit: number
  paginate?: boolean
  search?: string // optional search string
  tags?: string | string[] // optional tags filter
  bookmarked?: boolean // filter for bookmarked memories
  deleted?: boolean // filter for deleted memories
}

export interface IRequest extends Request {
  auth?: {
    id: string
  }
}