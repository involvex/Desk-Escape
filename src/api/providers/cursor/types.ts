export interface CursorAgent {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  env: { type: "cloud" };
  repos: { url: string; startingRef: string }[];
  branchName: string;
  autoGenerateBranch: boolean;
  autoCreatePR: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  latestRunId: string | null;
}

export interface CursorRun {
  id: string;
  agentId: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "FAILED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
}

export interface CursorCreateAgentRequest {
  prompt: { text: string; images?: string[] };
  model?: { id: string; params?: { id: string; value: string }[] };
  repos?: { url: string; startingRef?: string }[];
  autoCreatePR?: boolean;
  skipReview?: boolean;
  envVars?: Record<string, string>;
}

export interface CursorCreateRunRequest {
  prompt: { text: string; images?: string[] };
}

export interface CursorListResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export type CursorStreamEvent =
  | { type: "status"; payload: { runId: string; status: string } }
  | { type: "assistant"; payload: { text: string } }
  | { type: "thinking"; payload: { text: string } }
  | { type: "tool_call"; payload: Record<string, unknown> }
  | { type: "heartbeat" }
  | { type: "result"; payload: { runId: string; status: string } }
  | { type: "error"; payload: { code: string; message: string } };

export interface CursorModel {
  id: string;
  name: string;
}
