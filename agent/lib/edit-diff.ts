/**
 * Edit application + diff helpers for edit_file.
 *
 * Ported (and trimmed) from pi's `harness/tools/edit-diff.ts`. Key behaviors
 * the previous edit_file lacked:
 *  - preserves a UTF-8 BOM and the file's original line endings (CRLF/LF)
 *  - falls back to a *fuzzy* match when the exact oldText isn't found: trailing
 *    whitespace is stripped and Unicode smart-quotes / dashes / spaces are
 *    normalized to ASCII. This rescues edits where the model slightly misquoted
 *    the file without silently corrupting it.
 *  - detects overlapping edits and refuses them (instead of applying them in
 *    sequence and mangling the file)
 *  - emits a compact unified-style diff so the model can verify what landed
 *
 * Unlike pi, this version keeps the existing `allowMultiple` capability and
 * produces its diff without an external dependency (common prefix/suffix trim).
 */

export interface Edit {
  oldText: string;
  newText: string;
  allowMultiple?: boolean;
}

export interface AppliedEditsResult {
  baseContent: string;
  newContent: string;
  usedFuzzyMatch: boolean;
  /** Number of replacements actually applied (>= edits.length when allowMultiple). */
  appliedCount: number;
}

// --- line endings + BOM -----------------------------------------------------

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

// --- fuzzy normalization ----------------------------------------------------

/**
 * Normalize text for fuzzy matching: NFKC, strip trailing whitespace per line,
 * smart quotes → ASCII, Unicode dashes → `-`, special spaces → regular space.
 */
export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

export interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  /** Content to perform replacements against (normalized when fuzzy). */
  contentForReplacement: string;
}

/** Try exact match first; fall back to a fuzzy-normalized match. */
export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content };
  }
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
  if (fuzzyIndex === -1) {
    return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content };
  }
  return { found: true, index: fuzzyIndex, matchLength: fuzzyOldText.length, usedFuzzyMatch: true, contentForReplacement: fuzzyContent };
}

function findAllIndices(content: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = content.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = content.indexOf(needle, i + needle.length);
  }
  return out;
}

interface FindAllResult {
  found: boolean;
  indices: number[];
  matchLength: number;
  usedFuzzyMatch: boolean;
}

/** Like fuzzyFindText but returns every occurrence (for allowMultiple). */
function fuzzyFindAll(content: string, oldText: string): FindAllResult {
  if (content.includes(oldText)) {
    return { found: true, indices: findAllIndices(content, oldText), matchLength: oldText.length, usedFuzzyMatch: false };
  }
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  if (!fuzzyContent.includes(fuzzyOldText)) {
    return { found: false, indices: [], matchLength: 0, usedFuzzyMatch: false };
  }
  return { found: true, indices: findAllIndices(fuzzyContent, fuzzyOldText), matchLength: fuzzyOldText.length, usedFuzzyMatch: true };
}

// --- replacement application (with unchanged-line preservation) -------------

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

interface LineSpan {
  start: number;
  end: number;
}

function getLineSpans(content: string): LineSpan[] {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

interface TextReplacement {
  matchIndex: number;
  matchLength: number;
  newText: string;
}

function getReplacementLineRange(lines: LineSpan[], r: TextReplacement): { startLine: number; endLine: number } {
  const start = r.matchIndex;
  const end = r.matchIndex + r.matchLength;
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start >= lines[i].start && start < lines[i].end) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) throw new Error("Replacement range is outside the base content.");
  let endLine = startLine;
  while (endLine < lines.length && lines[endLine].end < end) endLine++;
  if (endLine >= lines.length) throw new Error("Replacement range is outside the base content.");
  return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content: string, replacements: TextReplacement[], offset = 0): string {
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    const idx = r.matchIndex - offset;
    result = result.substring(0, idx) + r.newText + result.substring(idx + r.matchLength);
  }
  return result;
}

/**
 * Apply replacements matched against `baseContent` (a normalized view) onto
 * `originalContent`, copying unchanged line blocks from the original so the
 * file's original bytes are preserved outside the edited regions.
 */
function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: TextReplacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error("Cannot preserve unchanged lines: base content line count changed.");
  }
  const sorted = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex);
  const groups: Array<{ startLine: number; endLine: number; replacements: TextReplacement[] }> = [];
  for (const r of sorted) {
    const range = getReplacementLineRange(baseLines, r);
    const current = groups[groups.length - 1];
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(r);
      continue;
    }
    groups.push({ ...range, replacements: [r] });
  }
  let originalLineIndex = 0;
  let result = "";
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");
    const groupStartOffset = baseLines[group.startLine].start;
    const groupEndOffset = baseLines[group.endLine - 1].end;
    result += applyReplacements(baseContent.slice(groupStartOffset, groupEndOffset), group.replacements, groupStartOffset);
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join("");
  return result;
}

// --- error messages ---------------------------------------------------------

function notFoundError(path: string, i: number, total: number): Error {
  return total === 1
    ? new Error(`oldText was not found in ${path}. It must match exactly (including whitespace/newlines). Read the file again to refresh.`)
    : new Error(`edits[${i}].oldText was not found in ${path}. It must match exactly (including whitespace/newlines). File is unchanged.`);
}

function duplicateError(path: string, i: number, total: number, occurrences: number): Error {
  return total === 1
    ? new Error(`oldText matches ${occurrences} times in ${path}. Make it more specific/unique, or set allowMultiple: true. File is unchanged.`)
    : new Error(`edits[${i}].oldText matches ${occurrences} times in ${path}. Make it more specific/unique, or set allowMultiple: true. File is unchanged.`);
}

function emptyError(path: string, i: number, total: number): Error {
  return total === 1 ? new Error(`oldText must not be empty in ${path}.`) : new Error(`edits[${i}].oldText must not be empty in ${path}.`);
}

function noChangeError(path: string, total: number): Error {
  return total === 1
    ? new Error(`No changes made to ${path}: the replacement produced identical content. Check for special characters or that the text exists as expected.`)
    : new Error(`No changes made to ${path}: the replacements produced identical content.`);
}

// --- the main entry point ---------------------------------------------------

interface MatchedEdit extends TextReplacement {
  editIndex: number;
}

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * All edits are matched against the *same* original content (not
 * incrementally). Replacements are applied in reverse order so offsets stay
 * stable. If any edit needs fuzzy matching, the operation runs in
 * fuzzy-normalized space and the line-level changes are overlaid onto the
 * original so unchanged lines keep their original bytes.
 */
export function applyEditsToNormalizedContent(normalizedContent: string, edits: Edit[], path: string): AppliedEditsResult {
  const normalizedEdits = edits.map((e) => ({ oldText: normalizeToLF(e.oldText), newText: normalizeToLF(e.newText), allowMultiple: e.allowMultiple }));
  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) throw emptyError(path, i, normalizedEdits.length);
  }

  const usedFuzzyMatch = normalizedEdits.some((e) => !normalizedContent.includes(e.oldText) && fuzzyFindText(normalizedContent, e.oldText).usedFuzzyMatch);
  const replacementBase = usedFuzzyMatch ? normalizeForFuzzyMatch(normalizedContent) : normalizedContent;

  const matched: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const m = fuzzyFindAll(replacementBase, edit.oldText);
    if (!m.found) throw notFoundError(path, i, normalizedEdits.length);
    const occurrences = m.indices.length;
    if (occurrences > 1 && !edit.allowMultiple) throw duplicateError(path, i, normalizedEdits.length, occurrences);
    for (const idx of m.indices) {
      matched.push({ editIndex: i, matchIndex: idx, matchLength: m.matchLength, newText: edit.newText });
    }
  }

  matched.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1];
    const cur = matched[i];
    if (prev.matchIndex + prev.matchLength > cur.matchIndex) {
      throw new Error(`edits[${prev.editIndex}] and edits[${cur.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions. File is unchanged.`);
    }
  }

  const baseContent = normalizedContent;
  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBase, matched)
    : applyReplacements(replacementBase, matched);

  if (baseContent === newContent) throw noChangeError(path, normalizedEdits.length);
  return { baseContent, newContent, usedFuzzyMatch, appliedCount: matched.length };
}

// --- compact, dependency-free diff -----------------------------------------

export interface DiffResult {
  diff: string;
  firstChangedLine: number | undefined;
}

/**
 * Produce a compact unified-style diff via common prefix/suffix line trimming.
 * Good enough to verify surgical edits without pulling in a diff dependency.
 * Output is capped to `maxDiffLines` lines so a huge rewrite can't flood context.
 */
export function generateCompactDiff(oldContent: string, newContent: string, contextLines = 4, maxDiffLines = 80): DiffResult {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  let prefix = 0;
  const minPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < minPrefix && oldLines[prefix] === newLines[prefix]) prefix++;

  let suffix = 0;
  const minSuffix = Math.min(oldLines.length - prefix, newLines.length - prefix);
  while (suffix < minSuffix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;

  const oldStart = prefix;
  const oldEnd = oldLines.length - suffix;
  const newStart = prefix;
  const newEnd = newLines.length - suffix;

  if (oldEnd === oldStart && newEnd === newStart) return { diff: "(no textual difference)", firstChangedLine: undefined };

  const width = String(Math.max(oldEnd, newEnd, 1)).length;
  const out: string[] = [];
  const ctxBefore = Math.min(contextLines, prefix);
  for (let i = prefix - ctxBefore; i < prefix; i++) out.push(` ${String(i + 1).padStart(width)} ${oldLines[i]}`);
  for (let i = oldStart; i < oldEnd; i++) out.push(`-${String(i + 1).padStart(width)} ${oldLines[i]}`);
  for (let i = newStart; i < newEnd; i++) out.push(`+${String(i + 1).padStart(width)} ${newLines[i]}`);
  const ctxAfter = Math.min(contextLines, suffix);
  for (let i = 0; i < ctxAfter; i++) out.push(` ${String(newEnd + i + 1).padStart(width)} ${newLines[newEnd + i]}`);

  const trimmed = out.slice(0, maxDiffLines);
  if (out.length > maxDiffLines) trimmed.push(`… (${out.length - maxDiffLines} more diff lines)`);
  return { diff: trimmed.join("\n"), firstChangedLine: prefix + 1 };
}
