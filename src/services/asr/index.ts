import {
  ASR_FALLBACK_PROVIDER,
  ASR_GEMINI_FALLBACK_MODEL,
  ASR_GEMINI_PRIMARY_MODEL,
  ASR_PROVIDER,
  ASR_SHADOW_ENABLED,
  ASR_SHADOW_PROVIDER,
} from '../../utils/config';
import {GeminiAsrProvider} from './gemini-provider';
import {ServiceUnavailableException} from '../../utils/service-error';
import {
  AsrProvider,
  AsrRouterResult,
  AsrShadowResult,
  AsrTranscriptionInput,
} from './types';

const providerRegistry: Record<string, AsrProvider> = {
  gemini: new GeminiAsrProvider('gemini', ASR_GEMINI_PRIMARY_MODEL),
  gemini_fallback: new GeminiAsrProvider(
    'gemini_fallback',
    ASR_GEMINI_FALLBACK_MODEL,
  ),
};

function resolveProvider() {
  const provider = providerRegistry[ASR_PROVIDER];
  if (!provider) {
    throw new Error(`ASR provider "${ASR_PROVIDER}" is not implemented.`);
  }
  return provider;
}

function transcriptionUnavailable(error: unknown) {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status
      : undefined;
  return new ServiceUnavailableException(
    status === 429
      ? 'Transcription is temporarily busy. Please try again later.'
      : 'Transcription is temporarily unavailable. Please try again later.',
  );
}

export async function transcribeWithConfiguredAsr(
  input: AsrTranscriptionInput,
) {
  const primary = resolveProvider();
  const fallback = providerRegistry[ASR_FALLBACK_PROVIDER];

  try {
    const primaryResult = await primary.transcribe(input);
    return {
      ...primaryResult,
      usedFallback: false,
    } as AsrRouterResult;
  } catch (primaryError) {
    if (!fallback || fallback.providerId === primary.providerId) {
      throw transcriptionUnavailable(primaryError);
    }
    try {
      const fallbackResult = await fallback.transcribe(input);
      return {
        ...fallbackResult,
        usedFallback: true,
      } as AsrRouterResult;
    } catch (fallbackError) {
      throw transcriptionUnavailable(fallbackError);
    }
  }
}

export function shouldRunAsrShadow() {
  return ASR_SHADOW_ENABLED && Boolean(ASR_SHADOW_PROVIDER);
}

export async function transcribeWithShadowProvider(
  input: AsrTranscriptionInput,
): Promise<AsrShadowResult | null> {
  if (!shouldRunAsrShadow()) return null;
  const shadowProvider = providerRegistry[ASR_SHADOW_PROVIDER];
  if (!shadowProvider) return null;
  const start = Date.now();
  const result = await shadowProvider.transcribe(input);
  return {
    ...result,
    durationMs: Date.now() - start,
  };
}
