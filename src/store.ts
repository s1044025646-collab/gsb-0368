import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { DecodeResult, RxParams, WaveformInput } from "./types";

export const DATA_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "uart.db");

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS waveforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS params (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bit_period INTEGER NOT NULL,
        parity TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(bit_period, parity)
      );
      CREATE TABLE IF NOT EXISTS decodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        waveform_id INTEGER NOT NULL REFERENCES waveforms(id),
        params_id INTEGER NOT NULL REFERENCES params(id),
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  saveWaveform(data: WaveformInput, name?: string): number {
    const r = this.db
      .prepare("INSERT INTO waveforms (name, data) VALUES (?, ?)")
      .run(name ?? null, JSON.stringify(data));
    return Number(r.lastInsertRowid);
  }

  getWaveform(id: number): WaveformInput | null {
    const row = this.db.prepare("SELECT data FROM waveforms WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as WaveformInput) : null;
  }

  listWaveforms(): Array<{ id: number; name: string | null; created_at: string }> {
    return this.db
      .prepare("SELECT id, name, created_at FROM waveforms ORDER BY id")
      .all() as Array<{ id: number; name: string | null; created_at: string }>;
  }

  /** 相同参数复用同一版本；参数更改会创建新版本，从而触发新分析。 */
  ensureParams(params: RxParams): number {
    const existing = this.db
      .prepare("SELECT id FROM params WHERE bit_period = ? AND parity = ?")
      .get(params.bitPeriod, params.parity) as { id: number } | undefined;
    if (existing) return existing.id;
    const r = this.db
      .prepare("INSERT INTO params (bit_period, parity) VALUES (?, ?)")
      .run(params.bitPeriod, params.parity);
    return Number(r.lastInsertRowid);
  }

  getParams(id: number): RxParams | null {
    const row = this.db.prepare("SELECT bit_period, parity FROM params WHERE id = ?").get(id) as
      | { bit_period: number; parity: RxParams["parity"] }
      | undefined;
    return row ? { bitPeriod: row.bit_period, parity: row.parity } : null;
  }

  saveDecode(waveformId: number, paramsId: number, result: DecodeResult): number {
    const r = this.db
      .prepare("INSERT INTO decodes (waveform_id, params_id, result) VALUES (?, ?, ?)")
      .run(waveformId, paramsId, JSON.stringify(result));
    return Number(r.lastInsertRowid);
  }

  getDecode(id: number): { waveformId: number; paramsId: number; result: DecodeResult } | null {
    const row = this.db
      .prepare("SELECT waveform_id, params_id, result FROM decodes WHERE id = ?")
      .get(id) as { waveform_id: number; params_id: number; result: string } | undefined;
    if (!row) return null;
    return {
      waveformId: row.waveform_id,
      paramsId: row.params_id,
      result: JSON.parse(row.result) as DecodeResult,
    };
  }

  listDecodes(): Array<{ id: number; waveform_id: number; params_id: number; created_at: string }> {
    return this.db
      .prepare("SELECT id, waveform_id, params_id, created_at FROM decodes ORDER BY id")
      .all() as Array<{ id: number; waveform_id: number; params_id: number; created_at: string }>;
  }

  close(): void {
    this.db.close();
  }
}
