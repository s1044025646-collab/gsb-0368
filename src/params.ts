import { InputError, RxParams } from "./types";

export function validateParams(raw: unknown): RxParams {
  if (typeof raw !== "object" || raw === null) {
    throw new InputError("INVALID_FORMAT", "参数必须是对象");
  }
  const p = raw as Record<string, unknown>;
  if (!Number.isInteger(p.bitPeriod) || (p.bitPeriod as number) <= 0) {
    throw new InputError("INVALID_BIT_PERIOD", "bitPeriod 必须是正整数 tick");
  }
  if ((p.bitPeriod as number) % 2 !== 0) {
    throw new InputError("INVALID_BIT_PERIOD", "bitPeriod 必须是正偶数 tick");
  }
  if (p.parity !== "none" && p.parity !== "even" && p.parity !== "odd") {
    throw new InputError("INVALID_PARITY", "parity 必须是 none | even | odd");
  }
  return { bitPeriod: p.bitPeriod as number, parity: p.parity };
}
