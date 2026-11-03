// Safe calculator for the amount box: supports + - × ÷ ( ) and decimals.
// Returns the result in pence (integer), or null when the input is not a valid sum.
export function evaluateToPence(input) {
  const s = String(input ?? '')
    .replace(/[£,\s]/g, '')
    .replace(/[x×X]/g, '*')
    .replace(/÷/g, '/');
  if (!s) return null;
  let i = 0;
  const peek = () => s[i];

  function number() {
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const t = s.slice(start, i);
    if (!t || t === '.' || (t.match(/\./g) || []).length > 1) throw new Error('bad number');
    return parseFloat(t);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('missing )');
      i++;
      return v;
    }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return Math.round(v * 100);
  } catch {
    return null;
  }
}

// True when the text is a sum rather than a single number (so we keep it as a note).
export function isSum(input) {
  return /[0-9.)]\s*[+\-*/x×÷]/.test(String(input ?? ''));
}
