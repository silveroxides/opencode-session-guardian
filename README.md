# OpenCode Session Guardian

Deterministic, lossless context compaction and session integrity guardian for [OpenCode](https://opencode.ai) (supporting both V1 and V2).

## Compaction Control & Architecture

Native OpenCode compaction delegates history to a secondary summarization subagent. In default execution, domain constraints, negative contracts, tags, working copy state, and verified handoffs can be omitted or altered.

`opencode-session-guardian` enforces deterministic context compaction:
- **OpenCode V1**: Intercepts `/compact` execution, validates the canonical 5-section handoff schema, halts compaction if unverified, and writes directly to `opencode.db` via SQLite.
- **OpenCode V2**: Hooks `ctx.session.hook("compaction")` to assign the verified handoff directly to `event.result`, bypassing the summarization model request.

---

## Capabilities

- **Dual-Mode Compatibility**: Supports OpenCode V1 function exports and V2 `Plugin.define` objects with `setup(ctx)`.
- **Canonical 5-Section Schema**: Enforces structured handoff headers across compaction boundaries.
- **Zero-Token V2 Bypass**: Skips summarization inference when a staged handoff is present.
- **SQLite Engine**: Updates `part.data` using native WAL-enabled SQLite adapters (`bun:sqlite` or `node:sqlite`).
- **Terminal Shell Safeguards**: Provides quoting and syntax rules for PowerShell (`pwsh`) and POSIX `bash`.

---

## Installation & Setup

### Agent Setup

Tell any active OpenCode agent:

> *"Install and configure opencode-session-guardian from https://github.com/silveroxides/opencode-session-guardian"*

#### Agent Instructions
1. **Target location**:
   - Global (all projects): `~/.config/opencode/plugins/opencode-session-guardian`
   - Project-scoped: `.opencode/plugins/opencode-session-guardian`
2. **Clone repository**:
   ```bash
   git clone https://github.com/silveroxides/opencode-session-guardian.git <target_directory>
   ```
3. **Register in config** (in `opencode.jsonc` or `~/.config/opencode/opencode.jsonc`):
   - OpenCode V1:
     ```jsonc
     {
       "plugin": ["./plugins/opencode-session-guardian"]
     }
     ```
   - OpenCode V2: Auto-loads from `.opencode/plugins/`. If placed elsewhere, add to `plugins`:
     ```jsonc
     {
       "plugins": ["./plugins/opencode-session-guardian"]
     }
     ```

---

### Manual Setup

#### Via Git URL (in project with package.json)
```bash
npm install github:silveroxides/opencode-session-guardian
```

#### Via Git Clone
```bash
git clone https://github.com/silveroxides/opencode-session-guardian.git
```
Then register the relative path in `opencode.jsonc` as shown above.

---

## Commands Registered

| Command | Description |
| :--- | :--- |
| `/prep` | Prompts the active agent to inspect repository status and write a canonical 5-section handoff. |
| `/checkpoint` | Generates canonical handoff, stages it via `prep_session_compaction`, and verifies sealed state. |
| `/restore` | Inspects database state, affirms operating contracts, and verifies working tree status. |

---

## Tools Exposed

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `prep_session_compaction` | `handoff_markdown` (string, required) | Validates and stages a canonical 5-section handoff in memory for the next compaction event. |
| `inspect_session_context` | _(none)_ | Returns live SQLite database diagnostics (total messages, compaction count, staged handoff state). |
| `safeguard_terminal_guidance` | `shell_name` (string, optional) | Returns exact quoting and escaping safeguards for PowerShell (`pwsh`) or Bash. |

---

## Canonical 5-Section Handoff Schema

Required section headers:

```markdown
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
```

---

## Development & Testing

### Prerequisites

- Node.js >= 22
- npm >= 10

### Commands

```bash
# Install dependencies
npm install

# Typecheck with TypeScript
npm run typecheck

# Run unit tests
npm test

# Build distribution bundle (ESM + DTS via tsup)
npm run build
```

---

## Architecture

```
opencode-session-guardian/
├── src/
│   ├── index.ts        # Dual-mode V1/V2 entrypoint & hook registrations
│   ├── db.ts           # Unified SQLite adapter (bun:sqlite / node:sqlite)
│   ├── schema.ts       # 5-section validator & shell escaping safeguards
│   └── types.d.ts      # Ambient environment type definitions
├── test/
│   ├── index.test.ts   # Plugin registration & execution test suite
│   ├── db.test.ts      # SQLite compaction & diagnostics test suite
│   └── schema.test.ts  # Schema validation & prompt generator test suite
├── dist/               # Compiled bundle (esm) & TypeScript type declarations
├── index.ts            # Root entrypoint re-export
├── tsup.config.ts      # tsup bundle configuration
├── tsconfig.json       # Strict TypeScript compiler options
├── package.json        # NPM package specification & exports
└── LICENSE             # MIT License
```

---

## License

[MIT](LICENSE) © 2026 Silver
