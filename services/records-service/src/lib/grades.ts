// Canonical tokens we store
export const CANON_GRADES = new Set([
  'M','NM','NM-','EX+','EX','EX-','VG+','VG','VG-','G+','G','G-','F','P'
]);

/** Very forgiving parser -> canonical */
export function normalizeGradeLoose(input: unknown): string | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  s = s.toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\bPLUS\b/g, '+').replace(/\bMINUS\b/g, '-');
  s = s.replace(/\bNEAR\s+MINT\b/g, 'NM')
       .replace(/\bMINT\s*-\b/g, 'NM')
       .replace(/\bEXCELLENT\b/g, 'EX')
       .replace(/\bVERY\s+GOOD\b/g, 'VG')
       .replace(/\bGOOD\b/g, 'G')
       .replace(/\bFAIR\b/g, 'F')
       .replace(/\bPOOR\b/g, 'P');
  s = s.replace(/\s+/g, '');

  s = s.replace(/^VGPLUS$/,'VG+')
       .replace(/^VGMINUS$/,'VG-')
       .replace(/^EXPLUS$/,'EX+')
       .replace(/^EXMINUS$/,'EX-')
       .replace(/^NMPLUS$/,'NM+')
       .replace(/^NMMINUS$/,'NM-');

  if (CANON_GRADES.has(s)) return s;

  const m = s.match(/^(M|NM|EX|VG|G|F|P)(\+|-)?$/);
  if (m) {
    const canon = `${m[1]}${m[2] ?? ''}`;
    return CANON_GRADES.has(canon) ? canon : null;
  }
  return null;
}

/** Worst grade wins */
export function deriveOverallGrade(pieces: Array<any>): string | null {
  const order = ['M','NM','NM-','EX+','EX','EX-','VG+','VG','VG-','G+','G','G-','F','P'];
  const rank = new Map(order.map((g, i) => [g, i]));
  let worst: string | null = null;

  const consider = (g: unknown) => {
    const n = normalizeGradeLoose(g);
    if (!n) return;
    worst = worst == null ? n : (rank.get(n)! > rank.get(worst)! ? n : worst);
  };

  for (const mp of pieces) {
    consider(mp.discGrade);
    if (mp.sides) for (const v of Object.values(mp.sides)) consider(v);
  }
  return worst;
}

/** Normalize per-piece (discGrade + sides). Also supports A/B remap for multi-disc. */
export function normalizeMediaPiece(mp: any, opts?: { autoSideLetters?: boolean }) {
  const out: any = { ...mp };

  // discGrade
  if ('discGrade' in out) {
    const g = normalizeGradeLoose(out.discGrade);
    if (out.discGrade != null && !g) {
      throw Object.assign(new Error('invalid grade for discGrade'), { status: 400 });
    }
    out.discGrade = g;
  }

  // sides
  if (out.sides && typeof out.sides === 'object') {
    const baseOffset = (Number(out.index) - 1) * 2; // 0->A/B, 1->C/D, etc.
    const alpha = (i: number) => String.fromCharCode('A'.charCodeAt(0) + i);
    const onlyAB = Object.keys(out.sides).every((k: any) => ['A','B','a','b'].includes(String(k)));

    const result: Record<string,string|null> = {};
    for (const [rawK, v] of Object.entries(out.sides)) {
      const k = String(rawK).toUpperCase();
      const key = (opts?.autoSideLetters && onlyAB)
        ? (k === 'A' ? alpha(baseOffset) : alpha(baseOffset + 1))
        : k;

      const g = normalizeGradeLoose(v);
      if (v != null && !g) {
        throw Object.assign(new Error(`invalid grade for sides.${key}`), { status: 400 });
      }
      result[key] = g;
    }
    out.sides = result;
  }

  return out;
}
