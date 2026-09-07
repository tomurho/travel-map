import { createHash } from "node:crypto";

export type PipelineErrorCode =
  | "PREVIEW_REQUIRED"
  | "PREVIEW_STALE"
  | "VERIFICATION_CONFLICT"
  | "VALIDATION_FAILED"
  | "WRITE_OUTCOME_UNKNOWN";

export class PipelineError extends Error {
  constructor(
    public readonly code: PipelineErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  get status() {
    if (this.code === "PREVIEW_REQUIRED") return 400;
    if (this.code === "VALIDATION_FAILED") return 422;
    if (this.code === "WRITE_OUTCOME_UNKNOWN") return 502;
    return 409;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function buildPreviewHash(input: {
  operation: "publish" | "sync";
  sheetId: string;
  publishedValues: string[][];
  reviewValues?: string[][];
  fileHash?: string;
  allowPartial?: boolean;
}) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue({ version: 1, ...input })))
    .digest("hex");
}

export function requirePreviewHash(hash: string | undefined) {
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new PipelineError("PREVIEW_REQUIRED", "Preview these changes before applying them.");
  }
}

export function assertPreviewMatches(expected: string | undefined, actual: string) {
  requirePreviewHash(expected);
  if (expected !== actual) {
    throw new PipelineError("PREVIEW_STALE", "The data changed since this preview. Preview again before applying.");
  }
}

export type FieldChange = { field: string; before: unknown; after: unknown };

export function describeFieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((field) => JSON.stringify(stableValue(before[field])) !== JSON.stringify(stableValue(after[field])))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}
