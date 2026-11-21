import test from "node:test";
import assert from "node:assert/strict";
import exportedPlugin, { sessionGuardianPlugin, v2Setup, pendingHandoffs } from "../src/index.ts";

test("plugin export has dual-mode V1 function and V2 object properties", () => {
  assert.equal(typeof exportedPlugin, "function");
  assert.equal(exportedPlugin.id, "opencode-session-guardian");
  assert.equal(typeof exportedPlugin.setup, "function");
  assert.equal(typeof exportedPlugin.server, "function");
});

test("V1 plugin registers tools, commands, and hooks", async () => {
  const mockClient = {
    tui: { showToast: async () => {} },
    session: { prompt: async () => {} },
  };

  const hooks = await sessionGuardianPlugin({ client: mockClient });
  assert.ok(hooks.tool.prep_session_compaction);
  assert.ok(hooks.tool.inspect_session_context);
  assert.ok(hooks.tool.safeguard_terminal_guidance);
  assert.ok(hooks["command.execute.before"]);
  assert.ok(hooks["experimental.session.compacting"]);
  assert.ok(hooks["experimental.compaction.autocontinue"]);
  assert.ok(hooks.event);

  // Test tool execution
  const prepResult = await hooks.tool.prep_session_compaction.execute(
    { handoff_markdown: "incomplete text" },
    { sessionID: "ses_v1_test" }
  );
  assert.ok(prepResult.includes("ERROR: Invalid Handoff Schema"));

  const validHandoff = `## Objective
Preserve test session.
## Important Details
- Locked rules.
## Work State
### Completed
- Done.
### Active
- None.
### Blocked
- None.
## Next Move
1. Resume.
## Relevant Files
- file.ts`;

  const prepValidResult = await hooks.tool.prep_session_compaction.execute(
    { handoff_markdown: validHandoff },
    { sessionID: "ses_v1_test" }
  );
  assert.ok(prepValidResult.includes("Canonical handoff verified and staged"));
  assert.equal(pendingHandoffs.get("ses_v1_test"), validHandoff);

  // Cleanup
  pendingHandoffs.delete("ses_v1_test");
});

test("V2 setup registers hooks, tools, and commands", async () => {
  const hooksRegistered: Record<string, Function> = {};
  const toolsRegistered: Array<{ name: string; execute: Function }> = [];
  const commandsRegistered: Array<{ name: string; execute: Function }> = [];

  const mockCtx = {
    location: { directory: "/workspace/test" },
    session: {
      hook: async (name: string, fn: Function) => {
        hooksRegistered[name] = fn;
      },
      prompt: async () => {},
    },
    tool: {
      transform: async (cb: (editor: any) => void) => {
        cb({
          add: (toolDef: any) => toolsRegistered.push(toolDef),
        });
      },
    },
    command: {
      transform: async (cb: (editor: any) => void) => {
        cb({
          add: (cmdDef: any) => commandsRegistered.push(cmdDef),
        });
      },
    },
  };

  await v2Setup(mockCtx);

  assert.ok(hooksRegistered["compaction"]);
  assert.equal(toolsRegistered.length, 3);
  assert.ok(toolsRegistered.every((t: any) => t.options?.codemode === true));
  assert.ok(toolsRegistered.some((t) => t.name === "prep_session_compaction"));
  assert.ok(toolsRegistered.some((t) => t.name === "inspect_session_context"));
  assert.ok(toolsRegistered.some((t) => t.name === "safeguard_terminal_guidance"));

  assert.equal(commandsRegistered.length, 3);
  assert.ok(commandsRegistered.some((c) => c.name === "prep"));
  assert.ok(commandsRegistered.some((c) => c.name === "checkpoint"));
  assert.ok(commandsRegistered.some((c) => c.name === "restore"));

  // Test compaction hook event handling
  const event: { sessionID: string; result?: { summary: string } } = {
    sessionID: "ses_v2_compaction",
  };
  pendingHandoffs.set("ses_v2_compaction", "## Objective\nPrepped");
  await hooksRegistered["compaction"](event);

  assert.equal(event.result?.summary, "## Objective\nPrepped");
  assert.equal(pendingHandoffs.has("ses_v2_compaction"), false);
});
