import {Request} from 'express';
import type {RequestContext} from '../contracts/response';
import type {SessionClaims} from '../contracts/session';

export interface IPagination {
  answered?: string;
  page: number;
  limit: number;
  paginate?: boolean;
  search?: string; // optional search string
  tags?: string | string[]; // optional tags filter
  bookmarked?: boolean; // filter for bookmarked memories
  deleted?: boolean; // filter for deleted memories
}

export interface IRequest extends Request {
  context?: RequestContext;
  auth?: SessionClaims | null;
}
