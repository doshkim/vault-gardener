import type { ProviderName } from './types.js';
import { createClaudeProvider } from './claude.js';
import { createCodexProvider } from './codex.js';
import { createGeminiProvider } from './gemini.js';

export interface DetectResult {
  available: ProviderName[];
  recommended: ProviderName | null;
}

const PRIORITY: ProviderName[] = ['claude', 'codex', 'gemini'];

export async function detectProviders(): Promise<DetectResult> {
  const providers = [
    createClaudeProvider(),
    createCodexProvider(),
    createGeminiProvider(),
  ];

  const checks = await Promise.all(
    providers.map(async (p) => ({
      name: p.name,
      ok: await p.isAvailable(),
    })),
  );

  const available = checks
    .filter((c) => c.ok)
    .map((c) => c.name);

  const recommended = PRIORITY.find((name) => available.includes(name)) ?? null;

  return { available, recommended };
}
