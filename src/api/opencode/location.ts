/**
 * Location scoping for the OpenCode V2 API.
 *
 * V1 threaded a flat `?directory=<path>` query parameter through nearly every
 * call. V2 replaces it with a `location` object that serializes to the
 * deepObject query parameter `?location[directory]=<path>`, and it is passed
 * **per call** rather than being baked into the client.
 *
 * Session endpoints are the exception: `session.get`, `session.prompt`,
 * `message.list` and friends take no location at all. A session's scope is fixed
 * when it is created (`SessionCreateInput.location`) and only changes via
 * `session.move`. Passing a location to those endpoints is not merely ignored,
 * it is a schema error.
 */
export interface LocationScope {
  location?: { directory?: string };
}

/** Build the `location` scope for a call, omitting it when there is no directory. */
export function withLocation(directory?: string | null): LocationScope {
  if (!directory) {
    return {};
  }
  return { location: { directory } };
}

/** Normalize a base URL: absolute, no trailing slash. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
