import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import {
  getDatabase,
  findRecentHandoff,
  atomicUpdateCompaction,
  getSessionDiagnostics,
  resolveDbPath,
  resetDatabaseInstance,
} from "../src/db.ts";

test("resolveDbPath respects OPENCODE_DATA_DIR environment variable", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-test-"));
  const fakeDb = path.join(tmpDir, "opencode.db");
  fs.writeFileSync(fakeDb, "");

  const prevEnv = process.env.OPENCODE_DATA_DIR;
  try {
    process.env.OPENCODE_DATA_DIR = tmpDir;
    assert.equal(resolveDbPath(), fakeDb);
  } finally {
    process.env.OPENCODE_DATA_DIR = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SQLite adapter and compaction queries operate correctly", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-db-test-"));
  const testDbPath = path.join(tmpDir, "opencode.db");
  const prevDataDir = process.env.OPENCODE_DATA_DIR;
  process.env.OPENCODE_DATA_DIR = tmpDir;

  // Initialize SQLite tables
  const rawDb = new DatabaseSync(testDbPath, { open: true });
  rawDb.exec(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  const sessionID = "ses_test_123";
  const now = Date.now();

  // Insert standard assistant message with valid handoff
  const validHandoffText = `## Objective
Preserve test session.
## Important Details
- Testing details.
## Work State
### Completed
- Setup done.
### Active
- None.
### Blocked
- None.
## Next Move
1. Complete verification.
## Relevant Files
- test.ts`;

  rawDb.exec(`
    INSERT INTO message VALUES ('msg_1', '${sessionID}', ${now - 1000}, '{"role":"assistant"}');
    INSERT INTO part VALUES ('part_1', 'msg_1', ${now - 1000}, '${JSON.stringify({ type: "text", text: validHandoffText })}');
  `);

  // Insert a compaction message
  rawDb.exec(`
    INSERT INTO message VALUES ('msg_comp', '${sessionID}', ${now}, '{"role":"assistant","mode":"compaction"}');
    INSERT INTO part VALUES ('part_comp', 'msg_comp', ${now}, '{"type":"text","text":"old lossy summary"}');
  `);

  resetDatabaseInstance();
  const db = await getDatabase(testDbPath);
  assert.ok(db);

  // Test findRecentHandoff (before compaction timestamp)
  // Since compaction message timestamp is >= msg_1, findRecentHandoff returns null for post-compaction
  const found = await findRecentHandoff(sessionID);
  assert.equal(found, null);

  // Add a new assistant message after compaction
  rawDb.exec(`
    INSERT INTO message VALUES ('msg_2', '${sessionID}', ${now + 500}, '{"role":"assistant"}');
    INSERT INTO part VALUES ('part_2', 'msg_2', ${now + 500}, '${JSON.stringify({ type: "text", text: validHandoffText })}');
  `);

  const foundAfter = await findRecentHandoff(sessionID);
  assert.ok(foundAfter?.includes("## Objective"));

  // Test atomicUpdateCompaction
  const updated = await atomicUpdateCompaction(sessionID, "## Sealed Handoff");
  assert.equal(updated, true);

  const checkPart = db.query("SELECT data FROM part WHERE id = 'part_comp'").get() as { data: string };
  const parsed = JSON.parse(checkPart.data);
  assert.equal(parsed.text, "## Sealed Handoff");

  // Test getSessionDiagnostics
  const diagnostics = await getSessionDiagnostics(sessionID);
  assert.equal(diagnostics.sessionID, sessionID);
  assert.equal(diagnostics.totalMessages, 3);
  assert.equal(diagnostics.compactionEvents, 1);
  assert.equal(diagnostics.status, "active");

  db.close();
  rawDb.close();
  resetDatabaseInstance();
  process.env.OPENCODE_DATA_DIR = prevDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
