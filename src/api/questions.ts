export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface PendingQuestion {
  id: string;
  sessionId: string;
  questions: QuestionItem[];
  receivedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseQuestionItem(raw: unknown): QuestionItem | null {
  const item = asRecord(raw);
  if (!item) return null;
  const optionsRaw = Array.isArray(item.options) ? item.options : [];
  const options: QuestionOption[] = optionsRaw
    .map((opt) => {
      const record = asRecord(opt);
      if (!record) return null;
      return {
        label: String(record.label ?? record.value ?? ""),
        description: String(record.description ?? ""),
      };
    })
    .filter((opt): opt is QuestionOption => Boolean(opt && opt.label));

  return {
    question: String(item.question ?? item.text ?? ""),
    header: String(item.header ?? item.title ?? "Question"),
    options,
    multiple: Boolean(item.multiple),
    custom: item.custom !== false,
  };
}

export function isQuestionEvent(event: {
  type: string;
  properties?: Record<string, unknown>;
}): boolean {
  return (
    event.type === "question.asked" ||
    event.type === "question.replied" ||
    event.type === "question.rejected"
  );
}

export function parseQuestionEvent(event: {
  type: string;
  properties?: Record<string, unknown>;
}): PendingQuestion | null {
  if (event.type !== "question.asked" || !event.properties) {
    return null;
  }

  const props = event.properties;
  const id = String(props.id ?? props.requestID ?? props.requestId ?? "");
  const sessionId = String(
    props.sessionID ?? props.sessionId ?? props.session_id ?? "",
  );
  if (!id || !sessionId) {
    return null;
  }

  const questionsRaw = Array.isArray(props.questions) ? props.questions : [];
  const questions = questionsRaw
    .map(parseQuestionItem)
    .filter((q): q is QuestionItem => Boolean(q));

  if (questions.length === 0) {
    return null;
  }

  return {
    id,
    sessionId,
    questions,
    receivedAt: new Date().toISOString(),
  };
}

export function isQuestionResolvedEvent(event: {
  type: string;
  properties?: Record<string, unknown>;
}): { id: string } | null {
  if (event.type !== "question.replied" && event.type !== "question.rejected") {
    return null;
  }
  const id = String(
    event.properties?.id ??
      event.properties?.requestID ??
      event.properties?.requestId ??
      "",
  );
  return id ? { id } : null;
}

async function questionFetch(
  baseUrl: string,
  authHeader: string | null,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  return fetch(url, { ...init, headers });
}

export async function listPendingQuestions(
  baseUrl: string,
  authHeader: string | null,
  directory?: string | null,
): Promise<PendingQuestion[]> {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : "";
  try {
    const response = await questionFetch(
      baseUrl,
      authHeader,
      `/question${query}`,
    );
    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((item) => {
        const record = asRecord(item);
        if (!record) return null;
        return parseQuestionEvent({
          type: "question.asked",
          properties: record,
        });
      })
      .filter((item): item is PendingQuestion => Boolean(item));
  } catch {
    return [];
  }
}

export async function replyToQuestion(
  baseUrl: string,
  authHeader: string | null,
  requestId: string,
  answers: string[][],
  directory?: string | null,
): Promise<void> {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : "";
  const response = await questionFetch(
    baseUrl,
    authHeader,
    `/question/${encodeURIComponent(requestId)}/reply${query}`,
    {
      method: "POST",
      body: JSON.stringify({ answers }),
    },
  );
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Failed to reply to question (${response.status}).`);
  }
}

export async function rejectQuestion(
  baseUrl: string,
  authHeader: string | null,
  requestId: string,
  directory?: string | null,
): Promise<void> {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : "";
  const response = await questionFetch(
    baseUrl,
    authHeader,
    `/question/${encodeURIComponent(requestId)}/reject${query}`,
    { method: "POST" },
  );
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Failed to reject question (${response.status}).`);
  }
}
