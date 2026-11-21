import os from "os";
import path from "path";
import fs from "fs";
import { validateHandoff } from "./schema.ts";

export interface QueryStatement {
  all(params?: Record<string, unknown>): unknown[];
  get(params?: Record<string, unknown>): unknown | null;
  run(params?: Record<string, unknown>): void;
}

export interface SqliteAdapter {
  query(sql: string): QueryStatement;
  run(sql: string): void;
  close(): void;
}

let dbInstance: SqliteAdapter | null = null;

/**
 * Resolves the absolute path to OpenCode's SQLite database.
 */
export function resolveDbPath(): string {
  if (process.env.OPENCODE_DATA_DIR) {
    const custom = path.join(process.env.OPENCODE_DATA_DIR, "opencode.db");
    if (fs.existsSync(custom)) return custom;
  }

  const home = os.homedir();
  const xdgData = process.env.XDG_DATA_HOME;

  const candidates = [
    xdgData ? path.join(xdgData, "opencode", "opencode.db") : null,
    path.join(home, ".local", "share", "opencode", "opencode.db"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "opencode", "opencode.db") : null,
    path.join(home, "Library", "Application Support", "opencode", "opencode.db"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

/**
 * Reset cached database instance (primarily for testing or reconnection).
 */
export function resetDatabaseInstance(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}

/**
 * Creates a unified SQLite adapter supporting Bun (native bun:sqlite) and Node (node:sqlite).
 */
export async function getDatabase(customPath?: string): Promise<SqliteAdapter> {
  if (dbInstance && !customPath) return dbInstance;

  const dbPath = customPath || resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`OpenCode database not found at ${dbPath}`);
  }

  // Attempt Bun native SQLite first
  try {
    const bunSqlite = await import("bun:sqlite");
    const BunDb = bunSqlite.Database;
    const rawDb = new BunDb(dbPath, { create: false, strict: true });
    rawDb.run("PRAGMA journal_mode = WAL;");
    rawDb.run("PRAGMA busy_timeout = 5000;");

    const adapter: SqliteAdapter = {
      query(sql: string): QueryStatement {
        const stmt = rawDb.query(sql);
        return {
          all: (params) => stmt.all(params as any),
          get: (params) => stmt.get(params as any),
          run: (params) => stmt.run(params as any),
        };
      },
      run(sql: string): void {
        rawDb.run(sql);
      },
      close(): void {
        rawDb.close();
      },
    };

    if (!customPath) dbInstance = adapter;
    return adapter;
  } catch {
    // Fall back to Node native SQLite
    try {
      const nodeSqlite = await import("node:sqlite");
      const NodeDb = nodeSqlite.DatabaseSync;
      const rawDb = new NodeDb(dbPath, { open: true });
      rawDb.exec("PRAGMA journal_mode = WAL;");
      rawDb.exec("PRAGMA busy_timeout = 5000;");

      const adapter: SqliteAdapter = {
        query(sql: string): QueryStatement {
          const stmt = rawDb.prepare(sql);
          return {
            all: (params) => (params ? stmt.all(params as any) : stmt.all()),
            get: (params) => (params ? stmt.get(params as any) : stmt.get()),
            run: (params) => (params ? stmt.run(params as any) : stmt.run()),
          };
        },
        run(sql: string): void {
          rawDb.exec(sql);
        },
        close(): void {
          rawDb.close();
        },
      };

      if (!customPath) dbInstance = adapter;
      return adapter;
    } catch (err) {
      throw new Error(`Failed to initialize SQLite adapter: ${String(err)}`);
    }
  }
}

/**
 * Scans recent assistant messages in the active session for a pre-existing canonical handoff.
 */
export async function findRecentHandoff(sessionID: string, searchDepth = 50): Promise<string | null> {
  try {
    const db = await getDatabase();
    const query = db.query(`
      SELECT p.data
      FROM part p
      JOIN message m ON p.message_id = m.id
      WHERE m.session_id = $sessionID
        AND json_extract(m.data, '$.role') = 'assistant'
        AND json_extract(p.data, '$.type') = 'text'
        AND m.time_created > COALESCE(
          (SELECT max(m2.time_created)
           FROM message m2
           WHERE m2.session_id = $sessionID
             AND json_extract(m2.data, '$.mode') = 'compaction'),
          0
        )
      ORDER BY m.time_created DESC
      LIMIT $limit;
    `);

    const rows = query.all({ $sessionID: sessionID, $limit: searchDepth }) as Array<{ data: string }>;
    for (const row of rows) {
      try {
        const part = JSON.parse(row.data);
        if (part && part.type === "text" && typeof part.text === "string") {
          const validation = validateHandoff(part.text);
          if (validation.valid && validation.cleanText) {
            return validation.cleanText;
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch (err) {
    console.error("[SessionGuardian] Error scanning recent handoffs:", err);
    return null;
  }
}

/**
 * Atomically updates the latest compaction assistant text part with the verified canonical handoff.
 */
export async function atomicUpdateCompaction(sessionID: string, cleanHandoff: string): Promise<boolean> {
  try {
    const db = await getDatabase();

    const findQuery = db.query(`
      SELECT p.id, p.data
      FROM part p
      JOIN message m ON p.message_id = m.id
      WHERE m.session_id = $sessionID
        AND json_extract(m.data, '$.mode') = 'compaction'
        AND json_extract(p.data, '$.type') = 'text'
      ORDER BY m.time_created DESC
      LIMIT 1;
    `);

    const row = findQuery.get({ $sessionID: sessionID }) as { id: string; data: string } | null;
    if (!row) {
      console.warn("[SessionGuardian] No compaction text part found to update for session:", sessionID);
      return false;
    }

    const partData = JSON.parse(row.data);
    partData.text = cleanHandoff;
    const now = Date.now();

    const updateQuery = db.query(`
      UPDATE part
      SET data = $data, time_updated = $timeUpdated
      WHERE id = $id;
    `);

    updateQuery.run({
      $data: JSON.stringify(partData),
      $timeUpdated: now,
      $id: row.id,
    });

    return true;
  } catch (err) {
    console.error("[SessionGuardian] Failed to update compaction part in SQLite:", err);
    return false;
  }
}

/**
 * Returns diagnostic metadata about the current session's compaction and message count.
 */
export async function getSessionDiagnostics(sessionID: string): Promise<Record<string, unknown>> {
  try {
    const db = await getDatabase();

    const countQuery = db.query(`
      SELECT count(*) as total
      FROM message
      WHERE session_id = $sessionID;
    `);
    const totalRow = countQuery.get({ $sessionID: sessionID }) as { total: number };

    const compactionQuery = db.query(`
      SELECT count(*) as count
      FROM message
      WHERE session_id = $sessionID
        AND json_extract(data, '$.mode') = 'compaction';
    `);
    const compRow = compactionQuery.get({ $sessionID: sessionID }) as { count: number };

    return {
      sessionID,
      databasePath: resolveDbPath(),
      totalMessages: totalRow?.total ?? 0,
      compactionEvents: compRow?.count ?? 0,
      status: "active",
    };
  } catch (err) {
    return {
      sessionID,
      error: String(err),
      status: "error",
    };
  }
}
