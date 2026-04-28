/**
 * Real OpenAIClient — calls the OpenAI admin API for ChatGPT + Codex seat
 * state. NOT YET IMPLEMENTED — Phase 0 onboarding artefact.
 * Refs: scoping §4 integration #5.
 */

import { NotImplementedError } from "../errors";
import type { OpenAIClient } from "./types";

export const realOpenAIClient: OpenAIClient = {
  async listChatGptSeats() {
    throw new NotImplementedError("openai", "listChatGptSeats");
  },
  async listCodexSeats() {
    throw new NotImplementedError("openai", "listCodexSeats");
  },
};
