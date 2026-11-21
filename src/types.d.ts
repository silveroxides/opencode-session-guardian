declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: Record<string, unknown>);
    query(sql: string): any;
    run(sql: string): void;
    close(): void;
  }
}
