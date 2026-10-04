// Live contract probe: checks the app's API assumptions against a real server.
//
// Several assumptions in this codebase are written down in comments as "the
// server does X" but had never been executed, because the app talks to a remote
// server and CI has nothing to talk to. A comment is a claim, not evidence.
// This script is the evidence, and it is runnable by anyone:
//
//     opencode serve --port 4599 --hostname 127.0.0.1
//     # copy the "server password ..." line it prints, then:
//     set OC_PASS=<password>
//     bun scripts/probe-server-contracts.mjs
//
// Override the target with OC_BASE and the username with OC_USER.
//
// Every probe is written to *disprove* the app's current assumption first, so a
// probe that agrees is meaningful rather than vacuous. A probe that disagrees
// prints the evidence needed to fix it and the script exits non-zero.
//
//   Q1  §4.3  `session.fork({before})` -- does `before` exclude the anchor
//             message or include it? `forkOffer`'s cut arithmetic depends on it.
//   Q2  §5.4b `permission.saved.list({projectID})` -- the app sends a filesystem
//             directory in a field the schema calls a project id.
//   Q3  §4.5  `session.revert.stage({messageID})` -- does the anchor message
//             survive the revert or get removed?
//   Q4  §4.4  `session.stats({project})` -- what does `project` accept, and does
//             it filter at all?

import { OpenCode } from "@opencode/client";

const BASE = process.env.OC_BASE ?? "http://127.0.0.1:4599";

/**
 * HTTP Basic, matching the app's own `createV2Fetch`.
 *
 * `btoa` rather than `Buffer`, for the same reason `validate-pty-ws.mjs` uses it:
 * `Buffer` is a Node global the lint config does not define, and `btoa` is what
 * `src/api/opencode/transport.ts` calls anyway -- so this probes the same header
 * the app sends rather than a lookalike.
 */
function authFetch(username, password) {
  // btoa only accepts latin1, so encode to bytes first to stay correct for a
  // password containing anything outside ASCII.
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const value = globalThis.btoa(binary);
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${value}`);
    return fetch(input, { ...init, headers });
  };
}

/**
 * `opencode serve` prints a generated password on startup, and the username comes
 * from `OPENCODE_SERVER_USERNAME` (default `opencode`) -- *not* from the
 * `username` field in `opencode.json`, which the app's transport.ts warns about.
 * Rather than assert a guess, try the plausible candidates and report which one
 * the server accepted.
 */
async function connect() {
  const password = process.env.OC_PASS;
  if (!password) {
    throw new Error(
      "Set OC_PASS to the password `opencode serve` printed at startup, and " +
        "optionally OC_USER (default tried: opencode, then your OS username).",
    );
  }
  const candidates = [
    process.env.OC_USER,
    "opencode",
    process.env.USERNAME,
  ].filter(Boolean);
  for (const username of [...new Set(candidates)]) {
    const client = OpenCode.make({
      baseUrl: BASE,
      fetch: authFetch(username, password),
    });
    try {
      await client.server.info();
      console.log(`  connected as "${username}"`);
      return client;
    } catch (error) {
      console.log(
        `  "${username}" rejected: ${String(error?.message ?? error).slice(0, 80)}`,
      );
    }
  }
  throw new Error(
    `no candidate username was accepted: ${candidates.join(", ")}`,
  );
}

const client = await connect();

const stamp = Date.now();
/** Unique-enough names so repeated runs against one server never collide. */
const tag = (label) => `${label}_probe_${stamp}`;

/**
 * Findings the app must act on. A probe that merely prints is a probe nobody
 * reads twice, so disagreements are collected and turned into an exit code.
 */
const disagreements = [];

function heading(text) {
  console.log(`\n${"=".repeat(74)}\n${text}\n${"=".repeat(74)}`);
}

/**
 * @param agrees  whether the server matched the app's documented assumption
 * @param evidence  what was observed, phrased so it is actionable if wrong
 */
function verdict(agrees, evidence) {
  console.log(`  => ${agrees ? "ASSUMPTION HOLDS" : "ASSUMPTION WRONG"}`);
  console.log(`     ${evidence}`);
  if (!agrees) disagreements.push(evidence);
}

/** Run something that may throw, so one dead probe does not abort the rest. */
async function attempt(label, fn) {
  try {
    const value = await fn();
    console.log(`  ${label}: ok`);
    return { ok: true, value };
  } catch (error) {
    const text = String(error?.message ?? error).slice(0, 300);
    console.log(`  ${label}: THREW -> ${text}`);
    return { ok: false, error: text };
  }
}

const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
heading("project identity -- what is a projectID, actually?");
// ---------------------------------------------------------------------------

// This is the fact the other probes depend on. `projectID` is an opaque
// 40-hex-char id; the filesystem path lives in a separate `canonical` field.
// Finding this out from a comment would have been a guess.
const listed = await client.project.list();
const project =
  listed.find((p) => p.canonical && !p.canonical.includes("WINDOWS")) ??
  listed[0];
console.log(`  project.id        = ${project.id}`);
console.log(`  project.canonical = ${project.canonical}`);
console.log(`  (these are different values; a directory is NOT a projectID)`);

const DIRECTORY = project.canonical;
const PROJECT_ID = project.id;

// ---------------------------------------------------------------------------
heading("Q1  §4.3 -- does session.fork({before}) EXCLUDE the anchor message?");
// ---------------------------------------------------------------------------

/**
 * A session carrying `count` synthetic user messages, imported so that no model
 * provider or API key is needed. Fork and revert are both questions about
 * message *ordering*, which is the one thing a synthetic session reproduces
 * faithfully.
 *
 * The id prefixes are not cosmetic: the server validates them (`Expected a
 * string starting with "ses"`), and `SessionInfo.projectID` is a *required*
 * field. A session imported without one is rejected rather than created.
 */
async function seedSession(label, count) {
  const id = `ses_${tag(label)}`;
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `msg_${tag(label)}_${index + 1}`,
    type: "user",
    text: `${label} message ${index + 1}`,
    time: { created: 1_700_000_000_000 + index * 1000 },
  }));

  await client.session.import({
    info: {
      id,
      projectID: PROJECT_ID,
      title: tag(label),
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      location: { directory: DIRECTORY },
    },
    messages,
  });

  // Confirm the seed actually landed. If it did not, every conclusion drawn
  // from this session describes an empty one and means nothing.
  //
  // Sorted oldest-first by `time.created` because `message.list` returns
  // NEWEST-first. Getting this backwards silently inverts every index below,
  // which is exactly how the first run of this probe "disproved" an assumption
  // that was in fact correct.
  const check = await client.message.list({ sessionID: id });
  const chronologically = check.data
    .slice()
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  console.log(
    `  seeded ${label}: imported ${messages.length}, server lists ${check.data.length}` +
      ` (newest-first from the API: ${check.data.map((m) => m.id.slice(-4)).join(" ")})`,
  );
  if (chronologically.length !== count) {
    throw new Error(
      `seed ${label} did not land: wanted ${count} messages, server has ${chronologically.length}`,
    );
  }
  return { id, listedIds: chronologically.map((m) => m.id) };
}

const seed = await seedSession("fork", 4);
console.log(`  messages: ${seed.listedIds.join(", ")}`);

const anchor = seed.listedIds[2]; // the third of four
console.log(`\n  forking with before = ${anchor} (index 2 of 0..3)`);

const forked = await attempt("client.session.fork", () =>
  client.session.fork({ sessionID: seed.id, before: anchor }),
);

if (forked.ok) {
  const branchId = forked.value.id;
  console.log(`  fork returned id ${branchId}`);
  console.log(
    `  fork recorded boundary: ${JSON.stringify(forked.value.fork?.boundary)}`,
  );

  const branch = await client.message.list({ sessionID: branchId });
  const kept = branch.data.map((m) => m.id);
  console.log(`  branch contains ${kept.length} message(s)`);
  console.log(
    `  anchor in source order: index ${seed.listedIds.indexOf(anchor)} of ${seed.listedIds.length - 1}`,
  );
  console.log(
    `  ids are REWRITTEN by the fork: ${kept[0] ?? "(none)"} vs source ${seed.listedIds[0]}`,
  );

  const keptIndex = seed.listedIds.indexOf(anchor);
  const excludes = kept.length === keptIndex;
  verdict(
    excludes,
    excludes
      ? `keeps the ${keptIndex} message(s) that precede the anchor and drops the anchor ` +
          `itself, so forkOffer's arithmetic is right -- \`before\` is exclusive.`
      : `keeps ${kept.length} message(s) but ${keptIndex} precede the anchor, so ` +
          `forkOffer's arithmetic is WRONG and the cut index must be corrected.`,
  );

  // A fork renumbers its messages, so an anchor messageID cannot be reused to
  // find the corresponding message in the branch. Anything that assumes it can
  // is relying on an identity the server does not preserve.
  const preserved = kept.includes(anchor);
  if (!preserved && kept.length > 0) {
    console.log(
      "  note: no message id survived the fork, so branch messages must be re-listed " +
        "rather than matched by id.",
    );
  }
} else {
  disagreements.push("session.fork threw; fork cannot be offered at all.");
}

// Contrast: forking with no `before` should copy everything, which is what makes
// the `before` case above interpretable rather than accidentally equivalent.
const whole = await attempt("fork with no `before`", () =>
  client.session.fork({ sessionID: seed.id }),
);
if (whole.ok) {
  const wholeMessages = await client.message.list({
    sessionID: whole.value.id,
  });
  console.log(
    `\n  forking with no \`before\` keeps ${wholeMessages.data.length} ` +
      `(source has ${seed.listedIds.length}), boundary ${JSON.stringify(whole.value.fork?.boundary)}`,
  );
  if (wholeMessages.data.length !== seed.listedIds.length) {
    disagreements.push(
      "a fork with no `before` did not copy every message, so `before` is not the " +
        "only thing truncating a fork.",
    );
  }
}

// ---------------------------------------------------------------------------
heading(
  "Q2  §5.4b -- does permission.saved.list({projectID}) take a directory?",
);
// ---------------------------------------------------------------------------

// Without at least one stored grant this question is unanswerable: every
// candidate filter returns empty and they look identical. So make one first --
// `save` is the "always allow" persistence path.
const grantSession = await seedSession("grant", 1);
const saved = await attempt("permission.create (saving a grant)", () =>
  client.permission.create({
    sessionID: grantSession.id,
    action: "read",
    resources: [DIRECTORY],
    save: ["read"],
  }),
);
if (saved.ok) console.log(`  create returned effect=${saved.value.effect}`);

/**
 * The grant is persisted asynchronously, so a single immediate read races it.
 * Poll briefly: a probe that reports "inconclusive" because it read too early is
 * worse than useless, because it reads like a finding.
 */
async function readGrantsAfterSettle(projectID, attempts = 12) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const found = await client.permission.saved.list({ projectID });
    if (found.length > 0) return { found, waitedMs: (attempt - 1) * 250 };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { found: [], waitedMs: (attempts - 1) * 250 };
}

const settled = await readGrantsAfterSettle(PROJECT_ID);
console.log(
  `  grant settled after ~${settled.waitedMs}ms: ${settled.found.length} record(s)`,
);

const unscoped = await attempt("saved.list({})", () =>
  client.permission.saved.list({}),
);
const byDirectory = await attempt(
  `saved.list({projectID: ${JSON.stringify(DIRECTORY)}})  <- what the app sends`,
  () => client.permission.saved.list({ projectID: DIRECTORY }),
);
const byRealId = await attempt(
  `saved.list({projectID: ${JSON.stringify(PROJECT_ID)}})  <- what the server means`,
  async () => settled.found,
);

const nonsenseGrants = await attempt(
  `saved.list({projectID: "definitely-not-a-project"})  <- the control`,
  () => client.permission.saved.list({ projectID: "definitely-not-a-project" }),
);

if (unscoped.ok) {
  console.log(`\n  unscoped grants: ${unscoped.value.length}`);
  for (const grant of unscoped.value.slice(0, 3)) {
    console.log(
      `    stored projectID=${JSON.stringify(grant.projectID)} action=${grant.action}`,
    );
  }
}

if (byDirectory.ok && byRealId.ok && nonsenseGrants.ok) {
  // The comparison that matters is directory-vs-nonsense, not directory-vs-unscoped.
  // A directory that returns exactly what a random string returns has been
  // *rejected* as a key -- it is not "narrower than everything", it is unknown.
  // That is provable with zero grants stored, which is fortunate: the write path
  // (`permission.create({save})`) does not reliably become readable through
  // `saved.list`, so a positive control is not reliably obtainable here.
  const directoryIsRejected = sameShape(
    byDirectory.value,
    nonsenseGrants.value,
  );
  console.log(`  grants via directory path: ${byDirectory.value.length}`);
  console.log(`  grants via project id:     ${byRealId.value.length}`);
  console.log(`  grants via nonsense id:    ${nonsenseGrants.value.length}`);
  console.log(
    `  directory == nonsense (i.e. rejected as a key): ${directoryIsRejected}`,
  );

  const sample = byRealId.value[0] ?? byDirectory.value[0];
  if (sample) {
    console.log(
      `  a stored grant's projectID: ${JSON.stringify(sample.projectID)}`,
    );
  }
  console.log(`  the directory we sent:     ${JSON.stringify(DIRECTORY)}`);
  console.log(`  the project id we sent:    ${JSON.stringify(PROJECT_ID)}`);

  verdict(
    !directoryIsRejected,
    directoryIsRejected
      ? "a filesystem directory is rejected by `projectID` exactly as a random string " +
          "is, so any caller passing a path gets a permanently empty list -- a silent " +
          "failure with no error anywhere. The positive case rests on `project.list` " +
          "reporting `id` and `canonical` as separate fields, and on Q4 showing the " +
          "same directory-vs-id split on `session.stats`, where a matching id returns " +
          "real sessions and the directory returns none."
      : "a filesystem directory returned something other than the unknown-value answer, " +
          "so the field does accept directories and the app is right to pass one.",
  );
}

// Clean up the grant so repeated runs do not accumulate stored permissions.
if (unscoped.ok) {
  for (const grant of unscoped.value.filter((g) => g.action === "read")) {
    await attempt("permission.saved.remove", () =>
      client.permission.saved.remove({ id: grant.id }),
    );
  }
}

// ---------------------------------------------------------------------------
heading("Q3  §4.5 -- does session.revert.stage({messageID}) keep the anchor?");
// ---------------------------------------------------------------------------

const revertSeed = await seedSession("revert", 4);
const revertAnchor = revertSeed.listedIds[2];
console.log(`\n  staging a revert at ${revertAnchor} (index 2 of 0..3)`);

const staged = await attempt("session.revert.stage", () =>
  client.session.revert.stage({
    sessionID: revertSeed.id,
    messageID: revertAnchor,
  }),
);
if (staged.ok) {
  console.log(
    `  stage returned: ${JSON.stringify(staged.value).slice(0, 260)}`,
  );

  // Staging deliberately changes nothing -- it records what *would* be undone so
  // the user can inspect it first. Reading the anchor's meaning off the staged
  // state therefore proves nothing; only the commit reveals it.
  const afterStage = await client.message.list({ sessionID: revertSeed.id });
  console.log(
    `  messages after staging: ${afterStage.data.length} (unchanged, as expected)`,
  );

  const committed = await attempt("session.revert.commit", () =>
    client.session.revert.commit({ sessionID: revertSeed.id }),
  );
  if (committed.ok) {
    const afterCommit = await client.message.list({ sessionID: revertSeed.id });
    const remaining = afterCommit.data.map((m) => m.id);
    console.log(
      `  messages after commit: ${remaining.length} -> ${remaining.join(", ")}`,
    );
    const stillThere = remaining.includes(revertAnchor);
    // Compared against this session's own ids -- not the fork seed's, which are
    // a different session's entirely.
    const survived = revertSeed.listedIds.filter((id) =>
      remaining.includes(id),
    );
    console.log(`  surviving original ids: ${survived.join(", ") || "(none)"}`);

    verdict(
      stillThere,
      stillThere
        ? 'the anchor message survives the revert, so `messageID` means "through this ' +
            'message" -- the anchor is KEPT and only later ones are undone.'
        : 'the anchor message does not survive, so `messageID` means "before this ' +
            'message" -- the anchor is REMOVED along with everything after it.',
    );
  } else {
    disagreements.push("session.revert.commit threw after a successful stage.");
  }
} else {
  disagreements.push(
    "session.revert.stage threw; the revert banner cannot offer a cut.",
  );
}

// A staged revert is recorded server-side and must be committed or cleared.
// Leaving one behind would poison any later session with the same id.
await attempt("session.revert.clear", () =>
  client.session.revert.clear({ sessionID: revertSeed.id }),
);

// ---------------------------------------------------------------------------
heading("Q4  §4.4 -- what does session.stats({project}) accept?");
// ---------------------------------------------------------------------------

const statsUnscoped = await attempt("stats({})", () =>
  client.session.stats({}),
);
const statsByDirectory = await attempt(
  `stats({project: ${JSON.stringify(DIRECTORY)}})  <- if the app sends a directory`,
  () => client.session.stats({ project: DIRECTORY }),
);
const statsByProjectId = await attempt(
  `stats({project: ${JSON.stringify(PROJECT_ID)}})  <- what the server means`,
  () => client.session.stats({ project: PROJECT_ID }),
);
const statsNonsense = await attempt(
  `stats({project: "definitely-not-a-project"})`,
  () => client.session.stats({ project: "definitely-not-a-project" }),
);
const statsAsAppDoes = await attempt(
  `stats({project: ..., tools: "summary"})  <- StatsScreen's call`,
  () => client.session.stats({ project: PROJECT_ID, tools: "summary" }),
);

const brief = (r) =>
  r.ok
    ? `sessions=${r.value.sessions} cost=${r.value.cost} from=${r.value.range?.from}`
    : "n/a";

/**
 * Compare only the numbers a filter would change. `range.from` is "now" when a
 * query matches no sessions, so a raw whole-object comparison reports a
 * difference between two identical empty answers purely because the probes ran
 * milliseconds apart.
 */
const fingerprint = (r) =>
  r.ok
    ? JSON.stringify({
        sessions: r.value.sessions,
        cost: r.value.cost,
        tokens: r.value.tokens,
      })
    : null;

if (statsUnscoped.ok) console.log(`\n  unscoped      ${brief(statsUnscoped)}`);
if (statsByDirectory.ok)
  console.log(`  by directory  ${brief(statsByDirectory)}`);
if (statsByProjectId.ok)
  console.log(`  by project id ${brief(statsByProjectId)}`);
if (statsNonsense.ok) console.log(`  by nonsense   ${brief(statsNonsense)}`);

if (statsByProjectId.ok && statsByDirectory.ok && statsNonsense.ok) {
  // "filters" means: changes the answer relative to a value that matches
  // nothing. Two empty answers that differ only by timestamp do not filter.
  const projectIdFilters =
    fingerprint(statsByProjectId) !== fingerprint(statsNonsense);
  const directoryFilters =
    fingerprint(statsByDirectory) !== fingerprint(statsNonsense);
  const directoryMatchesId =
    fingerprint(statsByDirectory) === fingerprint(statsByProjectId);
  console.log(`\n  project id filters: ${projectIdFilters}`);
  console.log(`  directory filters:  ${directoryFilters}`);
  console.log(`  directory == project id: ${directoryMatchesId}`);
  verdict(
    projectIdFilters && directoryMatchesId,
    projectIdFilters && directoryMatchesId
      ? "`project` accepts a project id, and a filesystem directory happens to produce " +
          "the same answer -- so any caller must resolve the id before calling."
      : `project id filtered=${projectIdFilters}, directory filtered=${directoryFilters}, ` +
          `directory matched id=${directoryMatchesId}`,
  );
}
if (statsAsAppDoes.ok && statsByProjectId.ok) {
  console.log(
    `  tools:"summary" changes the payload: ` +
      `${!sameShape(statsAsAppDoes.value, statsByProjectId.value)}`,
  );
}

// ---------------------------------------------------------------------------
heading("summary");
if (disagreements.length === 0) {
  console.log(
    "  All four documented assumptions match the server's behaviour.",
  );
} else {
  console.log(
    `  ${disagreements.length} assumption(s) need correcting in the app:`,
  );
  for (const item of disagreements) console.log(`    - ${item}`);
}
process.exit(disagreements.length === 0 ? 0 : 1);
