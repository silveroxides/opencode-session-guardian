/**
 * Canonical handoff schema definition and terminal shell escaping safeguards.
 */

export interface ValidationResult {
  valid: boolean;
  missingSections: string[];
  cleanText?: string;
}

const REQUIRED_SECTIONS = [
  { header: "## Objective", pattern: /^##\s+Objective\b/m },
  { header: "## Important Details", pattern: /^##\s+Important Details\b/m },
  { header: "## Work State", pattern: /^##\s+Work State\b/m },
  { header: "### Completed", pattern: /^###\s+Completed\b/m },
  { header: "### Active", pattern: /^###\s+Active\b/m },
  { header: "### Blocked", pattern: /^###\s+Blocked\b/m },
  { header: "## Next Move", pattern: /^##\s+Next Move\b/m },
  { header: "## Relevant Files", pattern: /^##\s+Relevant Files\b/m },
];

/**
 * Validates that the provided text satisfies the canonical 5-section handoff schema.
 */
export function validateHandoff(text: string): ValidationResult {
  if (!text || typeof text !== "string") {
    return { valid: false, missingSections: ["ALL (empty input)"] };
  }

  const missing: string[] = [];
  for (const { header, pattern } of REQUIRED_SECTIONS) {
    if (!pattern.test(text)) {
      missing.push(header);
    }
  }

  const objIdx = text.search(/^##\s+Objective\b/m);
  const rawClean = objIdx >= 0 ? text.slice(objIdx).trim() : text.trim();

  return {
    valid: missing.length === 0,
    missingSections: missing,
    cleanText: missing.length === 0 ? rawClean : undefined,
  };
}

/**
 * Builds a deterministic fallback handoff when auto-compaction triggers without manual prep.
 */
export function buildFallbackHandoff(options: {
  worktree?: string;
  gitBranch?: string;
  gitCommit?: string;
  gitStatus?: string;
  shellName?: string;
}): string {
  const branch = options.gitBranch || "main";
  const commit = options.gitCommit || "unknown";
  const dirty = options.gitStatus ? options.gitStatus.trim() : "(clean working tree)";
  const shellRules = getTerminalEscapingReminder(options.shellName);

  return `## Objective
Preserve session context and deterministic functional rigidity across auto-compaction.

## Important Details
- **Architecture & Source Authorities**:
  - Keep upstream preset source authorities synchronized with downstream skills.
  - Formatter and test verification required prior to code commitments.
- **Tooling & Terminal Execution**:
${shellRules.split("\n").map((l) => `  ${l}`).join("\n")}

## Work State
### Completed
- Active branch: ${branch} (HEAD: ${commit}).
- Working tree status:
  ${dirty.split("\n").join("\n  ")}
### Active
- Auto-compaction recovery point.
### Blocked
- None.

## Next Move
1. Verify working tree status remains unchanged.
2. Resume active task or await user instructions under retained contracts.

## Relevant Files
- Workspace root: ${options.worktree || process.cwd()}`;
}

/**
 * Generates terminal shell escaping reminders based on active shell environment.
 */
export function getTerminalEscapingReminder(shellName?: string): string {
  const isWindows = process.platform === "win32";
  const shell = (shellName || process.env.SHELL || "").toLowerCase();
  const isPowerShell =
    shell.includes("pwsh") || shell.includes("powershell") || (isWindows && !shell.includes("bash"));

  if (isPowerShell) {
    return `[TERMINAL SHELL SAFEGUARD: POWERSHELL / PWSH]
- Quote literals: Use single quotes ('...') by default. Double an embedded apostrophe ('').
- Banned escaping: NEVER use C-style backslash escaping (\\") in PowerShell native command arguments.
- PowerShell Cmdlets: Always use -LiteralPath for path arguments to preserve literal symbols.
- Ripgrep: Pass -- before positional patterns and scope to explicit target directories.
- Error protocol: A parser error, escaping error, or SyntaxError is NEVER evidence that a record or file is absent. Fix quoting syntax instead of drawing false conclusions.`;
  }

  return `[TERMINAL SHELL SAFEGUARD: BASH]
- Quote literals: Use POSIX single quotes ('...') for exact string and regex literals.
- Arguments: Quote all variable expansions and paths containing spaces or special characters.
- Error protocol: Syntax or escape errors must be corrected in the invocation; never treat an execution failure as missing data.`;
}

/**
 * Constructs the canonical prep prompt instructing the agent to generate a lossless handoff.
 */
export function buildAutoPrepPrompt(shellName?: string): string {
  const safeguard = getTerminalEscapingReminder(shellName);
  return `Compaction requested, but no canonical 5-section handoff was prepped in recent turns.

Generate and output a canonical compaction handoff covering:
1. Active workspace/git status (HEAD commit hash, dirty tracked/untracked files).
2. Upstream and downstream dependencies and synchronization state.
3. Locked domain rules, negative constraints, and communication contracts.
4. Active tasks (or explicitly state none in progress).

Output MUST strictly follow this exact 5-section schema:
## Objective
[High-level mission and synchronization anchors]

## Important Details
[Durable rules, contracts, and operating parameters]

## Work State
### Completed
[Finished scope checkpoints with commit hashes]
### Active
[Active task or explicitly "None"]
### Blocked
[Blockers or explicitly "None"]

## Next Move
[Exact verification or task directives upon resumption]

## Relevant Files
[Absolute or repo-relative paths with exact roles]

${safeguard}

Generate the handoff now, then invoke the prep_session_compaction tool with the handoff text to stage and seal it deterministically.`;
}
