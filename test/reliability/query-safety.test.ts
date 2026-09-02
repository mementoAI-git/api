import type {Request} from 'express';
import {describe, expect, it} from 'vitest';
import {filterGenerator, getPagination} from '../../src/utils/helpers';

function requestWithQuery(query: Request['query']): Request {
  return {query} as Request;
}

describe('query safety', () => {
  it('normalizes invalid pagination and caps oversized pages', () => {
    expect(
      getPagination(requestWithQuery({limit: 'not-a-number', page: '-5'})),
    ).toMatchObject({limit: 25, page: 1});
    expect(
      getPagination(requestWithQuery({limit: '100000', page: '2.9'})),
    ).toMatchObject({limit: 100, page: 2});
  });

  it('escapes user search text before constructing regular expressions', () => {
    const [filter] = filterGenerator({search: 'journal.*[2026]'}, [
      'title',
    ]) as Array<{$or: Array<{title: {$regex: RegExp}}>}>;
    const regex = filter.$or[0].title.$regex;

    expect(regex.test('journal.*[2026]')).toBe(true);
    expect(regex.test('journal anything 2')).toBe(false);
  });
});
