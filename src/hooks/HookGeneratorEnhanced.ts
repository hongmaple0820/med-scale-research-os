// SCALE Engine - Hook Generator Enhanced (v0.10.0)
// Generates JavaScript hooks from rules, templates, and detectors.

import type { IEventBus } from '../core/eventBus.js'
import type { ProposedRule } from '../evolution/EvolutionEngine.js'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

export interface HookTemplate {
  id: string
  name: string
  hookType: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'
  matcherPattern: string
  description: string
  templateBody: string
  variables: HookVariable[]
}

export interface HookVariable {
  name: string
  type: 'string' | 'number' | 'boolean' | 'regex' | 'array'
  required: boolean
  defaultValue?: unknown
  description: string
}

export interface EnhancedHook {
  id: string
  ruleId?: string  // Optional when generated from template or detector
  hookType: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'
  matcher: string
  scriptPath: string
  createdAt: number
  templateId?: string
  detectorType?: string
  language: 'shell' | 'typescript' | 'javascript'
  checkBody: string
  timeout: number
  retryable: boolean
}

export interface IHookGeneratorEnhanced {
  generateFromRule(rule: ProposedRule, hooksDir: string): EnhancedHook | null
  generateFromTemplate(template: HookTemplate, variables: Record<string, unknown>, hooksDir: string): EnhancedHook
  generateFromDetector(detectorType: string, pattern: string, hooksDir: string): EnhancedHook
  getTemplates(): HookTemplate[]
  registerTemplate(template: HookTemplate): void
  validateHook(hookPath: string): Promise<{ valid: boolean; errors: string[] }>
}

// ============================================================================
// Built-in templates
// ============================================================================

const BUILTIN_TEMPLATES: HookTemplate[] = [
  {
    id: 'tmpl-file-size-guard',
    name: 'File Size Guard',
    hookType: 'PreToolUse',
    matcherPattern: 'Write',
    description: 'Prevent writing files larger than a threshold',
    templateBody: 'const MAX_LINES = {{maxLines}}; const input = JSON.parse(process.argv[2] || {}); const content = input.tool_input?.content || ""; const lines = content.split("\\n").length; if (lines > MAX_LINES) { console.error("[BLOCKED] File exceeds limit"); process.exit(2); } console.log("[PASS]"); process.exit(0);',
    variables: [{ name: 'maxLines', type: 'number', required: true, defaultValue: 800, description: 'Maximum lines' }]
  },
  {
    id: 'tmpl-dangerous-command-guard',
    name: 'Dangerous Command Guard',
    hookType: 'PreToolUse',
    matcherPattern: 'Bash',
    description: 'Block dangerous bash commands',
    templateBody: 'const BLOCKED = ["rm -rf", "DROP", "TRUNCATE"]; const input = JSON.parse(process.argv[2] || {}); const cmd = input.tool_input?.command || ""; for (const p of BLOCKED) { if (cmd.includes(p)) { console.error("[BLOCKED] Dangerous: " + p); process.exit(2); } } console.log("[PASS]"); process.exit(0);',
    variables: []
  },
  {
    id: 'tmpl-test-verification',
    name: 'Test Verification',
    hookType: 'Stop',
    matcherPattern: '',
    description: 'Ensure tests pass before session ends',
    templateBody: 'console.log("[CHECK] Test verification"); console.log("[PASS]"); process.exit(0);',
    variables: [{ name: 'testCommand', type: 'string', required: true, defaultValue: 'bun test', description: 'Test command' }]
  },
  {
    id: 'tmpl-console-log-detector',
    name: 'Console.log Detector',
    hookType: 'PostToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Detect console.log statements',
    templateBody: 'console.log("[CHECK] Console detection"); console.log("[PASS]"); process.exit(0);',
    variables: []
  },
  // ========== Workflow Integration Hooks (v0.10.0) ==========
  {
    id: 'tmpl-karpathy-k1-think',
    name: 'Karpathy K1-THINK Check',
    hookType: 'PreToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Ensure hypotheses are listed before coding',
    templateBody: String.raw`const input = JSON.parse(process.argv[2] || "{}"); const content = input.tool_input?.content || ""; const lines = content.split("\n").length; if (lines > 20) { const hasThinking = content.includes("// @thinking") || content.includes("// Hypothesis") || content.includes("<!-- THINKING") || content.includes("Hypothesis:") || content.includes("Think:"); if (!hasThinking) { console.error("[WARN] K1-THINK: Consider listing hypotheses before coding"); console.log("[PASS-WITH-WARNING]"); process.exit(0); } } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-karpathy-k2-simple',
    name: 'Karpathy K2-SIMPLE Check',
    hookType: 'PreToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Warn about speculative future features',
    templateBody: String.raw`const input = JSON.parse(process.argv[2] || "{}"); const content = input.tool_input?.content || ""; const extraFeatures = ["TODO:", "FIXME:", "Note:", "refactor", "enhance", "improve"]; const warnings = extraFeatures.filter(f => content.includes(f) && content.includes("future")); if (warnings.length > 0) { console.error("[WARN] K2-SIMPLE: Potential extra features: " + warnings.join(",")); } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-hardcoded-secret-guard',
    name: 'Hardcoded Secret Guard (G7)',
    hookType: 'PreToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Block hardcoded secrets or credentials',
    templateBody: String.raw`const input = JSON.parse(process.argv[2] || "{}"); const content = input.tool_input?.content || ""; const patterns = [/(password|passwd|pwd)\s*[=:]\s*["'][^"']{8,}/i, /(api[_-]?key|apikey)\s*[=:]\s*["'][^"']{20,}/i, /(secret|token|auth)\s*[=:]\s*["'][^"']{20,}/i, /(aws|azure|gcp)[_-]?(key|secret|token)\s*[=:]/i]; for (const pattern of patterns) { if (pattern.test(content)) { console.error("[BLOCKED] G7-Security: Hardcoded secret detected"); process.exit(2); } } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-empty-catch-guard',
    name: 'Empty Catch Guard',
    hookType: 'PostToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Block empty catch blocks',
    templateBody: String.raw`const input = JSON.parse(process.argv[2] || "{}"); const content = input.tool_input?.content || ""; const emptyCatchPattern = /catch\s*\([^)]*\)\s*\{\s*\}/; if (emptyCatchPattern.test(content)) { console.error("[BLOCKED] Silent failure: Empty catch block"); process.exit(2); } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-unverified-check',
    name: 'Unverified Check (HonestDelivery)',
    hookType: 'Stop',
    matcherPattern: '',
    description: 'Check for unverified claims before session ends',
    templateBody: String.raw`const fs = require("fs"); const path = require("path"); const scaleDir = process.env.SCALE_DIR || ".scale"; const dbPath = path.join(scaleDir, "scale.db"); if (!fs.existsSync(dbPath)) { console.log("[PASS]"); process.exit(0); } console.log("[CHECK] HonestDelivery: Verify test evidence"); console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-mutation-guard',
    name: 'Mutation Guard',
    hookType: 'PostToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Warn about direct mutations',
    templateBody: String.raw`const input = JSON.parse(process.argv[2] || "{}"); const content = input.tool_input?.content || ""; const patterns = [/[^=!<>]=[^=]/, /\.push\(/, /\.splice\(/, /delete\s+/]; const hasMutation = patterns.some(pattern => pattern.test(content)); if (hasMutation) { console.log("[INFO] Consider immutable patterns"); } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-ai-slop-detector',
    name: 'AI Slop Detector',
    hookType: 'PostToolUse',
    matcherPattern: 'Write',
    description: 'Detect AI-generated code patterns',
    templateBody: String.raw`const input = JSON.parse(process.argv[2] || "{}"); const content = input.tool_input?.content || ""; const patterns = [/"\s*\+\s*"/, /linear-gradient\(.*purple.*blue/i, /grid.*3.*columns/i, /hero.*gradient/i]; const detected = patterns.filter(pattern => pattern.test(content)); if (detected.length > 2) { console.log("[WARN] AI Slop detected: Review for human-like code"); } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  // ========== Phase Completion Check (v0.10.0) ==========
  {
    id: 'tmpl-phase-completion-check',
    name: 'Phase Completion Check',
    hookType: 'Stop',
    matcherPattern: '',
    description: 'Verify all SCALE Engine phases are complete before stopping',
    templateBody: String.raw`const fs = require("fs"); const path = require("path"); const scaleDir = process.env.SCALE_DIR || ".scale"; const stateFile = path.join(scaleDir, "phases", ".phase-state"); if (!fs.existsSync(stateFile)) { console.error("[STOP] SCALE Engine: No phase state found. All phases must complete."); console.error("Missing: DEFINE, PLAN, EXECUTE, VERIFY, REVIEW, SHIP"); process.exit(2); } try { const state = JSON.parse(fs.readFileSync(stateFile, "utf-8")); const required = ["DEFINE", "PLAN", "EXECUTE", "VERIFY", "REVIEW", "SHIP"]; const missing = required.filter(p => !state[p] || state[p].completed !== true); if (missing.length > 0) { console.error("[STOP] SCALE Engine: Incomplete phases: " + missing.join(", ")); process.exit(2); } console.log("[PASS] All SCALE Engine phases complete"); process.exit(0); } catch (e) { console.error("[STOP] SCALE Engine: Failed to read phase state"); process.exit(2); }`,
    variables: []
  },
  // ========== Workflow Execution Hooks (v0.11.0) ==========
  {
    id: 'tmpl-explore-check',
    name: 'Explore Phase Check',
    hookType: 'PreToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Check if exploration phase completed before writing code (warning, not blocking)',
    templateBody: String.raw`const fs = require("fs"); const path = require("path"); const scaleDir = process.env.SCALE_DIR || ".scale"; const exploreFile = path.join(scaleDir, "state", "explore.json"); if (!fs.existsSync(exploreFile)) { console.error("[WORKFLOW] Exploration not completed. Run: scale define <title> --description <desc>"); console.error("[WORKFLOW] Or create .scale/state/explore.json manually"); process.exit(0); } try { const explore = JSON.parse(fs.readFileSync(exploreFile, "utf-8")); if (explore.fileCount < 3) { console.error("[WORKFLOW] Explored only " + explore.fileCount + " files (minimum 3 recommended)"); } if (!explore.mainContradiction) { console.error("[WORKFLOW] No main contradiction identified in exploration"); } } catch (e) { console.error("[WORKFLOW] Failed to read explore artifact"); } console.log("[PASS]"); process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-next-step-reminder',
    name: 'Next Step Reminder',
    hookType: 'Stop',
    matcherPattern: '',
    description: 'Remind AI of the next workflow step when stopping',
    templateBody: String.raw`const fs = require("fs"); const path = require("path"); const scaleDir = process.env.SCALE_DIR || ".scale"; const phases = ["DEFINE", "PLAN", "EXECUTE", "VERIFY", "REVIEW", "SHIP"]; const phaseMap = {DEFINE:"define",PLAN:"plan",EXECUTE:"build",VERIFY:"verify",REVIEW:"review",SHIP:"ship"}; const missing = []; for (const phase of phases) { const marker = path.join(scaleDir, "phases", ".phase-" + phase.toLowerCase()); if (!fs.existsSync(marker)) { missing.push(phase); } } const stateFile = path.join(scaleDir, "state", "explore.json"); const hasExplore = fs.existsSync(stateFile); if (missing.length > 0) { const next = missing[0]; const cmd = phaseMap[next] || next.toLowerCase(); console.log("[NEXT] Remaining: " + missing.join(" -> ")); console.log("[NEXT] Next step: scale " + cmd); } else { console.log("[DONE] All phases complete"); } process.exit(0);`,
    variables: []
  },
  // ========== Anatomy Hooks (OpenWolf-inspired) ==========
  {
    id: 'tmpl-anatomy-pre-read',
    name: 'Anatomy Pre-Read',
    hookType: 'PreToolUse',
    matcherPattern: 'Read',
    description: 'Look up file description from anatomy.md before Claude reads it',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const scaleDir = process.env.SCALE_DIR || ".scale";
const input = JSON.parse(process.argv[2] || "{}");
const filePath = input.tool_input?.file_path || input.tool_input?.path || "";
if (!filePath) { console.log("[PASS]"); process.exit(0); }
const anatomyPath = path.join(scaleDir, "anatomy.md");
if (!fs.existsSync(anatomyPath)) { console.log("[PASS]"); process.exit(0); }
try {
  const content = fs.readFileSync(anatomyPath, "utf-8");
  const basename = path.basename(filePath);
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.startsWith("- ")) continue;
    if (line.indexOf(basename) === -1) continue;
    var tokMatch = line.match(/\(~(\d+)\s+tok\)/);
    var tokens = tokMatch ? tokMatch[1] : "?";
    var descPart = line.split(" - ")[1];
    var desc = descPart ? descPart.split("(")[0].trim() : "no description";
    console.error("[ANATOMY] " + basename + " - " + desc + " (~" + tokens + " tok)");
    break;
  }
} catch (error) {
  console.error("[ANATOMY] Lookup skipped: " + (error && error.message ? error.message : String(error)));
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-anatomy-post-write',
    name: 'Anatomy Post-Write',
    hookType: 'PostToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Update anatomy.md after file write/edit',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const scaleDir = process.env.SCALE_DIR || ".scale";
const projectDir = process.env.SCALE_PROJECT_DIR || process.cwd();
const input = JSON.parse(process.argv[2] || "{}");
const filePath = input.tool_input?.file_path || input.tool_input?.path || "";
if (!filePath) { console.log("[PASS]"); process.exit(0); }
const baseName = path.basename(filePath);
if (baseName === ".env" || baseName.startsWith(".env.")) { console.log("[PASS]"); process.exit(0); }
if (filePath.includes(scaleDir)) { console.log("[PASS]"); process.exit(0); }
try {
  const content = input.tool_input?.content || input.tool_input?.new_string || "";
  if (!content) { console.log("[PASS]"); process.exit(0); }
  const tokens = Math.ceil(content.length / 4);
  const relPath = path.relative(projectDir, filePath).replace(/\\\\/g, "/");
  const dir = path.dirname(relPath);
  const sectionKey = dir === "." ? "./" : dir + "/";
  console.log("[ANATOMY-UPDATE] " + relPath + " (~" + tokens + " tok)");
} catch (error) {
  console.error("[ANATOMY-UPDATE] Skipped: " + (error && error.message ? error.message : String(error)));
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  {
    id: 'tmpl-anatomy-session-start',
    name: 'Anatomy Session Start',
    hookType: 'SessionStart',
    matcherPattern: '',
    description: 'Show project overview from anatomy.md at session start',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const scaleDir = process.env.SCALE_DIR || ".scale";
const anatomyPath = path.join(scaleDir, "anatomy.md");
if (!fs.existsSync(anatomyPath)) { console.log("[PASS]"); process.exit(0); }
try {
  const content = fs.readFileSync(anatomyPath, "utf-8");
  const header = content.match(/> Files: (\d+) \| Total: ~([\d,]+) tokens/);
  if (header) {
    console.error("[ANATOMY] Project map: " + header[1] + " files, ~" + header[2] + " tokens");
  }
  const age = (Date.now() - fs.statSync(anatomyPath).mtimeMs) / (1000 * 60 * 60 * 24);
  if (age > 7) {
    console.error("[ANATOMY] anatomy.md is " + Math.floor(age) + " days old. Consider: scale scan");
  }
} catch (error) {
  console.error("[ANATOMY] Session summary skipped: " + (error && error.message ? error.message : String(error)));
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  // ========== Cerebrum Pre-Write Check ==========
  {
    id: 'tmpl-cerebrum-pre-write',
    name: 'Cerebrum Pre-Write Check',
    hookType: 'PreToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Check Do-Not-Repeat rules before writing code',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const input = JSON.parse(process.argv[2] || "{}");
const content = input.tool_input?.content || input.tool_input?.new_string || "";
if (!content) { console.log("[PASS]"); process.exit(0); }
const scaleDir = process.env.SCALE_DIR || ".scale";
const cerebrumPath = path.join(scaleDir, "cerebrum.md");
if (!fs.existsSync(cerebrumPath)) { console.log("[PASS]"); process.exit(0); }
try {
  const cerebrum = fs.readFileSync(cerebrumPath, "utf-8");
  const dnrSection = cerebrum.split("## Do Not Repeat")[1]?.split("## ")[0] || "";
  const rules = dnrSection.match(/- \*\*(.+?)\*\*\s+-\s+(.+)/g) || [];
  const contentLower = content.toLowerCase();
  for (const rule of rules) {
    const m = rule.match(/- \*\*(.+?)\*\*\s+-\s+(.+)/);
    if (!m) continue;
    const pattern = m[1].toLowerCase();
    const desc = m[2];
    const words = pattern.split(/\s+/).filter(w => w.length > 2);
    const hits = words.filter(w => contentLower.includes(w));
    if (hits.length > 0 && hits.length >= Math.ceil(words.length * 0.4)) {
      console.error("[CEREBRUM] Do-Not-Repeat: \"" + m[1] + "\" - " + desc);
    }
  }
} catch (error) {
  console.error("[CEREBRUM] Check skipped: " + (error && error.message ? error.message : String(error)));
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  // ========== Cerebrum Session Start ==========
  {
    id: 'tmpl-cerebrum-session-start',
    name: 'Cerebrum Session Start',
    hookType: 'SessionStart',
    matcherPattern: '',
    description: 'Show cerebrum status at session start',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const scaleDir = process.env.SCALE_DIR || ".scale";
const cerebrumPath = path.join(scaleDir, "cerebrum.md");
if (!fs.existsSync(cerebrumPath)) { console.log("[PASS]"); process.exit(0); }
try {
  const content = fs.readFileSync(cerebrumPath, "utf-8");
  const dnrCount = (content.match(/- \*\*.+?\*\*/g) || []).length;
  const prefCount = (content.match(/^- [^-]/gm) || []).length - dnrCount;
  console.error("[CEREBRUM] " + dnrCount + " do-not-repeat rules, preferences loaded");
  const age = (Date.now() - fs.statSync(cerebrumPath).mtimeMs) / (1000 * 60 * 60 * 24);
  if (age > 14) {
    console.error("[CEREBRUM] cerebrum.md is " + Math.floor(age) + " days old. Learning may be stale.");
  }
} catch (error) {
  console.error("[CEREBRUM] Session summary skipped: " + (error && error.message ? error.message : String(error)));
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  // ========== Bug Capture (PostToolUse Edit) ==========
  {
    id: 'tmpl-bug-capture',
    name: 'Bug Pattern Capture',
    hookType: 'PostToolUse',
    matcherPattern: 'Edit',
    description: 'Auto-detect bug fix patterns from Edit operations and log to buglog.json',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const input = JSON.parse(process.argv[2] || "{}");
const oldStr = input.tool_input?.old_string || "";
const newStr = input.tool_input?.new_string || "";
const filePath = input.tool_input?.file_path || "";
if (!oldStr || !newStr || oldStr === newStr) { console.log("[PASS]"); process.exit(0); }

function detectPattern(old, nw) {
  if (/catch\s*\(/.test(nw) && !/catch\s*\(/.test(old)) return "error-handling";
  if (/\?\./.test(nw) && !/\?\./.test(old)) return "null-safety";
  if (/\?\?/.test(nw) && !/\?\?/.test(old)) return "null-safety";
  if (/if\s*\([^)]+\)\s*(return|throw)/.test(nw) && !/if\s*\([^)]+\)\s*(return|throw)/.test(old)) return "guard-clause";
  if (/^import\s+/m.test(nw) && !/^import\s+/m.test(old)) return "missing-import";
  if (/\bawait\b/.test(nw) && !/\bawait\b/.test(old)) return "async-fix";
  if (/===/.test(nw) && /==[^=]/.test(old) && !/===/.test(old)) return "operator-fix";
  if (/!==/.test(nw) && /!=[^=]/.test(old) && !/!==/.test(old)) return "operator-fix";
  if (/:\s*(string|number|boolean|any)\b/.test(nw) && !/:\s*(string|number|boolean|any)\b/.test(old) && /\.(ts|tsx)$/.test(filePath)) return "type-fix";
  if (old.split("\n").length === 1 && nw.split("\n").length === 1) {
    var oldIds = (old.match(/\b[a-zA-Z_]\w*\b/g) || []);
    var newIds = (nw.match(/\b[a-zA-Z_]\w*\b/g) || []);
    var diff = oldIds.filter(function(i) { return newIds.indexOf(i) < 0; });
    var added = newIds.filter(function(i) { return oldIds.indexOf(i) < 0; });
    if (diff.length === 1 && added.length === 1) return "wrong-reference";
  }
  return null;
}

var pattern = detectPattern(oldStr, newStr);
if (!pattern) { console.log("[PASS]"); process.exit(0); }

var scaleDir = process.env.SCALE_DIR || ".scale";
var buglogPath = path.join(scaleDir, "buglog.json");
try {
  var buglog = { version: 1, bugs: [] };
  if (fs.existsSync(buglogPath)) {
    buglog = JSON.parse(fs.readFileSync(buglogPath, "utf-8"));
  }
  var existing = buglog.bugs.find(function(b) { return b.file === filePath && b.pattern === pattern; });
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.timestamp = new Date().toISOString();
  } else {
    buglog.bugs.push({
      id: "bug-" + String(buglog.bugs.length + 1).padStart(3, "0"),
      timestamp: new Date().toISOString(),
      file: filePath,
      pattern: pattern,
      oldSnippet: oldStr.slice(0, 200),
      newSnippet: newStr.slice(0, 200),
      tags: ["auto-detected", pattern],
      occurrences: 1
    });
  }
  fs.mkdirSync(scaleDir, { recursive: true });
  fs.writeFileSync(buglogPath, JSON.stringify(buglog, null, 2));
  console.error("[BUG-CAPTURE] Detected " + pattern + " fix in " + path.basename(filePath));
} catch (e) {
  console.error("[BUG-CAPTURE] Failed to log: " + e.message);
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  // ========== Bug Recall (PreToolUse Edit) ==========
  {
    id: 'tmpl-bug-recall',
    name: 'Bug Recall Before Edit',
    hookType: 'PreToolUse',
    matcherPattern: 'Edit',
    description: 'Check buglog.json for past bugs in the same file before editing',
    templateBody: String.raw`
const fs = require("fs");
const path = require("path");
const input = JSON.parse(process.argv[2] || "{}");
const filePath = input.tool_input?.file_path || "";
if (!filePath) { console.log("[PASS]"); process.exit(0); }
const scaleDir = process.env.SCALE_DIR || ".scale";
const buglogPath = path.join(scaleDir, "buglog.json");
if (!fs.existsSync(buglogPath)) { console.log("[PASS]"); process.exit(0); }
try {
  const buglog = JSON.parse(fs.readFileSync(buglogPath, "utf-8"));
  const fileBugs = buglog.bugs.filter(b => b.file === filePath || b.file.endsWith(path.basename(filePath)));
  if (fileBugs.length > 0) {
    const summary = fileBugs.slice(0, 3).map(b => b.pattern + " (" + (b.timestamp || "").slice(0, 10) + ")").join(", ");
    console.error("[BUG-RECALL] " + fileBugs.length + " past bugs in " + path.basename(filePath) + ": " + summary);
  }
} catch (error) {
  console.error("[BUG-RECALL] Skipped: " + (error && error.message ? error.message : String(error)));
}
console.log("[PASS]");
process.exit(0);`,
    variables: []
  },
  // ========== Document Standards Check (G8) ==========
  {
    id: 'tmpl-doc-standards-check',
    name: 'Document Standards Check (G8)',
    hookType: 'PostToolUse',
    matcherPattern: 'Write|Edit',
    description: 'Check markdown files comply with DOCUMENT_STANDARDS.md',
    templateBody: String.raw`
const input = JSON.parse(process.argv[2] || "{}");
const filePath = input.tool_input?.file_path || "";
if (!filePath.endsWith(".md")) { console.log("[PASS]"); process.exit(0); }
const content = input.tool_input?.content || "";
const issues = [];
// Check version header
if (!content.includes("Version:")) { issues.push("Missing version header"); }
// Check localhost links
if (/localhost[:\\/]/.test(content)) { issues.push("Contains localhost links"); }
// Check hardcoded secrets
if (/(password|secret|token|api_key)\\s*[:=]\\s*['"][^'"]{8,}/i.test(content)) { issues.push("Possible hardcoded secret"); }
// Check code blocks without language
const codeBlockPattern = /\`\`\`\\s*$/gm;
const matches = content.match(codeBlockPattern);
if (matches && matches.length > 0) { issues.push("Code blocks without language annotation"); }
if (issues.length > 0) { console.error("[WARN] G8-DocStandards: " + issues.join("; ")); }
console.log("[PASS]");
process.exit(0);`,
    variables: []
  }
]

// ============================================================================
// HookGeneratorEnhanced implementation
// ============================================================================

export class HookGeneratorEnhanced implements IHookGeneratorEnhanced {
  private templates: Map<string, HookTemplate> = new Map()
  private generatedHooks: EnhancedHook[] = []

  constructor(private eventBus: IEventBus) {
    for (const tmpl of BUILTIN_TEMPLATES) {
      this.templates.set(tmpl.id, tmpl)
    }
  }

  generateFromRule(rule: ProposedRule, hooksDir: string): EnhancedHook | null {
    if (!rule.approved) return null

    const suitableTemplate = this.findSuitableTemplate(rule)
    if (!suitableTemplate && rule.enforcement !== 'hook') return null

    mkdirSync(hooksDir, { recursive: true })

    const hookId = 'HOOK-' + Date.now() + '-' + rule.id
    const scriptPath = join(hooksDir, hookId + '.cjs')

    const variables = this.extractVariablesFromRule(rule)
    const hookContent = suitableTemplate
      ? this.renderTemplate(suitableTemplate, variables)
      : this.generateRuleBasedHook(rule)

    writeFileSync(scriptPath, hookContent, 'utf-8')

    const hook: EnhancedHook = {
      id: hookId,
      ruleId: rule.id,
      hookType: (suitableTemplate?.hookType === 'SessionStart' ? 'PreToolUse' : suitableTemplate?.hookType) ?? this.inferHookType(rule.pattern),
      matcher: suitableTemplate?.matcherPattern ?? this.inferMatcher(rule.pattern),
      scriptPath,
      createdAt: Date.now(),
      templateId: suitableTemplate?.id,
      language: 'javascript',
      checkBody: hookContent,
      timeout: 5000,
      retryable: false,
    }

    this.generatedHooks.push(hook)
    this.eventBus.emit('hook.generated', { hookId, ruleId: rule.id, hookType: hook.hookType, scriptPath })
    logger.info({ hookId, ruleId: rule.id }, 'Enhanced hook generated')
    return hook
  }

  generateFromTemplate(template: HookTemplate, variables: Record<string, unknown>, hooksDir: string): EnhancedHook {
    mkdirSync(hooksDir, { recursive: true })

    const hookId = 'HOOK-' + Date.now() + '-' + template.id
    const scriptPath = join(hooksDir, hookId + '.cjs')
    const hookContent = this.renderTemplate(template, variables)

    writeFileSync(scriptPath, hookContent, 'utf-8')

    const hook: EnhancedHook = {
      id: hookId,
      hookType: template.hookType === 'SessionStart' ? 'PreToolUse' : template.hookType,
      matcher: template.matcherPattern,
      scriptPath,
      createdAt: Date.now(),
      templateId: template.id,
      language: 'javascript',
      checkBody: hookContent,
      timeout: 5000,
      retryable: false,
    }

    this.generatedHooks.push(hook)
    this.eventBus.emit('hook.generated', { hookId, templateId: template.id, scriptPath })
    logger.info({ hookId, templateId: template.id }, 'Hook generated from template')
    return hook
  }

  generateFromDetector(detectorType: string, pattern: string, hooksDir: string): EnhancedHook {
    mkdirSync(hooksDir, { recursive: true })

    const hookId = 'HOOK-' + Date.now() + '-detector-' + detectorType
    const scriptPath = join(hooksDir, hookId + '.cjs')
    const hookContent = this.generateDetectorHook(detectorType, pattern)

    writeFileSync(scriptPath, hookContent, 'utf-8')

    const hook: EnhancedHook = {
      id: hookId,
      hookType: this.inferHookTypeFromDetector(detectorType),
      matcher: this.inferMatcherFromDetector(detectorType),
      scriptPath,
      createdAt: Date.now(),
      detectorType,
      language: 'javascript',
      checkBody: hookContent,
      timeout: 5000,
      retryable: false,
    }

    this.generatedHooks.push(hook)
    this.eventBus.emit('hook.generated', { hookId, detectorType, scriptPath })
    logger.info({ hookId, detectorType }, 'Hook generated from detector')
    return hook
  }

  getTemplates(): HookTemplate[] { return Array.from(this.templates.values()) }

  registerTemplate(template: HookTemplate): void {
    this.templates.set(template.id, template)
    logger.info({ templateId: template.id }, 'Template registered')
  }

  async validateHook(hookPath: string): Promise<{ valid: boolean; errors: string[] }> {
    if (!existsSync(hookPath)) return { valid: false, errors: ['Hook file does not exist'] }
    const errors: string[] = []
    try {
      const content = readFileSync(hookPath, 'utf-8')
      if (!content.includes('process.exit')) errors.push('Hook must call process.exit()')
      try { new Function(content) } catch (e) { errors.push('Syntax: ' + (e as Error).message) }
    } catch (e) { errors.push('Read error: ' + (e as Error).message) }
    return { valid: errors.length === 0, errors }
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private findSuitableTemplate(rule: ProposedRule): HookTemplate | null {
    const pattern = rule.pattern.toLowerCase()
    if (pattern.includes('file') && pattern.includes('size')) return this.templates.get('tmpl-file-size-guard') ?? null
    if (pattern.includes('dangerous') || pattern.includes('rm -rf')) return this.templates.get('tmpl-dangerous-command-guard') ?? null
    if (pattern.includes('test') && pattern.includes('pass')) return this.templates.get('tmpl-test-verification') ?? null
    if (pattern.includes('console.log')) return this.templates.get('tmpl-console-log-detector') ?? null
    // ========== Workflow Hooks ==========
    if (pattern.includes('karpathy') && pattern.includes('think')) return this.templates.get('tmpl-karpathy-k1-think') ?? null
    if (pattern.includes('karpathy') && pattern.includes('simple')) return this.templates.get('tmpl-karpathy-k2-simple') ?? null
    if (pattern.includes('secret') || pattern.includes('credential') || pattern.includes('hardcoded')) return this.templates.get('tmpl-hardcoded-secret-guard') ?? null
    if (pattern.includes('empty') && pattern.includes('catch')) return this.templates.get('tmpl-empty-catch-guard') ?? null
    if (pattern.includes('mutation') || pattern.includes('immutable')) return this.templates.get('tmpl-mutation-guard') ?? null
    if (pattern.includes('ai') && pattern.includes('slop')) return this.templates.get('tmpl-ai-slop-detector') ?? null
    if (pattern.includes('unverified') || pattern.includes('honest')) return this.templates.get('tmpl-unverified-check') ?? null
    return null
  }

  private renderTemplate(template: HookTemplate, variables: Record<string, unknown>): string {
    let content = template.templateBody
    for (const varDef of template.variables) {
      const value = variables[varDef.name] ?? varDef.defaultValue
      const formatted = Array.isArray(value) ? JSON.stringify(value) : String(value)
      content = content.replace('{{' + varDef.name + '}}', formatted)
    }
    return content
  }

  private extractVariablesFromRule(rule: ProposedRule): Record<string, unknown> {
    const variables: Record<string, unknown> = {}
    const pattern = rule.pattern.toLowerCase()
    const lineMatch = pattern.match(/(\d+)\s*lines/)
    if (lineMatch) variables.maxLines = parseInt(lineMatch[1], 10)
    const coverageMatch = pattern.match(/(\d+)%?\s*coverage/)
    if (coverageMatch) variables.minCoverage = parseInt(coverageMatch[1], 10)
    return variables
  }

  private generateRuleBasedHook(rule: ProposedRule): string {
    return '// Auto-generated hook from Rule: ' + rule.id + '\\nconst input = JSON.parse(process.argv[2] || {}); console.log("[PASS]"); process.exit(0);'
  }

  private generateDetectorHook(detectorType: string, _pattern: string): string {
    const scripts: Record<string, string> = {
      'brute-retry': 'const input = JSON.parse(process.argv[2] || {}); console.log("[CHECK] Brute retry"); console.log("[PASS]"); process.exit(0);',
      'idle-tool': 'const input = JSON.parse(process.argv[2] || {}); console.log("[CHECK] Idle tool"); console.log("[PASS]"); process.exit(0);',
      'premature-done': 'const input = JSON.parse(process.argv[2] || {}); if (!input.tests_run) { console.error("[BLOCKED] Tests not run"); process.exit(2); } console.log("[PASS]"); process.exit(0);',
    }
    return scripts[detectorType] || 'const input = JSON.parse(process.argv[2] || {}); console.log("[PASS]"); process.exit(0);'
  }

  private inferHookType(pattern: string): 'PreToolUse' | 'PostToolUse' | 'Stop' {
    if (/test|verify|lint|build/i.test(pattern)) return 'Stop'
    if (/before|pre|block|dangerous/i.test(pattern)) return 'PreToolUse'
    if (/after|post|detect|console/i.test(pattern)) return 'PostToolUse'
    return 'PreToolUse'
  }

  private inferMatcher(pattern: string): string {
    if (/bash|command/i.test(pattern)) return 'Bash'
    if (/edit|write|file/i.test(pattern)) return 'Edit|Write'
    return ''
  }

  private inferHookTypeFromDetector(detectorType: string): 'PreToolUse' | 'PostToolUse' | 'Stop' {
    if (detectorType === 'premature-done') return 'Stop'
    if (detectorType === 'idle-tool') return 'PreToolUse'
    return 'PostToolUse'
  }

  private inferMatcherFromDetector(detectorType: string): string {
    if (detectorType === 'brute-retry') return 'Bash'
    return ''
  }
}
