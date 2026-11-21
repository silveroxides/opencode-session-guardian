import { z } from "zod";
import { validateHandoff, buildAutoPrepPrompt, getTerminalEscapingReminder, buildFallbackHandoff } from "./schema.ts";
import { findRecentHandoff, atomicUpdateCompaction, getSessionDiagnostics } from "./db.ts";

/**
 * Fallback-safe tool helper. In OpenCode V1, @opencode-ai/plugin provides tool().
 * If not present in V2 runtime, fallback to identity wrapper.
 */
type ToolFn = (<T>(input: T) => T) & { schema: typeof z };
const tool: ToolFn = ((input: any) => input) as any;
tool.schema = z;

/**
 * In-memory map of verified canonical handoffs waiting to be sealed on compaction.
 * Key: sessionID, Value: clean Markdown text.
 */
export const pendingHandoffs = new Map<string, string>();

/**
 * OpenCode Session Guardian Plugin.
 * Enforces deterministic session compaction and context retention.
 */
export const sessionGuardianPlugin = async (input: any): Promise<any> => {
  const { client } = input;

  // Tool 1: Explicitly prep and seal a handoff before compaction
  const prepTool = tool({
    description: "Explicitly submit and seal a canonical 5-section session handoff prior to running /compact.",
    args: {
      handoff_markdown: z.string().describe("Complete canonical 5-section handoff text"),
    },
    async execute(args: { handoff_markdown: string }, context: { sessionID: string }) {
      const validation = validateHandoff(args.handoff_markdown);
      if (!validation.valid || !validation.cleanText) {
        return `[ERROR: Invalid Handoff Schema] Missing required canonical sections:\n${validation.missingSections.map((s) => `- ${s}`).join("\n")}\n\nPlease include all 5 sections.`;
      }

      pendingHandoffs.set(context.sessionID, validation.cleanText);
      try {
        await client?.tui?.showToast?.({
          body: {
            title: "Session Guardian",
            message: "Canonical handoff prepped and sealed. Ready for /compact.",
            variant: "success",
            duration: 4000,
          },
        });
      } catch {
        // TUI toast is non-critical
      }

      return "Canonical handoff verified and staged in memory. Next /compact command will seal this exact text deterministically.";
    },
  });

  // Tool 2: Inspect current session compaction diagnostics from SQLite
  const inspectTool = tool({
    description: "Inspect active session compaction status, message metrics, and staged handoff state.",
    args: {},
    async execute(_args: unknown, context: { sessionID: string }) {
      const diagnostics = await getSessionDiagnostics(context.sessionID);
      const isStaged = pendingHandoffs.has(context.sessionID);
      return JSON.stringify({ ...diagnostics, handoffStaged: isStaged }, null, 2);
    },
  });

  // Tool 3: Get shell escaping safeguards and rules
  const safeguardTool = tool({
    description: "Retrieve strict terminal shell quoting and escaping safeguards (PowerShell vs Bash).",
    args: {
      shell_name: z.string().optional().describe("Shell identifier, e.g. 'pwsh', 'powershell', or 'bash'"),
    },
    async execute(args: { shell_name?: string }) {
      return getTerminalEscapingReminder(args.shell_name);
    },
  });

  const applyCompactionPatch = async (sessionID: string): Promise<boolean> => {
    const handoff = pendingHandoffs.get(sessionID);
    if (!handoff) return false;

    const success = await atomicUpdateCompaction(sessionID, handoff);
    if (success) {
      pendingHandoffs.delete(sessionID);
      client?.tui?.showToast?.({
        body: {
          title: "Session Guardian",
          message: "Session compacted deterministically. 100% loss-free context sealed.",
          variant: "success",
          duration: 5000,
        },
      }).catch(() => {});
      return true;
    }
    return false;
  };

  return {
    // Register slash commands dynamically into OpenCode V1 config
    config: async (cfg: any) => {
      cfg.command ??= {};
      cfg.command["prep"] = {
        description: "Generate and verify canonical 5-section handoff for session compaction",
        template: buildAutoPrepPrompt(process.env.SHELL),
      };
      cfg.command["checkpoint"] = {
        description: "Create a verified session checkpoint and seal handoff in session guardian",
        template: "Create session checkpoint: Generate canonical 5-section handoff, call prep_session_compaction tool, and verify sealed state.",
      };
      cfg.command["restore"] = {
        description: "Restore and verify active session context, rules, and repository contracts",
        template: "Restore session context: Call inspect_session_context, check git status, affirm operating contracts, and report status.",
      };
    },

    tool: {
      prep_session_compaction: prepTool,
      inspect_session_context: inspectTool,
      safeguard_terminal_guidance: safeguardTool,
    },

    // Hook 1: Intercept /compact command before execution
    "command.execute.before": async (cmdInput: { command: string; sessionID: string }) => {
      if (cmdInput.command !== "session.compact") return;

      const sessionID = cmdInput.sessionID;

      // Check if a handoff is already staged in memory
      if (pendingHandoffs.has(sessionID)) {
        return;
      }

      // Check if conversation history has a valid canonical handoff since last compaction
      const recentHandoff = await findRecentHandoff(sessionID);
      if (recentHandoff) {
        pendingHandoffs.set(sessionID, recentHandoff);
        return;
      }

      // No handoff found: halt compaction and prompt agent to write one
      try {
        await client?.tui?.showToast?.({
          body: {
            title: "Compaction Halted",
            message: "No canonical handoff prepped. Generating prep prompt...",
            variant: "warning",
            duration: 6000,
          },
        });
      } catch {}

      const promptText = buildAutoPrepPrompt(process.env.SHELL);
      try {
        await client?.session?.prompt?.({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: promptText }],
          },
        });
      } catch (err) {
        console.error("[SessionGuardian] Failed to inject auto-prep prompt:", err);
      }

      throw new Error(
        "Compaction halted by Session Guardian: No canonical handoff was prepped. An auto-prep prompt has been added to chat. Wait for agent to generate handoff, then re-run /compact to seal."
      );
    },

    // Hook 2: Ensure handoff is staged (handles auto-compaction overflow) and throttle subagent
    "experimental.session.compacting": async (compInput: { sessionID: string }, output: { prompt?: string }) => {
      let handoff: string | null | undefined = pendingHandoffs.get(compInput.sessionID);
      if (!handoff) {
        handoff = await findRecentHandoff(compInput.sessionID);
      }

      if (!handoff) {
        handoff = buildFallbackHandoff({
          worktree: input?.worktree,
          shellName: process.env.SHELL,
        });
      }

      pendingHandoffs.set(compInput.sessionID, handoff);

      // Feed handoff directly as compaction prompt payload for dual redundancy
      output.prompt = `Output the following verified state verbatim without altering any headers, tags, or contracts:\n\n${handoff}`;
    },

    // Hook 3: First injection point right after compaction subagent finishes
    "experimental.compaction.autocontinue": async (continueInput: { sessionID: string }) => {
      await applyCompactionPatch(continueInput.sessionID);
    },

    // Hook 4: Event listener fallback for session.compacted
    event: async ({ event }: { event: any }) => {
      const eventType = event?.type || event?.name;
      if (eventType === "session.compacted") {
        const sessionID = event?.sessionID || event?.properties?.sessionID;
        if (sessionID) {
          await applyCompactionPatch(sessionID);
        }
      }
    },
  };
};

/**
 * OpenCode V2 native setup handler.
 * Registers compaction hook to inject summary directly, bypassing model summarization.
 */
export async function v2Setup(ctx: any): Promise<void> {
  // 1. Hook compaction directly in V2
  await ctx.session.hook("compaction", async (event: any) => {
    let handoff: string | null | undefined = pendingHandoffs.get(event.sessionID);
    if (!handoff) {
      handoff = await findRecentHandoff(event.sessionID);
    }
    if (!handoff) {
      handoff = buildFallbackHandoff({
        worktree: ctx.location?.directory,
        shellName: process.env.SHELL,
      });
    }

    // V2 native contract: setting result records summary and skips LLM call
    event.result = { summary: handoff };
    pendingHandoffs.delete(event.sessionID);
  });

  // 2. Register tools via V2 tool transform
  await ctx.tool.transform((editor: any) => {
    editor.add({
      name: "prep_session_compaction",
      description: "Explicitly submit and seal a canonical 5-section session handoff prior to compaction.",
      options: { codemode: true },
      input: {
        type: "object",
        properties: {
          handoff_markdown: { type: "string", description: "Complete canonical 5-section handoff text" },
        },
        required: ["handoff_markdown"],
      },
      execute: async ({ handoff_markdown }: { handoff_markdown: string }, context: { sessionID: string }) => {
        const validation = validateHandoff(handoff_markdown);
        if (!validation.valid || !validation.cleanText) {
          return {
            content: `[ERROR: Invalid Handoff Schema] Missing required canonical sections:\n${validation.missingSections.map((s: string) => `- ${s}`).join("\n")}`,
          };
        }
        pendingHandoffs.set(context.sessionID, validation.cleanText);
        return { content: "Canonical handoff verified and staged for next compaction." };
      },
    });

    editor.add({
      name: "inspect_session_context",
      description: "Inspect active session compaction status and message metrics.",
      options: { codemode: true },
      input: { type: "object", properties: {} },
      execute: async (_input: unknown, context: { sessionID: string }) => {
        const diagnostics = await getSessionDiagnostics(context.sessionID);
        const isStaged = pendingHandoffs.has(context.sessionID);
        return { content: JSON.stringify({ ...diagnostics, handoffStaged: isStaged }, null, 2) };
      },
    });

    editor.add({
      name: "safeguard_terminal_guidance",
      description: "Retrieve strict terminal shell quoting and escaping safeguards (PowerShell vs Bash).",
      options: { codemode: true },
      input: {
        type: "object",
        properties: {
          shell_name: { type: "string", description: "Shell identifier, e.g. 'pwsh' or 'bash'" },
        },
      },
      execute: async ({ shell_name }: { shell_name?: string }) => {
        return { content: getTerminalEscapingReminder(shell_name) };
      },
    });
  });

  // 3. Register slash commands via V2 command transform
  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "prep",
      description: "Generate and verify canonical 5-section handoff for session compaction",
      execute: async ({ sessionID, prompt, delivery }: any) => {
        const prepText = buildAutoPrepPrompt(process.env.SHELL);
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          text: prepText,
          delivery,
        });
      },
    });

    editor.add({
      name: "checkpoint",
      description: "Create a verified session checkpoint and seal handoff in session guardian",
      execute: async ({ sessionID, prompt, delivery }: any) => {
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          text: "Create session checkpoint: Generate canonical 5-section handoff, call prep_session_compaction tool, and verify sealed state.",
          delivery,
        });
      },
    });

    editor.add({
      name: "restore",
      description: "Restore and verify active session context, rules, and repository contracts",
      execute: async ({ sessionID, prompt, delivery }: any) => {
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          text: "Restore session context: Call inspect_session_context, check git status, affirm operating contracts, and report status.",
          delivery,
        });
      },
    });
  });
}

// Dual-mode export: runs as function in OpenCode V1, and as Plugin object with .id/.setup in OpenCode V2
export const exportedPlugin = Object.assign(sessionGuardianPlugin, {
  id: "opencode-session-guardian",
  setup: v2Setup,
  server: sessionGuardianPlugin,
});

export default exportedPlugin;
