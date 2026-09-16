// Marking up recognised text for review. OCR is never perfect, so the review
// screen's job is to make its likely mistakes easy to spot rather than pretend
// they don't happen. Measured on 384 rendered lines, what survives a good model
// and the server's cleanup is: wrong spacing, and look-alike characters inside
// passwords and codes (0 vs O, 1 vs l, 5 vs S).
//
// The native app keeps an identical copy (mobile/src/lib/annotate.ts); they are
// held together by shared/annotate-compat.test.js.

// Characters with a twin that reads the same to a human skimming, and that a
// recogniser genuinely confuses. Marked only inside code-like text: in an
// ordinary word an O is obviously an O, and marking it would be noise.
const RISKY = /[0Oo1lI|5S8B_.,]/;

// Text where a single wrong character matters and no dictionary can help:
// passwords, keys, SSIDs, addresses, serials. Either letters and digits mixed
// in one token, or a symbol joining two alphanumerics (192.168.0.1, a_b, x/y).
export function isCodeLike(token) {
  if (token.length < 2) return false;
  if (/[A-Za-z]/.test(token) && /\d/.test(token)) return true;
  return /[A-Za-z0-9][_\-./@:\\#&+=?%][A-Za-z0-9]/.test(token);
}

// Split text into segments for display:
//   { t }                plain text
//   { t, mark: 'risky' } a character worth double-checking
//   { t, mark: 'space' } a space next to code-like text, where a wrongly added
//                        or missing space is easy to miss and breaks a password
// Concatenating every `t` gives back exactly the input.
export function annotate(text) {
  const out = [];
  const push = (t, mark) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.mark === mark) last.t += t;
    else out.push(mark ? { t, mark } : { t });
  };

  // split into runs of whitespace and runs of non-whitespace, keeping both
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      const before = parts[i - 1];
      const after = parts[i + 1];
      const beside = (before && isCodeLike(before)) || (after && isCodeLike(after));
      // only spaces, never newlines: a line break is not a mistake to hunt
      if (beside && !part.includes('\n')) push(part, 'space');
      else push(part);
      continue;
    }
    if (!isCodeLike(part)) {
      push(part);
      continue;
    }
    for (const ch of part) push(ch, RISKY.test(ch) ? 'risky' : undefined);
  }
  return out;
}

// True when the recogniser itself was unsure about any of these words. Below
// 0.9 a line is nearly always wrong, though plenty of wrong lines score above
// it — so this is a hint, never a verdict.
export function anyDoubtful(words) {
  return words.some((w) => typeof w.c === 'number' && w.c < 0.9);
}

export const isDoubtful = (word) => typeof word.c === 'number' && word.c < 0.9;
