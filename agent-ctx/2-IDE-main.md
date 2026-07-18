# Task ID 2-IDE — JARVIS IDE — COMPLETED

**Agent**: main (Z.ai Code)
**Task**: Build a full-featured in-browser code editor (JARVIS IDE) with 30+ features.
**Status**: ✅ DONE — 36 features wired, lint clean, end-to-end verified.

## What Was Delivered

### Backend (`src/lib/ide/index.ts` — ~1000 LOC)
- `createProject` (auto-detect framework, scan up to 500 text files, capture git info, create initial session)
- `listProjects` / `getProject` / `deleteProject` / `updateProjectSettings`
- `openFile` / `getFile` / `saveFile` (disk + DB + ActionLog before/after snapshot)
- `createFile` / `deleteFile` / `renameFile` / `createFolder`
- `searchInFiles` (regex/case-sensitive/file-pattern, max 200 results)
- `getGitStatus` (branch/ahead/behind/remote/modified/added/deleted/untracked + per-file)
- `getGitDiff` (working or staged)
- `getOutline` (regex symbol extraction for TS/JS)
- `getProblems` (tsc + eslint, 30 s timeout, unified output)
- `listSessions` / `createSession` / `updateSession`

### API Routes (9 endpoints, all nodejs + force-dynamic)
- `POST/GET /api/ide/projects`
- `GET/PATCH/DELETE /api/ide/projects/[id]`
- `POST/PUT /api/ide/files` (create / open-by-path)
- `GET/PUT/PATCH/DELETE /api/ide/files/[id]`
- `POST /api/ide/search`
- `GET/POST /api/ide/git/status`
- `POST /api/ide/git/diff`
- `POST /api/ide/outline`
- `POST /api/ide/problems`
- `GET/POST /api/ide/sessions`

### UI Components (`src/components/ide/` + `src/components/tabs/IdeTab.tsx`)
- `highlight.tsx` — regex syntax highlighter (TS/JS/JSON/CSS/MD/HTML/PY/BASH/SQL) + file-icon mapper + git-status badge helper
- `FileTree.tsx` — VS Code-style tree, right-click context menu, git indicators, dirty dots
- `EditorPane.tsx` — multi-tab editor, drag-reorder, find/replace/goto-line, minimap, line gutter, syntax-highlight overlay
- `Panels.tsx` — OutlinePanel + ProblemsPanel + GitDiffPanel + SearchResultsPanel + TerminalDock (reuses /api/terminal/exec)
- `CommandPalette.tsx` — Ctrl+P (files, fuzzy) + Ctrl+Shift+P (commands)
- `SettingsDialog.tsx` — fontSize/tabSize/theme/wordWrap/minimap/autoSave/formatOnSave/linting
- `ProjectPicker.tsx` — dropdown + create form
- `IdeTab.tsx` — main tab wiring everything together

### Wiring
- `src/app/page-client.tsx` — added `Code2` import, `IdeTab` import, `'ide'` to TabKey union, `{ key: 'ide', label: 'JARVIS IDE', icon: Code2, group: 'System', accent: JARVIS.colors.cyan }` to TABS, `ide: IdeTab` to TAB_MAP.

## 36 Features (vs 30+ requested)
1. Multi-file tabs (open/close/switch/drag-reorder)
2. File tree with folders
3. File icons by extension
4. Git status indicators in tree (M/A/U/D)
5. Dirty indicator
6. Save (Ctrl+S) — disk + DB
7. Auto-save (30 s)
8. New file / new folder
9. Rename file
10. Delete file
11. Search across files (Ctrl+Shift+F)
12. Search results panel (click-to-jump)
13. Find in file (Ctrl+F)
14. Find & replace (Ctrl+H)
15. Go to line (Ctrl+G)
16. Command palette (Ctrl+Shift+P)
17. Quick open file (Ctrl+P)
18. Outline panel (symbols)
19. Problems panel (lint errors)
20. Git status bar
21. Git diff viewer
22. Syntax highlighting
23. Line numbers gutter
24. Cursor position in status bar
25. Word wrap toggle
26. Font size +/-
27. Theme toggle (jarvis-dark / light)
28. Minimap toggle
29. Tab size (2/4/8)
30. Format on save toggle
31. Terminal dock (bottom panel)
32. Right-click context menu on file tree
33. Drag-reorder file tabs
34. Keyboard shortcuts overlay (?)
35. Settings panel
36. Session restore (open tabs + cursor)

## Verification
- `bun run lint` → 0 errors, 0 warnings.
- Dev server HTTP 200.
- End-to-end curl smoke test (all 200):
  - Created project "Workspace" pointing at sandbox workspace → 3 files auto-scanned (hello.txt, hello_world.py, test.txt). Framework auto-detected = node, gitBranch = main.
  - Opened hello_world.py → content returned.
  - Search "hello" → 2 matches.
  - Git status → branch=main, 35 modified files.
  - Git diff → full unified diff returned.
  - Outline on a generated TS file → correctly extracted function add (L1), const PI (L5), interface User (L7).
  - Created → saved (PUT) → renamed (PATCH) → deleted a test TS file.
  - Outline, search, git status, git diff, problems, sessions APIs all return 200.

## Issues Encountered & Fixed
1. Lint rule `react-hooks/set-state-in-effect` flagged synchronous setState in CommandPalette + OutlinePanel effects — refactored to derived `safeIdx` value + parent key remount.
2. ESLint mis-parsed a code comment containing the word "eslint" as a config directive — reworded the comment.
3. Prisma object shorthand `{ lastSavedBy }` referenced an undefined variable (param was `savedBy`) — runtime caught via 500, fixed to `{ lastSavedBy: savedBy }`.
4. `existsSync(join(root, '.git'))` returned false for projects whose root is a subdirectory of a git repo — replaced with `isInsideGitRepo()` helper that runs `git rev-parse --is-inside-work-tree` (walks up parents).

## Files Created (20)
- `src/lib/ide/index.ts`
- `src/app/api/ide/projects/route.ts`
- `src/app/api/ide/projects/[id]/route.ts`
- `src/app/api/ide/files/route.ts`
- `src/app/api/ide/files/[id]/route.ts`
- `src/app/api/ide/search/route.ts`
- `src/app/api/ide/git/status/route.ts`
- `src/app/api/ide/git/diff/route.ts`
- `src/app/api/ide/outline/route.ts`
- `src/app/api/ide/problems/route.ts`
- `src/app/api/ide/sessions/route.ts`
- `src/components/ide/highlight.tsx`
- `src/components/ide/FileTree.tsx`
- `src/components/ide/EditorPane.tsx`
- `src/components/ide/Panels.tsx`
- `src/components/ide/CommandPalette.tsx`
- `src/components/ide/SettingsDialog.tsx`
- `src/components/ide/ProjectPicker.tsx`
- `src/components/tabs/IdeTab.tsx`
- `agent-ctx/2-IDE-main.md`

## Files Modified (1)
- `src/app/page-client.tsx` (TabKey union, TABS array, TAB_MAP, Code2 import, IdeTab import)
