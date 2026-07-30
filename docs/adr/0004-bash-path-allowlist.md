# ADR-0004: Bash Path Allowlist for Guarded-Mode Write Commands

In guarded mode, selected bash write commands (`mkdir`, `touch`, `rm`, `mv`, `cp`) and shell redirections (`>`, `>>`) are allowed through a path-aware allowlist check that extracts literal path arguments and validates them against the allowlist, instead of being unconditionally blocked by the static command-name classifier.

**Status**: accepted
**Status**: superseded by ADR-0005 (Simplify Bash Permission Control)
## Context

ADR-0002 introduced `isBashReadonly()` to classify bash commands by static token analysis: readonly commands pass through, write commands are blocked. This works for the common case but is too coarse for legitimate write operations on paths that the guard already permits for `write`/`replace` tools (`.scratch/`, `docs/`, `CONTEXT.md`).

For example, after a domain-modeling session:
- `mkdir -p docs/adr/ && write docs/adr/0004-foo.md` — the `mkdir` is blocked even though the target path `docs/adr/` is on the allowlist.
- `cp docs/guide.md ./` — copying a document out of the allowlist for sharing, harmless.
- `rm docs/old-draft.md` — cleaning up scratch files in the allowlist, legitimate.

The existing path allowlist (ADR-0003) covers `write` and `replace` tools but not bash. Extending path-aware checking to bash for a subset of write commands eliminates these false positives while maintaining protection for the rest of the codebase.

The guard's design principle is "prevent AI from writing outside allowed paths", not "prevent AI from writing at all". Path-aware bash checking brings bash in line with that principle.

## Decision

Add a new path-aware bash check, `isBashPathAllowed(command, allowWritePaths)`, implemented in a new file `bash-path-allowlist.ts`. The function is invoked after `isBashReadonly()` returns `false` (i.e., the command is classified as write), giving it a second chance if the target paths are on the allowlist.

### Commands eligible for path-aware checking

| Command | Path extraction | Allow condition |
|---------|---------------|----------------|
| `mkdir` | All non-flag arguments | All paths in allowlist |
| `touch` | All non-flag arguments | All paths in allowlist |
| `rm` | All non-flag arguments | All paths in allowlist |
| `mv` | All non-flag arguments | **All** paths (source + target) in allowlist |
| `cp` | All non-flag arguments (source) | All **source** paths in allowlist; target may be outside |
| `>` / `>>` redirection | Path after the redirect operator | Path in allowlist |

### Commands always blocked (no path check)

`sed -i`, `awk -i`, `tee`, `ln`, `chmod`, `chown`, `dd`, `fallocate`, `sudo`, `doas` — these are either too dangerous to allow even within the allowlist, require complex path extraction, or involve privilege escalation.

### Path extraction rules

- Only **literal** path tokens are accepted: tokens containing `$`, `` ` ``, `*`, `?`, `[`, `]`, `{`, `}`, `~` (except leading `~` for home-directory expansion) are rejected.
- The function does **not** check for compound command structure (`&&`, `|`, `;`, `||`) — it only inspects the path tokens themselves.
- Paths are normalized: leading `./` stripped, leading `~` expanded to `$HOME`. No `..` resolution or symlink following.
- Tokenization uses simple whitespace splitting; quoted strings (`"..."`, `'...'`) are treated as single tokens.

### Overall bash interception flow

```
bash command → isBashReadonly() → true → ALLOW
                                 → false → isBashPathAllowed() → true → ALLOW
                                                                 → false → BLOCK
```

### Implementation

- New file: `bash-path-allowlist.ts` containing `isBashPathAllowed(command: string, allowWritePaths: string[]): boolean`
- Modified: `index.ts` — extract `allowWritePaths` from guard machine options and pass to `isBashPathAllowed` in the bash tool-interception branch
- The `isPathAllowed()` matching logic (directory prefix/subpath, file suffix) is reused but via a separate function call, not shared code — the two checks are intentionally decoupled per design decision

### Design constraints

- **Guard is not a security boundary.** Path traversal (`mkdir docs/../../../etc/evil`) is accepted risk — the guard prevents accidental AI misbehavior, not targeted attacks.
- **Conservative by default.** Any ambiguous or unhandled case results in blocking the command.
- **Readonly commands bypass the path check entirely.** Only commands classified as "write" by `isBashReadonly()` are evaluated by `isBashPathAllowed()`.

## Considered Options

- **Path-aware bash check (chosen)**: Extends the existing path-allowlist concept to bash, eliminating the most common false-positive guard blocks. Minimal new code, clear semantics.
- **Block all bash write commands (status quo)**: Simple but creates friction — the user must type `/guard:allow` for every legitimate `mkdir docs/` or `rm docs/tmp.md`.
- **Extend write/replace allowlist to bash globally**: Would allow any write command targeting the allowlist, including `dd`, `chmod`, `ln` — too permissive for destructive or link-based operations.
- **Full path resolution with symlink/.. normalization**: Would be more secure but introduces significant complexity and false negatives (e.g., resolving symlinks before the target exists). Not warranted for the guard's use case.

## Consequences

- The `isBashPathAllowed()` function and `isBashReadonly()` coexist as a two-stage check in the bash interception branch of `index.ts`.
- Users can now `mkdir -p docs/adr/`, `rm docs/tmp.md`, `mv docs/a docs/b`, and `cp docs/x ./` directly in guarded mode without running `/guard:allow`.
- `dd`, `fallocate`, `chmod`, `chown`, `ln`, `tee`, `sed -i`, `awk -i`, `sudo`/`doas` remain unconditionally blocked even when targeting allowlist paths.
- Path-aware checking only applies to commands with literal path arguments — compound commands, variables, globs, and redirect-based writes with non-literal paths remain blocked.
- The guard's interception flow in `index.ts` becomes a three-way decision: readonly → allow, write-but-path-allowed → allow, write-and-path-not-allowed → block.
