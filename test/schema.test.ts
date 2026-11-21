import test from "node:test";
import assert from "node:assert/strict";
import {
  validateHandoff,
  buildFallbackHandoff,
  getTerminalEscapingReminder,
  buildAutoPrepPrompt,
} from "../src/schema.ts";

test("validateHandoff rejects empty or invalid inputs", () => {
  assert.equal(validateHandoff("").valid, false);
  assert.equal(validateHandoff("random text without sections").valid, false);
  const result = validateHandoff("## Objective\nOnly objective here");
  assert.equal(result.valid, false);
  assert.ok(result.missingSections.includes("## Important Details"));
  assert.ok(result.missingSections.includes("## Work State"));
});

test("validateHandoff accepts fully valid 5-section handoff", () => {
  const validMarkdown = `
Leading chatter that should be stripped

## Objective
Preserve session integrity.

## Important Details
- Locked domain rules.

## Work State
### Completed
- Initial commit.
### Active
- None.
### Blocked
- None.

## Next Move
1. Verify status.

## Relevant Files
- src/index.ts
`;

  const result = validateHandoff(validMarkdown);
  assert.equal(result.valid, true);
  assert.equal(result.missingSections.length, 0);
  assert.ok(result.cleanText?.startsWith("## Objective"));
  assert.ok(!result.cleanText?.includes("Leading chatter"));
});

test("getTerminalEscapingReminder distinguishes PowerShell and Bash", () => {
  const pwshReminder = getTerminalEscapingReminder("pwsh");
  assert.ok(pwshReminder.includes("POWERSHELL / PWSH"));
  assert.ok(pwshReminder.includes("-LiteralPath"));

  const bashReminder = getTerminalEscapingReminder("bash");
  assert.ok(bashReminder.includes("BASH"));
  assert.ok(!bashReminder.includes("-LiteralPath"));
});

test("buildFallbackHandoff generates valid schema compliant text", () => {
  const fallback = buildFallbackHandoff({
    worktree: "/test/dir",
    gitBranch: "feature/test",
    gitCommit: "abc1234",
    gitStatus: "M src/index.ts",
    shellName: "bash",
  });

  const validation = validateHandoff(fallback);
  assert.equal(validation.valid, true);
  assert.ok(fallback.includes("feature/test"));
  assert.ok(fallback.includes("abc1234"));
  assert.ok(fallback.includes("M src/index.ts"));
});

test("buildAutoPrepPrompt includes required section headers", () => {
  const prompt = buildAutoPrepPrompt("bash");
  assert.ok(prompt.includes("## Objective"));
  assert.ok(prompt.includes("## Important Details"));
  assert.ok(prompt.includes("## Work State"));
  assert.ok(prompt.includes("## Next Move"));
  assert.ok(prompt.includes("## Relevant Files"));
});
