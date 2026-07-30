# ADR-0003: Path Allowlist for Guarded-Mode Writes

In guarded mode, write/replace tool calls targeting `.scratch/`, `docs/`, or `CONTEXT.md` are allowed through a path allowlist with directory-prefix and file-suffix matching, enabling legitimate skill outputs while protecting the rest of the codebase.

**Status**: accepted

## Context

After a skill conversation enters guarded mode, AI agents cannot write or replace any file. However, three types of write operations are legitimate and expected:

- **`.scratch/`**: Skill discussions produce intermediate outputs, research notes, and scratch documents that must be saved to the project's scratch directory.
- **`docs/`**: The domain-modeling workflow creates ADRs and other documentation in the `docs/` directory as direct outputs of skill conversations.
- **`CONTEXT.md`**: The domain glossary is updated during domain-modeling sessions and must be writable.

Without these exemptions, every legitimate post-skill write would require the user to type `/guard:allow`, defeating the purpose of having skill-authorized write paths.

## Decision

Define an allowlist of paths that bypass the guarded-mode write/replace block:

| Path | Match Rule | Rationale |
|------|-----------|-----------|
| `.scratch/` | Prefix (directory) | Scratch directory for all intermdiate/work-in-progress files |
| `docs/` | Prefix (directory) | Documentation directory for ADRs, manuals, guides |
| `CONTEXT.md` | Suffix (file) | Root-level domain glossary; matches `CONTEXT.md`, `./CONTEXT.md`, `ri/CONTEXT.md`, `~/.../CONTEXT.md`; not `CONTEXT.md.bak` |

Matching rules:
- Leading `./` is normalized away before matching (`./.scratch/foo` → `.scratch/foo`).
- Leading `~` is expanded to the user's home directory before matching (`~/project/CONTEXT.md` → `/home/user/project/CONTEXT.md`).
- Directory paths (ending with `/`) match by prefix — any file under `.scratch/` or `docs/` is allowed.
- File paths (no trailing `/`) match by exact filename or suffix — `CONTEXT.md` matches
  `CONTEXT.md`, `./CONTEXT.md`, `ri/CONTEXT.md`, and `~/.../CONTEXT.md`. Does not match
  `CONTEXT.md.bak`, `CONTEXT.md.tmp`, or `backup-CONTEXT.md`.
- Path traversal (`..`) is not resolved — `../guard/.scratch/foo` does not match `.scratch/`.
- Symbolic links are not resolved — the guard operates on the string path as provided.

## Considered Options

- **Path allowlist (chosen)**: Precise control, matches the three identified user stories. Easy to extend with `allowWritePaths` option.
- **Block all writes**: Simplest implementation, but breaks the expected workflow of domain-modeling (which writes CONTEXT.md and ADRs as its primary output).
- **Allow all writes**: Defeats the guard entirely — the main protection mechanism becomes useless.
- **Per-tool exemption (write only, block replace)**: Inconsistent — replace is functionally identical to write for this purpose.
- **Glob-based matching**: More flexible but introduces complexity. The current prefix/exact rules cover all current needs without glob parsing edge cases.

## Consequences

- The allowlist is compiled into the `DEFAULT_ALLOW_WRITE_PATHS` constant in `guard.ts` and configurable via `GuardMachineOptions.allowWritePaths`.
- Paths outside the allowlist (e.g., `src/`, `package.json`, `lib/`) remain fully blocked in guarded mode.
- The `./` normalization and `~` expansion handle the most common relative and home-relative path variants;
  `../` traversal and symlinks remain unresolved by design.
- File-type suffix matching enables cross-project CONTEXT.md writes (e.g., `~/Project/Pi/ri/CONTEXT.md`) while
  still blocking `CONTEXT.md.bak` and similar variants.
- As the project grows, additional paths may need to be added (e.g., a `config/` directory). The `allowWritePaths` option supports this without changing the defaults.
