import { ClientError } from "@opencode/client";

/**
 * Thrown when a request comes back as the OpenCode web UI instead of API JSON.
 *
 * V2 serves unknown paths with the SPA `index.html` at HTTP 200. That makes an
 * un-migrated V1 call (for example `GET /session`) look like a *successful*
 * response containing nonsense. Without this check the app would fail later and
 * far from the cause, so we detect it at the transport boundary and name the
 * offending route.
 */
export class V1RouteError extends Error {
  readonly route: string;

  constructor(route: string) {
    super(
      `OpenCode V1 route detected: ${route} returned the web UI instead of JSON. ` +
        `This app requires OpenCode 2.x and that route no longer exists.`,
    );
    this.name = "V1RouteError";
    this.route = route;
  }
}

export type OpenCodeErrorKind =
  | "unauthorized"
  | "not-found"
  | "invalid-request"
  | "conflict"
  | "busy"
  | "forbidden"
  | "unavailable"
  | "transport"
  | "unknown";

/** Normalized error the UI can branch on without importing SDK internals. */
export class OpenCodeError extends Error {
  readonly kind: OpenCodeErrorKind;
  readonly tag: string | undefined;
  readonly cause: unknown;

  constructor(
    message: unknown,
    options: { kind: OpenCodeErrorKind; tag?: string; cause?: unknown },
  ) {
    // Accept `unknown` and coerce, so no caller can ever construct an error whose
    // `.message` is an object. `super()` runs before any field assignment, so the
    // coercion has to happen inline rather than via a helper on `this`.
    super(typeof message === "string" ? message : JSON.stringify(message));
    this.name = "OpenCodeError";
    this.kind = options.kind;
    this.tag = options.tag;
    this.cause = options.cause;
  }

  /** True when the user most likely supplied the wrong password. */
  get isAuthFailure(): boolean {
    return this.kind === "unauthorized" || this.kind === "forbidden";
  }
}

function readTag(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const tag = (error as { _tag?: unknown })._tag;
  return typeof tag === "string" ? tag : undefined;
}

function readMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    // `Error.message` is typed `string`, but a thrown value can be any object and
    // a subclass may have assigned a non-string. React throws
    // "Objects are not valid as a React child" if such a value is rendered, so
    // narrow for real rather than trusting the declaration.
    const message: unknown = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    return undefined;
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return undefined;
}

const NOT_FOUND_TAGS = new Set([
  "AgentNotFoundError",
  "CommandNotFoundError",
  "FileNotFoundError",
  "FormNotFoundError",
  "IntegrationNotFoundError",
  "McpServerNotFoundError",
  "MessageNotFoundError",
  "PermissionNotFoundError",
  "ProjectNotFoundError",
  "ProviderNotFoundError",
  "PtyNotFoundError",
  "SessionNotFoundError",
  "ShellNotFoundError",
  "SkillNotFoundError",
]);

function classify(error: unknown): OpenCodeErrorKind {
  if (error instanceof V1RouteError) {
    return "unknown";
  }
  if (error instanceof ClientError) {
    return error.reason === "Transport" ? "transport" : "invalid-request";
  }

  const tag = readTag(error);
  if (tag === "UnauthorizedError") return "unauthorized";
  if (tag === "ForbiddenError") return "forbidden";
  if (tag === "ServiceUnavailableError") return "unavailable";
  if (tag === "ConflictError") return "conflict";
  if (tag === "SessionBusyError") return "busy";
  if (tag === "InvalidRequestError" || tag === "InvalidCursorError") {
    return "invalid-request";
  }
  if (tag && NOT_FOUND_TAGS.has(tag)) return "not-found";

  // Transport-level failures that never reached the typed layer.
  if (error instanceof TypeError) return "transport";
  return "unknown";
}

const DEFAULT_MESSAGES: Record<OpenCodeErrorKind, string> = {
  unauthorized:
    "OpenCode rejected the credentials. The username must match the server's " +
    'OPENCODE_SERVER_USERNAME (default "opencode") -- note this is not the ' +
    '"username" field in opencode.json, which is a different setting.',
  forbidden: "OpenCode refused the request.",
  "not-found": "The requested resource no longer exists.",
  "invalid-request": "OpenCode rejected the request as invalid.",
  conflict: "That action conflicts with the current server state.",
  busy: "The session is busy and cannot accept that yet.",
  unavailable: "The OpenCode server is unavailable.",
  transport: "Could not reach the OpenCode server.",
  unknown: "OpenCode returned an unexpected error.",
};

/**
 * Normalize anything thrown by the client into an {@link OpenCodeError}.
 *
 * The V2 client throws on failure: declared server errors arrive as
 * `{ _tag, message }` objects rehydrated onto `Error`, and transport problems
 * arrive as {@link ClientError}. `ClientError` deliberately exposes no numeric
 * status, so classification keys off `reason` and `_tag`.
 */
export function toOpenCodeError(error: unknown): OpenCodeError {
  if (error instanceof OpenCodeError) {
    return error;
  }
  if (error instanceof V1RouteError) {
    return new OpenCodeError(error.message, {
      kind: "unknown",
      tag: "V1RouteError",
      cause: error,
    });
  }

  const kind = classify(error);
  // An auth failure is the one case where the server's own message
  // ("Authentication required") is actively unhelpful: it says nothing about
  // which of username/password is wrong, which is the entire question. Prefer
  // the diagnostic message and keep the server's text as context.
  const message =
    kind === "unauthorized"
      ? `${DEFAULT_MESSAGES.unauthorized} (server said: ${
          readMessage(error) ?? "unauthorized"
        })`
      : (readMessage(error) ?? DEFAULT_MESSAGES[kind]);

  return new OpenCodeError(message, {
    kind,
    tag: readTag(error),
    cause: error,
  });
}

/** Run `fn`, rethrowing a normalized {@link OpenCodeError}. */
export async function withOpenCodeErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toOpenCodeError(error);
  }
}
