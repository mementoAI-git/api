import {
  ASR_FALLBACK_PROVIDER,
  ASR_GEMINI_FALLBACK_MODEL,
  ASR_GEMINI_PRIMARY_MODEL,
  ASR_PROVIDER,
  ASR_SHADOW_ENABLED,
  ASR_SHADOW_PROVIDER,
} from '../../utils/config';
import {GeminiAsrProvider} from './gemini-provider';
import {GroqAsrProvider} from './groq-provider';
import {ServiceUnavailableException} from '../../utils/service-error';
import {
  AsrProvider,
  AsrRouterResult,
  AsrShadowResult,
  AsrTranscriptionInput,
} from './types';

export const groq = new GroqAsrProvider();

const providerRegistry: Record<string, AsrProvider> = {
  gemini: new GeminiAsrProvider('gemini', ASR_GEMINI_PRIMARY_MODEL),
  gemini_fallback: new GeminiAsrProvider(
    'gemini_fallback',
    ASR_GEMINI_FALLBACK_MODEL,
  ),
  groq,
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
  // Groq comes last so transcription survives Gemini running out of quota altogether.
  const fallbacks = [
    providerRegistry[ASR_FALLBACK_PROVIDER],
    groq.isConfigured() ? groq : undefined,
  ].filter(
    (provider, index, all): provider is AsrProvider =>
      Boolean(provider) &&
      provider?.providerId !== primary.providerId &&
      all.indexOf(provider) === index,
  );

  let lastError: unknown;
  for (const provider of [primary, ...fallbacks]) {
    try {
      const result = await provider.transcribe(input);
      return {
        ...result,
        usedFallback: provider !== primary,
      } as AsrRouterResult;
    } catch (error) {
      lastError = error;
    }
  }
  throw transcriptionUnavailable(lastError);
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
