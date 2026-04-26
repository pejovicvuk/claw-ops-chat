import { scrubString } from "../audit/scrub";

/**
 * Process command-line scrubbing. Reuses the audit scrubber's regex set
 * and adds shell-flag-style secret patterns common in `ps` output:
 *   --token=abc, --password=foo, -p somepass, etc.
 */

const FLAG_SECRET_RE =
  /(--?(?:token|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)[=\s])(\S+)/gi;

const ENV_SECRET_RE =
  /\b(TOKEN|PASSWORD|PASSWD|SECRET|API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|SESSION[_-]?SECRET|CLIENT[_-]?SECRET)=(\S+)/gi;

const REDACTED = "<redacted>";

export function scrubCmdline(cmd: string | undefined | null): string {
  if (!cmd) return "";
  let out = cmd;
  out = out.replace(FLAG_SECRET_RE, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(ENV_SECRET_RE, (_m, key) => `${key}=${REDACTED}`);
  // Pass through the audit-side scrubber (Bearer, sk-ant, ghp_ etc + truncation).
  return scrubString(out);
}

export function scrubProcessName(name: string | undefined | null): string {
  if (!name) return "";
  // Process names are short — just clamp.
  return name.length > 64 ? `${name.slice(0, 63)}…` : name;
}
