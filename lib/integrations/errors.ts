/**
 * Shared error types for the integration layer.
 *
 * Every `real.ts` implementation that hasn't been wired to its vendor API yet
 * must throw `NotImplementedError` rather than silently returning empty data —
 * this surfaces the missing wiring loudly in dev/staging and prevents F-feature
 * code from accidentally treating "no data" and "no integration" the same way.
 */

export class NotImplementedError extends Error {
  readonly client: string;
  readonly method: string;
  constructor(client: string, method: string) {
    super(
      `Integration '${client}' has no real implementation for '${method}' yet. ` +
        `Set INTEGRATION_${client.toUpperCase()}=synthetic in dev, or wire the ` +
        `real client per Dashboard_Scoping_v1.md §4.`,
    );
    this.name = "NotImplementedError";
    this.client = client;
    this.method = method;
  }
}

export class IntegrationError extends Error {
  readonly client: string;
  readonly cause?: unknown;
  constructor(client: string, message: string, cause?: unknown) {
    super(`[${client}] ${message}`);
    this.name = "IntegrationError";
    this.client = client;
    this.cause = cause;
  }
}
