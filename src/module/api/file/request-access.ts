import type {Request} from 'express';
import type {FileVariant} from '../../../services/storage/file-capability';

export type FileCapabilityQuery = {
  fid: string;
  exp: number;
  kid: string;
  sig: string;
  variant: FileVariant;
};

export function parseFileCapabilityQuery(
  query: Request['query'],
): FileCapabilityQuery | null | false {
  const names = ['fid', 'exp', 'kid', 'sig', 'variant'] as const;
  const hasAnyCapabilityField = names.some(name => query[name] !== undefined);
  if (!hasAnyCapabilityField) return null;

  if (names.some(name => typeof query[name] !== 'string')) return false;
  if (query.variant !== 'original' && query.variant !== 'thumbnail') {
    return false;
  }

  const exp = Number(query.exp);
  if (!Number.isSafeInteger(exp)) return false;

  return {
    fid: query.fid as string,
    exp,
    kid: query.kid as string,
    sig: query.sig as string,
    variant: query.variant,
  };
}
