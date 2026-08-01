import type {
  CursorAgent,
  CursorCreateAgentRequest,
  CursorCreateRunRequest,
  CursorListResponse,
  CursorModel,
  CursorRun,
} from "./types";

const BASE_URL = "https://api.cursor.com";

export class CursorApiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get authHeader(): string {
    return "Basic " + btoa(`${this.apiKey}:`);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Cursor API error ${response.status}: ${errorBody}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async listAgents(cursor?: string): Promise<CursorListResponse<CursorAgent>> {
    const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request("GET", `/v1/agents${params}`);
  }

  async getAgent(id: string): Promise<CursorAgent> {
    return this.request("GET", `/v1/agents/${id}`);
  }

  async createAgent(
    request: CursorCreateAgentRequest,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    return this.request("POST", "/v1/agents", request);
  }

  async archiveAgent(id: string): Promise<void> {
    await this.request("POST", `/v1/agents/${id}/archive`);
  }

  async unarchiveAgent(id: string): Promise<void> {
    await this.request("POST", `/v1/agents/${id}/unarchive`);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.request("DELETE", `/v1/agents/${id}`);
  }

  async listRuns(
    agentId: string,
    limit?: number,
  ): Promise<CursorListResponse<CursorRun>> {
    const params: string[] = [];
    if (limit) {
      params.push(`limit=${limit}`);
    }
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return this.request("GET", `/v1/agents/${agentId}/runs${query}`);
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    return this.request("GET", `/v1/agents/${agentId}/runs/${runId}`);
  }

  async createRun(
    agentId: string,
    request: CursorCreateRunRequest,
  ): Promise<{ run: CursorRun }> {
    return this.request("POST", `/v1/agents/${agentId}/runs`, request);
  }

  async cancelRun(agentId: string, runId: string): Promise<void> {
    await this.request("POST", `/v1/agents/${agentId}/runs/${runId}/cancel`);
  }

  async streamRun(
    agentId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${BASE_URL}/v1/agents/${agentId}/runs/${runId}/stream`;
    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Cursor stream error ${response.status}`);
    }

    return response.body as ReadableStream<Uint8Array>;
  }

  async listModels(): Promise<CursorListResponse<CursorModel>> {
    return this.request("GET", "/v1/models");
  }

  async getMe(): Promise<{
    apiKeyName: string;
    userEmail: string;
    createdAt: string;
  }> {
    return this.request("GET", "/v1/me");
  }

  async testConnection(): Promise<{ healthy: boolean; email?: string }> {
    const me = await this.getMe();
    return { healthy: true, email: me.userEmail };
  }
}
