// Dev check: every html`…` template in the app has balanced tags.
// Usage: node web/check-templates.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files = ['app.js', ...['lib', 'views'].flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.js') && !f.includes('.test')).map((f) => `${d}/${f}`))];
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

/** Pull out every html`…` template, replacing ${…} with a marker and recursing into nested templates. */
function templates(src) {
  const out = [];
  function readTemplate(i) { // i is just after the opening backtick
    let text = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') return { text, end: i + 1 };
      if (c === '$' && src[i + 1] === '{') { text += '\u0001'; i = skipExpr(i + 2); continue; }
      text += c; i++;
    }
    throw new Error('unterminated template');
  }
  function skipExpr(i) { // returns index after matching }
    let depth = 1;
    while (i < src.length) {
      const c = src[i];
      if (c === '`') {
        const isHtml = /html$/.test(src.slice(Math.max(0, i - 4), i));
        const t = readTemplate(i + 1);
        if (isHtml) out.push(t.text);
        i = t.end; continue;
      }
      if (c === "'" || c === '"') { const q = c; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return i + 1;
      i++;
    }
    throw new Error('unterminated expression');
  }
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '`' && /html$/.test(src.slice(Math.max(0, i - 4), i))) {
      const t = readTemplate(i + 1);
      out.push(t.text);
      i = t.end - 1;
    } else if (src[i] === '`') {
      i = readTemplate(i + 1).end - 1; // plain template string
    }
  }
  return out;
}

function checkBalance(t) {
  const stack = [];
  const re = /<(\/?)(\u0001|[a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(t))) {
    const [, close, name, , self] = m;
    const tag = name === '\u0001' ? '<component>' : name.toLowerCase();
    if (self || (!close && VOID.has(tag))) continue;
    if (!close) { stack.push(tag); continue; }
    const top = stack.pop();
    // htm allows <//> to close a component
    if (name === '' || (tag === '<component>' && top === '<component>')) continue;
    if (top !== tag) return `closing </${tag}> but open <${top ?? 'nothing'}>`;
  }
  if (stack.length) return `unclosed <${stack.join('>, <')}>`;
  return null;
}

let problems = 0, count = 0;
for (const f of files) {
  for (const t of templates(readFileSync(join(root, f), 'utf8'))) {
    count++;
    const err = checkBalance(t);
    if (err) { problems++; console.log(`${f}: ${err}\n   ${t.replace(/\s+/g, ' ').slice(0, 160)}`); }
  }
}
console.log(`${count} templates checked, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
