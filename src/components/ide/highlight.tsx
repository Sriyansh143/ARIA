'use client';

/**
 * highlight.tsx — Lightweight regex-based syntax highlighter + file icon
 * helper for the JARVIS IDE. NO heavy deps like Monaco/CodeMirror.
 *
 * The highlighter walks a line of code and wraps recognized tokens in
 * <span style="color: …"> elements. It is intentionally simple — good
 * enough to read code at a glance, not a full parser.
 *
 * Token colors follow the JARVIS cyberpunk palette (cyan / violet / amber
 * / green / red / muted text) so the editor matches the dashboard theme.
 */

import type { ReactNode } from 'react';
import { JARVIS } from '@/lib/config';

export const TOKEN_COLORS = {
  keyword: JARVIS.colors.violet,
  string: JARVIS.colors.green,
  number: JARVIS.colors.amber,
  comment: JARVIS.colors.textMute,
  function: JARVIS.colors.cyan,
  type: JARVIS.colors.cyan,
  punctuation: JARVIS.colors.textDim,
  operator: JARVIS.colors.textDim,
  variable: JARVIS.colors.text,
  property: JARVIS.colors.text,
  tag: JARVIS.colors.red,
  attr: JARVIS.colors.amber,
  regex: JARVIS.colors.green,
};

const TS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
  'extends', 'implements', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'default', 'try', 'catch',
  'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
  'this', 'super', 'import', 'export', 'from', 'as', 'async', 'await',
  'yield', 'static', 'public', 'private', 'protected', 'readonly',
  'abstract', 'get', 'set', 'namespace', 'declare', 'module', 'require',
  'void', 'null', 'undefined', 'true', 'false', 'NaN', 'Infinity',
  'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol',
  'Map', 'Set', 'Record', 'Partial', 'Readonly', 'Pick', 'Omit',
]);

const CSS_KEYWORDS = new Set([
  'important', 'inherit', 'initial', 'unset', 'auto', 'none', 'block',
  'inline', 'flex', 'grid', 'absolute', 'relative', 'fixed', 'sticky',
  'hidden', 'visible', 'scroll', 'wrap', 'nowrap', 'center', 'left',
  'right', 'top', 'bottom', 'middle', 'solid', 'dashed', 'dotted',
]);

const PY_KEYWORDS = new Set([
  'def', 'class', 'import', 'from', 'as', 'return', 'if', 'elif', 'else',
  'for', 'while', 'break', 'continue', 'try', 'except', 'finally', 'raise',
  'with', 'yield', 'lambda', 'global', 'nonlocal', 'pass', 'del', 'assert',
  'async', 'await', 'in', 'is', 'not', 'and', 'or', 'None', 'True',
  'False', 'self', 'cls',
]);

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
  'esac', 'function', 'return', 'exit', 'echo', 'export', 'local',
  'readonly', 'declare', 'source', 'alias', 'in',
]);

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'LEFT',
  'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT',
  'CONSTRAINT', 'CHECK', 'CASCADE', 'BEGIN', 'COMMIT', 'ROLLBACK',
]);

function keywordsFor(lang: string): Set<string> {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return TS_KEYWORDS;
    case 'python':
      return PY_KEYWORDS;
    case 'css':
    case 'scss':
      return CSS_KEYWORDS;
    case 'bash':
      return BASH_KEYWORDS;
    case 'sql':
      return SQL_KEYWORDS;
    default:
      return TS_KEYWORDS;
  }
}

interface Token {
  type: keyof typeof TOKEN_COLORS;
  value: string;
}

/** Tokenize a single line of code for a given language. */
function tokenizeLine(line: string, lang: string): Token[] {
  const keywords = keywordsFor(lang);
  const tokens: Token[] = [];

  // Whole-line comment shortcuts.
  if (lang === 'python' || lang === 'bash') {
    const idx = line.indexOf('#');
    if (idx >= 0) {
      const before = line.slice(0, idx);
      const comment = line.slice(idx);
      tokens.push(...tokenizeJsLike(before, keywords, lang));
      tokens.push({ type: 'comment', value: comment });
      return tokens;
    }
  }

  if (lang === 'css' || lang === 'scss') return tokenizeCss(line);
  if (lang === 'html' || lang === 'xml') return tokenizeHtml(line);
  if (lang === 'markdown') return tokenizeMarkdown(line);

  return tokenizeJsLike(line, keywords, lang);
}

function tokenizeJsLike(line: string, keywords: Set<string>, lang: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];

    // Line comment //
    if (c === '/' && line[i + 1] === '/') {
      tokens.push({ type: 'comment', value: line.slice(i) });
      break;
    }
    // Block comment start (treat as comment to end of line — multi-line handled by caller)
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end >= 0) {
        tokens.push({ type: 'comment', value: line.slice(i, end + 2) });
        i = end + 2;
        continue;
      }
      tokens.push({ type: 'comment', value: line.slice(i) });
      break;
    }

    // Strings (single, double, backtick)
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === c) { j++; break; }
        j++;
      }
      tokens.push({ type: 'string', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(c) && (i === 0 || !/[a-zA-Z_]/.test(line[i - 1]))) {
      let j = i;
      while (j < n && /[0-9._a-fA-FxX]/.test(line[j])) j++;
      tokens.push({ type: 'number', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Regex (very rough) — only after =, (, ,, :, [, return
    if (c === '/' && i + 1 < n && line[i + 1] !== '/' && line[i + 1] !== '*') {
      const prev = lastNonSpaceToken(tokens);
      if (!prev || prev.type === 'operator' || prev.type === 'punctuation' || (prev.type === 'keyword' && (prev.value === 'return' || prev.value === 'case'))) {
        let j = i + 1;
        while (j < n) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === '/') { j++; break; }
          j++;
        }
        // flags
        while (j < n && /[gimsuy]/.test(line[j])) j++;
        if (j > i + 1) {
          tokens.push({ type: 'regex', value: line.slice(i, j) });
          i = j;
          continue;
        }
      }
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      // function call: next non-space is (
      let k = j;
      while (k < n && /\s/.test(line[k])) k++;
      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (line[k] === '(') {
        tokens.push({ type: 'function', value: word });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ type: 'type', value: word });
      } else {
        tokens.push({ type: 'variable', value: word });
      }
      i = j;
      continue;
    }

    // Punctuation
    if (/[{}()\[\];,.:]/.test(c)) {
      tokens.push({ type: 'punctuation', value: c });
      i++;
      continue;
    }
    // Operators
    if (/[+\-*/%=<>!&|^~?]/.test(c)) {
      let j = i;
      while (j < n && /[+\-*/%=<>!&|^~?]/.test(line[j])) j++;
      tokens.push({ type: 'operator', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Whitespace / anything else
    tokens.push({ type: 'variable', value: c });
    i++;
  }
  return tokens;
}

function lastNonSpaceToken(tokens: Token[]): Token | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].value.trim() !== '') return tokens[i];
  }
  return undefined;
}

function tokenizeCss(line: string): Token[] {
  const tokens: Token[] = [];
  // Comment
  const cIdx = line.indexOf('/*');
  if (cIdx >= 0) {
    const end = line.indexOf('*/', cIdx + 2);
    const seg = end >= 0 ? line.slice(cIdx, end + 2) : line.slice(cIdx);
    tokens.push(...tokenizeCss(line.slice(0, cIdx)));
    tokens.push({ type: 'comment', value: seg });
    return tokens;
  }
  // Selector vs declaration: split on first {
  const braceIdx = line.indexOf('{');
  const colonIdx = line.indexOf(':');
  if (braceIdx >= 0 && (colonIdx < 0 || colonIdx > braceIdx)) {
    // selector
    tokens.push({ type: 'tag', value: line.slice(0, braceIdx) });
    tokens.push({ type: 'punctuation', value: '{' });
    tokens.push(...tokenizeCss(line.slice(braceIdx + 1)));
    return tokens;
  }
  if (colonIdx >= 0) {
    tokens.push({ type: 'property', value: line.slice(0, colonIdx) });
    tokens.push({ type: 'punctuation', value: ':' });
    const rest = line.slice(colonIdx + 1);
    // value: numbers / strings / identifiers
    const parts = rest.match(/(["'][^"']*["'])|(\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?)|([a-zA-Z_-][a-zA-Z0-9_-]*)|(\s+)|([^\s])/g) || [];
    for (const p of parts) {
      if (/^["']/.test(p)) tokens.push({ type: 'string', value: p });
      else if (/^\d/.test(p)) tokens.push({ type: 'number', value: p });
      else if (/^[a-zA-Z_-]/.test(p)) {
        if (CSS_KEYWORDS.has(p)) tokens.push({ type: 'keyword', value: p });
        else tokens.push({ type: 'variable', value: p });
      } else if (/^\s/.test(p)) tokens.push({ type: 'variable', value: p });
      else tokens.push({ type: 'punctuation', value: p });
    }
    return tokens;
  }
  return [{ type: 'variable', value: line }];
}

function tokenizeHtml(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (line[i] === '<') {
      // comment?
      if (line.startsWith('<!--', i)) {
        const end = line.indexOf('-->', i + 4);
        const seg = end >= 0 ? line.slice(i, end + 3) : line.slice(i);
        tokens.push({ type: 'comment', value: seg });
        i += seg.length;
        continue;
      }
      const end = line.indexOf('>', i);
      const seg = end >= 0 ? line.slice(i, end + 1) : line.slice(i);
      // tokenize inside tag
      const inner = seg.slice(1, seg.endsWith('/>') ? -2 : -1);
      tokens.push({ type: 'punctuation', value: '<' });
      const m = inner.match(/^\/?([a-zA-Z0-9]+)/);
      if (m) {
        if (inner.startsWith('/')) tokens.push({ type: 'punctuation', value: '/' });
        tokens.push({ type: 'tag', value: m[1] });
      }
      let rest = inner.slice(m ? m[0].length : 0);
      const attrRe = /([a-zA-Z-:]+)(=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(rest)) !== null) {
        tokens.push({ type: 'variable', value: ' ' });
        tokens.push({ type: 'attr', value: am[1] });
        tokens.push({ type: 'operator', value: '=' });
        tokens.push({ type: 'string', value: am[3] });
      }
      rest = rest.slice(attrRe.lastIndex);
      if (rest.trim()) tokens.push({ type: 'variable', value: rest });
      tokens.push({ type: 'punctuation', value: seg.endsWith('/>') ? '/>' : '>' });
      i += seg.length;
      continue;
    }
    // text until next <
    const next = line.indexOf('<', i);
    const text = next >= 0 ? line.slice(i, next) : line.slice(i);
    tokens.push({ type: 'variable', value: text });
    i += text.length;
  }
  return tokens;
}

function tokenizeMarkdown(line: string): Token[] {
  // headings, bold, italic, code, links, lists
  if (/^#{1,6}\s/.test(line)) {
    return [{ type: 'keyword', value: line }];
  }
  if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
    return [{ type: 'operator', value: line }];
  }
  if (/^>/.test(line)) {
    return [{ type: 'comment', value: line }];
  }
  // inline code
  const tokens: Token[] = [];
  const parts = line.split(/(`[^`]+`)/);
  for (const p of parts) {
    if (p.startsWith('`')) tokens.push({ type: 'string', value: p });
    else tokens.push({ type: 'variable', value: p });
  }
  return tokens;
}

/** Render a line of code as highlighted React nodes. */
export function highlightLine(line: string, lang: string): ReactNode[] {
  if (!line) return [<span key="e">{'\u00A0'}</span>];
  const tokens = tokenizeLine(line, lang);
  return tokens.map((t, idx) => (
    <span key={idx} style={{ color: TOKEN_COLORS[t.type] }}>
      {t.value}
    </span>
  ));
}

// ────────────────────────────────────────────────────────────────────────────
// File icon + color by extension
// ────────────────────────────────────────────────────────────────────────────

import {
  File as FileIcon, FileCode, FileJson, FileText, FileType, Braces,
  Hash, Image as ImageIcon, FileTerminal, Settings, Box, BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface FileIconInfo {
  icon: LucideIcon;
  color: string;
}

export function fileIconFor(name: string): FileIconInfo {
  const ext = name.match(/\.([a-zA-Z0-9]+)$/)?.[1].toLowerCase() ?? '';
  if (name === 'package.json') return { icon: Box, color: JARVIS.colors.red };
  if (name === 'tsconfig.json' || name.startsWith('tsconfig.')) return { icon: Settings, color: JARVIS.colors.cyan };
  if (name === '.gitignore' || name === '.dockerignore') return { icon: FileTerminal, color: JARVIS.colors.textMute };
  if (name.startsWith('.eslintrc') || name.startsWith('.prettierrc') || name.startsWith('.babelrc')) return { icon: Settings, color: JARVIS.colors.violet };
  if (name === 'README.md' || name === 'README') return { icon: BookOpen, color: JARVIS.colors.cyan };
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return { icon: FileType, color: JARVIS.colors.cyan };
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { icon: FileCode, color: JARVIS.colors.amber };
    case 'json':
      return { icon: FileJson, color: JARVIS.colors.amber };
    case 'css':
    case 'scss':
      return { icon: Hash, color: JARVIS.colors.violet };
    case 'md':
    case 'mdx':
      return { icon: BookOpen, color: JARVIS.colors.textDim };
    case 'html':
      return { icon: FileCode, color: JARVIS.colors.red };
    case 'py':
      return { icon: FileCode, color: JARVIS.colors.green };
    case 'go':
      return { icon: FileCode, color: JARVIS.colors.cyan };
    case 'rs':
      return { icon: FileCode, color: JARVIS.colors.amber };
    case 'sh':
    case 'bash':
      return { icon: FileTerminal, color: JARVIS.colors.green };
    case 'yml':
    case 'yaml':
      return { icon: Braces, color: JARVIS.colors.violet };
    case 'sql':
      return { icon: FileCode, color: JARVIS.colors.amber };
    case 'prisma':
      return { icon: Braces, color: JARVIS.colors.cyan };
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return { icon: ImageIcon, color: JARVIS.colors.violet };
    case 'env':
    case 'ini':
      return { icon: Settings, color: JARVIS.colors.amber };
    default:
      if (!ext) return { icon: FileText, color: JARVIS.colors.textDim };
      return { icon: FileText, color: JARVIS.colors.text };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Git status badge helper
// ────────────────────────────────────────────────────────────────────────────

export function gitStatusBadge(status: string): { label: string; color: string } | null {
  switch (status) {
    case 'modified': return { label: 'M', color: JARVIS.colors.amber };
    case 'added': return { label: 'A', color: JARVIS.colors.green };
    case 'deleted': return { label: 'D', color: JARVIS.colors.red };
    case 'untracked': return { label: 'U', color: JARVIS.colors.violet };
    default: return null;
  }
}
