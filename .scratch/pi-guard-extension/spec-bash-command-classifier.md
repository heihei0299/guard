# Bash Command Classifier Extraction — Spec

## Problem Statement

The bash command classification logic (`isBashReadonly`, `isGitReadonly`, and the four command sets `READONLY_COMMANDS`, `WRITE_COMMANDS`, `GIT_READONLY_SUBCOMMANDS`, `GIT_WRITE_SUBCOMMANDS`) currently lives in `src/index.ts` alongside the extension event wiring. Two distinct concerns share one file — pure classification logic and extension glue. Understanding either requires reading past the other, and the public interface of `index.ts` is wider than it needs to be.

## Solution

Extract the bash command classification logic into a dedicated module `src/bash-command-classifier.ts` that exports a single function `isBashReadonly(command: string): boolean`. The extension glue in `index.ts` imports and calls this function without re-exporting it.

## User Stories

1. As a developer reading the codebase, I want to find all bash classification rules in one file, so that I can audit and update them without reading extension event wiring.
2. As a developer adding a new command to the classification, I want to edit a single focused module, so that I don't risk breaking event handlers.
3. As a developer writing tests, I want to test `isBashReadonly` directly without setting up mock pi events, so that edge cases are easy to cover.
4. As a developer maintaining the extension, I want `index.ts` to have a narrower public API, so that it's clear what the extension exposes vs what's internal.

## Implementation Decisions

### Module structure

- New file: `src/bash-command-classifier.ts`
- Exports exactly one function: `isBashReadonly(command: string): boolean`
- Contains privately:
  - `READONLY_COMMANDS` Set
  - `WRITE_COMMANDS` Set
  - `GIT_READONLY_SUBCOMMANDS` Set
  - `GIT_WRITE_SUBCOMMANDS` Set
  - `isGitReadonly(tokens: string[]): boolean` (internal helper, not exported)

### Interface shape

```typescript
// bash-command-classifier.ts — single export
export function isBashReadonly(command: string): boolean;
```

The function accepts a full bash command string and returns `true` if it's classified as readonly (safe to allow in guarded mode), `false` otherwise. The logic is identical to the current implementation — no behavioral change.

### What does NOT move

- `extractTextContent` — stays in `guard.ts`, used only by the state machine
- `isPathAllowed` — stays on `GuardMachine` (see ADR-0003)
- `BLOCK_REASON` — stays in `index.ts`, tied to extension UI
- `createGuard` and all event handlers — stay in `index.ts`

### Import change

`index.ts` imports `isBashReadonly` from the new module instead of defining it locally:

```typescript
import { isBashReadonly } from "./bash-command-classifier.ts";
```

### Re-exports

`isBashReadonly` is NOT re-exported from `index.ts`. No external consumer currently imports it, and keeping the extension's public API minimal is the goal of this extraction.

## Testing Decisions

### What makes a good test

- Tests assert on external behavior through the module's interface (`isBashReadonly`), not internal state
- Each edge case is a self-contained test (`it("...")`)
- No mock setup needed — pure function in, boolean out

### New test file: `src/bash-command-classifier.test.ts`

Tests cover the same classification logic that was previously tested only through integration tests, now at the unit seam:

- Readonly commands: `ls`, `cat`, `grep`, `find`, `echo`, `printf`, `curl`, `git status`, `git log`, `git diff`
- Write commands: `rm`, `mv`, `cp`, `touch`, `mkdir`, `npm install`, `git commit`, `git push`
- Redirect operators: `>` and `>>` in various positions, with and without spaces
- Git edge cases: `git stash list` (readonly) vs `git stash push` (write), `git branch -d` (write) vs `git branch` (list, readonly), `git tag -d` (write) vs `git tag` (list, readonly)
- sed/awk without `-i` (readonly) vs with `-i` (write)
- Empty string and whitespace-only input
- Unknown commands (conservative default: block)

### Existing integration tests preserved

`index.test.ts` retains all existing tests that verify the bash classification through the full pi event chain (e.g., `"blocks write bash commands"`, `"allows readonly bash commands"`). These serve as a safety net for the end-to-end behavior.

### Prior art

`guard.test.ts` follows the same pattern — one test file per source module, testing through the module's exported interface with no mock setup needed for pure logic.

## Out of Scope

- No behavioral changes to the classification logic
- No changes to the path allowlist or `isPathAllowed`
- No changes to the state machine
- No changes to the extension event handlers beyond the import path
- No re-export of `isBashReadonly` from `index.ts`
- No changes to the `GuardMachine` interface
- No changes to `CONTEXT.md` or ADRs (the domain model already accounts for the bash classifier as a distinct concept)

## Further Notes

- This extraction is a pure refactor — zero behavioral change. The test suite should pass without modification.
- The extraction enables Candidate 2 (removing `isPathAllowed` from the state machine) and Candidate 3 (shared test helpers) from the architecture review, but neither is in scope here.
- If more bash-like command classification is needed in the future (e.g., for PowerShell or zsh), the module can be generalized or renamed; for now `bash` is the only shell in use.
