import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredWaveform {
  id: number;
  name: string;
  payload: string;
  createdAt: string;
}

export interface StoredAnalysis {
  id: number;
  waveformId: number;
  paramsVersion: number;
  bitTicks: number;
  parity: string;
  result: string;
  createdAt: string;
}

export class AppDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS waveforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS params_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        waveform_id INTEGER NOT NULL,
        bit_ticks INTEGER NOT NULL,
        parity TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(waveform_id, bit_ticks, parity)
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        waveform_id INTEGER NOT NULL,
        params_version INTEGER NOT NULL,
        bit_ticks INTEGER NOT NULL,
        parity TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS error_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL,
        frame_index INTEGER,
        code TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  saveWaveform(name: string, payload: unknown): StoredWaveform {
    const stmt = this.db.prepare(
      'INSERT INTO waveforms (name, payload) VALUES (?, ?)',
    );
    const info = stmt.run(name, JSON.stringify(payload));
    return this.getWaveform(Number(info.lastInsertRowid))!;
  }

  getWaveform(id: number): StoredWaveform | null {
    const row = this.db.prepare('SELECT * FROM waveforms WHERE id = ?').get(id) as
      | { id: number; name: string; payload: string; created_at: string }
      | undefined;
    return row
      ? { id: row.id, name: row.name, payload: row.payload, createdAt: row.created_at }
      : null;
  }

  listWaveforms(): { id: number; name: string; createdAt: string }[] {
    return this.db
      .prepare('SELECT id, name, created_at as createdAt FROM waveforms ORDER BY id')
      .all() as { id: number; name: string; createdAt: string }[];
  }

  getOrCreateParamsVersion(waveformId: number, bitTicks: number, parity: string): number {
    const insert = this.db.prepare(
      `INSERT INTO params_versions (waveform_id, bit_ticks, parity) VALUES (?, ?, ?)
       ON CONFLICT(waveform_id, bit_ticks, parity) DO NOTHING`,
    );
    insert.run(waveformId, bitTicks, parity);
    const row = this.db
      .prepare(
        'SELECT id FROM params_versions WHERE waveform_id = ? AND bit_ticks = ? AND parity = ?',
      )
      .get(waveformId, bitTicks, parity) as { id: number } | undefined;
    return row!.id;
  }

  saveAnalysis(
    waveformId: number,
    paramsVersion: number,
    bitTicks: number,
    parity: string,
    result: unknown,
    errorRows: { frameIndex: number | null; code: string; detail: string }[],
  ): number {
    const insert = this.db.prepare(
      `INSERT INTO analyses (waveform_id, params_version, bit_ticks, parity, result)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const info = insert.run(
      waveformId,
      paramsVersion,
      bitTicks,
      parity,
      JSON.stringify(result),
    );
    const analysisId = Number(info.lastInsertRowid);
    const errStmt = this.db.prepare(
      'INSERT INTO error_records (analysis_id, frame_index, code, detail) VALUES (?, ?, ?, ?)',
    );
    for (const e of errorRows) {
      errStmt.run(analysisId, e.frameIndex, e.code, e.detail);
    }
    return analysisId;
  }

  findAnalysis(waveformId: number, bitTicks: number, parity: string): StoredAnalysis | null {
    const row = this.db
      .prepare(
        `SELECT id, waveform_id as waveformId, params_version as paramsVersion,
                bit_ticks as bitTicks, parity, result, created_at as createdAt
         FROM analyses
         WHERE waveform_id = ? AND bit_ticks = ? AND parity = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(waveformId, bitTicks, parity) as StoredAnalysis | undefined;
    return row ?? null;
  }

  listAnalyses(waveformId: number): Omit<StoredAnalysis, 'result'>[] {
    return this.db
      .prepare(
        `SELECT id, waveform_id as waveformId, params_version as paramsVersion,
                bit_ticks as bitTicks, parity, created_at as createdAt
         FROM analyses WHERE waveform_id = ? ORDER BY id`,
      )
      .all(waveformId) as Omit<StoredAnalysis, 'result'>[];
  }

  getAnalysis(id: number): StoredAnalysis | null {
    const row = this.db
      .prepare(
        `SELECT id, waveform_id as waveformId, params_version as paramsVersion,
                bit_ticks as bitTicks, parity, result, created_at as createdAt
         FROM analyses WHERE id = ?`,
      )
      .get(id) as StoredAnalysis | undefined;
    return row ?? null;
  }

  listErrors(analysisId: number): { frameIndex: number | null; code: string; detail: string }[] {
    return this.db
      .prepare(
        'SELECT frame_index as frameIndex, code, detail FROM error_records WHERE analysis_id = ? ORDER BY id',
      )
      .all(analysisId) as { frameIndex: number | null; code: string; detail: string }[];
  }

  close(): void {
    this.db.close();
  }
}
