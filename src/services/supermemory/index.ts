import Supermemory from 'supermemory';
import {
  IS_PRODUCTION,
  MEMORY_RETRIEVAL,
  SUPERMEMORY_API_KEY,
} from '../../utils/config';
import logger from '../../utils/logger';

export function getContainerTag(userId: string): string {
  const id = String(userId);
  return IS_PRODUCTION ? id : `test_${id}`;
}

export interface SupermemoryContext {
  static: string[];
  dynamic: string[];
  result: string;
  formatedText: string;
}

let client: Supermemory | null = null;

function getClient(): Supermemory | null {
  if (!SUPERMEMORY_API_KEY) {
    return null;
  }
  if (!client) {
    try {
      client = new Supermemory({apiKey: SUPERMEMORY_API_KEY});
    } catch (err) {
      logger.warn({err}, 'Supermemory client init failed');
      return null;
    }
  }
  return client;
}

export async function getContextForUser(
  userId: string,
  userMessage: string,
): Promise<SupermemoryContext> {
  const empty = {
    static: [] as string[],
    dynamic: [] as string[],
    result: '',
    formatedText: '',
  };

  const c = getClient();
  if (!c) {
    return {...empty};
  }

  const containerTag = getContainerTag(userId);

  try {
    const apiResult = await c.profile({
      containerTag,
      q: userMessage,
    });

    const staticFacts = Array.isArray(apiResult.profile?.static)
      ? apiResult.profile.static
      : [];
    const dynamicContext = Array.isArray(apiResult.profile?.dynamic)
      ? apiResult.profile.dynamic
      : [];
    const results = apiResult.searchResults?.results ?? [];
    const resultText = Array.isArray(results)
      ? results
          .map(
            (r: {memory?: string; chunk?: string}) =>
              r?.memory ?? r?.chunk ?? '',
          )
          .filter(Boolean)
          .join('\n')
      : '';

    const parts: string[] = [];
    if (staticFacts.length) {
      parts.push('Static facts:\n' + staticFacts.map(s => `- ${s}`).join('\n'));
    }
    if (dynamicContext.length) {
      parts.push(
        'Recent context:\n' + dynamicContext.map(s => `- ${s}`).join('\n'),
      );
    }
    if (resultText.trim()) {
      parts.push('Relevant memories:\n' + resultText.trim());
    }
    const formatedText =
      parts.length === 0
        ? ''
        : '\n\nLONG-TERM USER CONTEXT:\n' + parts.join('\n\n');

    const result: SupermemoryContext = {
      static: staticFacts,
      dynamic: dynamicContext,
      result: resultText,
      formatedText,
    };

    return result;
  } catch (err) {
    logger.warn({err, userId: containerTag}, 'Supermemory profile failed');
    return {...empty};
  }
}

/**
 * Store host-approved insight text in Supermemory, only while Supermemory is
 * the retrieval store (MEMORY_RETRIEVAL=supermemory). Otherwise nothing is
 * sent: the host's words stay on our own servers, and an outside service
 * being down never blocks approving an insight. No-op for empty content.
 * Throws on API failure when used (caller can avoid deleting pending rows).
 */
export async function addApprovedMemory(
  userId: string,
  content: string,
): Promise<void> {
  if (MEMORY_RETRIEVAL !== 'supermemory') return;
  const c = getClient();
  if (!c) {
    return;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  const containerTag = getContainerTag(userId);

  try {
    await c.add({content: trimmed, containerTag});
  } catch (err) {
    logger.warn(
      {err, userId: containerTag},
      'Supermemory add approved memory failed',
    );
    throw err;
  }
}

/** Permanently remove every document stored for an account container. */
export async function deleteUserContainer(userId: string): Promise<void> {
  const c = getClient();
  if (!c) return;

  await c.documents.deleteBulk({containerTags: [getContainerTag(userId)]});
}
