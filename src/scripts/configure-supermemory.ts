/**
 * One-time (or per-environment) script to configure Supermemory settings.
 * Run: npx ts-node src/scripts/configure-supermemory.ts
 * Requires SUPERMEMORY_API_KEY in .env.
 */
import { SUPERMEMORY_API_KEY } from "../utils/config";
import logger from "../utils/logger";

const SETTINGS_URL = "https://api.supermemory.ai/v3/settings";

const FILTER_PROMPT = `Memento is a personal reflection and memory app. Users have an AI companion to explore memories, thoughts, and dreams; write and reflect on stories; and create time capsules for loved ones. The long-term goal is to build a digital clone of each user so others can interact with it.

containerTag identifies one user's memory space. In production it is the Memento user ID. In test environments it is prefixed with "test_" (e.g. test_<userId>). We store the user's conversations with the AI and automatically extracted facts about the user. Only include or surface content that belongs to the user identified by containerTag. Do not mix data across different containerTags.`;

async function configureSupermemory(): Promise<void> {
  if (!SUPERMEMORY_API_KEY) {
    logger.warn("SUPERMEMORY_API_KEY is not set. Skipping Supermemory settings configuration.");
    process.exit(0);
  }

  try {
    const res = await fetch(SETTINGS_URL, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-supermemory-api-key": SUPERMEMORY_API_KEY,
      },
      body: JSON.stringify({
        shouldLLMFilter: true,
        filterPrompt: FILTER_PROMPT,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supermemory settings PATCH failed: ${res.status} ${body}`);
    }

    logger.info("Supermemory settings configured successfully.");
  } catch (error) {
    logger.error({ error }, "Failed to configure Supermemory settings");
    process.exit(1);
  }
}

configureSupermemory();
