export type Kind = 'VINYL'|'CD'|'CASSETTE'|'OTHER';

export function normalizeKindInfo(input: unknown): {
  kind: Kind,
  sizeInchHint?: number,
  speedRpmHint?: number,
  formatHint?: string   // e.g., "EP" for 7-inch
} {
  const raw = String(input ?? '').trim();
  const s = raw.toUpperCase();

  // VINYL family (with hints)
  if (/(VINYL|RECORD|LP|12"|12IN|12\-INCH|12 IN)/.test(s)) {
    return { kind:'VINYL', sizeInchHint: 12, speedRpmHint: 33 };
  }
  if (/(10"|10IN|10\-INCH|10 IN)/.test(s)) {
    return { kind:'VINYL', sizeInchHint: 10, speedRpmHint: 33 };
  }
  // Treat ALL 7-inch as EP (common case), default 45 RPM
  if (/(7"|7IN|7\-INCH|7 IN|EP|45)/.test(s)) {
    return { kind:'VINYL', sizeInchHint: 7, speedRpmHint: 45, formatHint: 'EP' };
  }

  if (/^(CD|COMPACT\s*DISC)$/.test(s)) return { kind:'CD' };
  if (/^(CASSETTE|TAPE)$/.test(s))     return { kind:'CASSETTE' };

  // Fallback
  return { kind:'OTHER' };
}

export function normalizeKind(input: unknown): Kind {
  return normalizeKindInfo(input).kind;
}
