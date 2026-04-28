import { NotImplementedError } from "../errors";
import type { AnthropicClient } from "./types";

export const realAnthropicClient: AnthropicClient = {
  async listSeats() {
    throw new NotImplementedError("anthropic", "listSeats");
  },
};
