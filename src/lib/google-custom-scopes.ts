/**
 * OAuth scopes to request during the device flow. Chosen to cover every tool
 * in workspace-mcp's "complete" tier (gmail, drive, calendar, docs, sheets,
 * slides, forms, tasks, contacts) while leaning on Google's scope hierarchy —
 * e.g. gmail.modify implies gmail.readonly / gmail.send / gmail.compose /
 * gmail.labels. See workspace-mcp's auth/scopes.py for the canonical set.
 *
 * Copied from workspace-mcp's constants so the consent screen asks for
 * exactly the permissions its tools will use. Requesting a narrower set
 * would cause tool calls to fail with insufficient scope; requesting a
 * wider set would show the user scopes we never exercise.
 *
 * Out of scope for now: chat.messages / chat.spaces (Google Chat),
 * script.projects (Apps Script), and cse (Programmable Search). Those
 * services are rarely used by an individual user and need additional
 * setup outside this app — easy to add later if requested.
 */
export const GOOGLE_DEVICE_FLOW_SCOPES = [
  // Identity — needed to fetch userinfo and key the credential file by email.
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",

  // Gmail (gmail.modify covers readonly/send/compose/labels).
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",

  // Drive (drive covers drive.readonly/drive.file).
  "https://www.googleapis.com/auth/drive",

  // Calendar (calendar covers calendar.readonly/calendar.events).
  "https://www.googleapis.com/auth/calendar",

  // Docs + Sheets (the write scopes cover their readonly counterparts).
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",

  // Slides (presentations covers presentations.readonly).
  "https://www.googleapis.com/auth/presentations",

  // Forms — split: forms.body for create/edit, responses.readonly to read submissions.
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",

  // Tasks (tasks covers tasks.readonly).
  "https://www.googleapis.com/auth/tasks",

  // Contacts (contacts covers contacts.readonly).
  "https://www.googleapis.com/auth/contacts",
];

/** Space-separated scope list (Google's `scope` parameter format). */
export const GOOGLE_DEVICE_FLOW_SCOPE_STRING = GOOGLE_DEVICE_FLOW_SCOPES.join(" ");
