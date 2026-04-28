/**
 * Real CursorClient — calls the Cursor admin API.
 *
 * NOT YET IMPLEMENTED. Requires an admin token allocated from the §4.6.1
 * reserve (scoping §8 N5). Refs: scoping §4 integration #4.
 */

import { NotImplementedError } from "../errors";
import type { CursorClient } from "./types";

export const realCursorClient: CursorClient = {
  async listSeats() {
    throw new NotImplementedError("cursor", "listSeats");
  },
  async listWaitlist() {
    throw new NotImplementedError("cursor", "listWaitlist");
  },
};
