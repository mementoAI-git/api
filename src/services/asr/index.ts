import {
  ASR_FALLBACK_PROVIDER,
  ASR_GEMINI_FALLBACK_MODEL,
  ASR_GEMINI_PRIMARY_MODEL,
  ASR_PROVIDER,
  ASR_SHADOW_ENABLED,
  ASR_SHADOW_PROVIDER,
} from '../../utils/config';
import {GeminiAsrProvider} from './gemini-provider';
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
      throw primaryError;
    }
    const fallbackResult = await fallback.transcribe(input);
    return {
      ...fallbackResult,
      usedFallback: true,
    } as AsrRouterResult;
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
