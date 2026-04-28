import { NotImplementedError } from "../errors";
import type { M365GraphClient } from "./types";

export const realM365GraphClient: M365GraphClient = {
  async listLicenses() {
    throw new NotImplementedError("m365graph", "listLicenses");
  },
  async listActivity() {
    throw new NotImplementedError("m365graph", "listActivity");
  },
};
