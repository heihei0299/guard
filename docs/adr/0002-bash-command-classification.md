# ADR-0002: Bash Command Classification by Static Token Analysis

Bash commands in guarded mode are classified as "readonly" (allowed) or "write" (blocked) by static analysis of the first command token and subcommand, rather than blocking all bash or allowing all bash, balancing security with usability.

**Status**: accepted

## Context

In guarded mode, the extension must block destructive bash commands (`rm -rf`, `git commit`, `npm install`) while allowing harmless exploration commands (`ls`, `cat`, `grep`, `git status`). Blocking all bash would force users to type `/guard:allow` for every `ls` invocation, defeating the purpose of the guard. Allowing all bash would let the AI trivially bypass the guard by using shell commands instead of the `write` tool.

The challenge is that bash is a single tool with unlimited capability — classifying intent from the command string is inherently imprecise.

## Decision

Implement `isBashReadonly(command: string): boolean` in `index.ts` using static analysis of the command text:

1. **Redirect operators** (`>`, `>>`, `<`): Always classify as write. Shell redirects are the most common way to write file content via bash.
2. **First token lookup**: Known readonly commands (`ls`, `cat`, `head`, `tail`, `grep`, `find`, `file`, `stat`, `du`, `df`, `which`, `echo`, `printf`, `ps`, `uptime`, `date`, `cal`, `ping`, `dig`, `curl`, `wc`) are allowed.
3. **Known write commands** (`rm`, `mv`, `cp`, `touch`, `mkdir`, `sed` with `-i`, `awk` with `-i`, `tee`, `dd`, `chmod`, `chown`, `npm`, `uv`, `pip`): Blocked.
4. **Git subcommand analysis**: The second token determines whether the git operation is readonly (`log`, `status`, `diff`, `show`, `branch` without `-d`, `tag` without `-d`, `describe`, `rev-parse`, `ls-files`, `stash list`) or write (`add`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `checkout`, `stash push`, `stash drop`, `branch -d`, `tag -d`).
5. **Default closed**: Unknown commands are blocked (conservative — safe by default).

## Considered Options

- **Static token classification (chosen)**: Zero execution overhead, predictable, easy to audit. Cannot detect all write intents (e.g., a script that calls `mv` internally), but covers the vast majority of interactions.
- **Block all bash**: Maximum security, but unusable. Every `ls` or `cat` requires `/guard:allow`.
- **Allow all bash**: Trivially bypasses the guard. `echo "malicious code" > src/index.ts` is a valid readonly echo.
- **Sandbox / runtime analysis**: Would need to execute commands in a restricted environment to classify intent. Overengineered for this use case, introduces latency and complexity.
- **Allowlist-only**: Only allow a specific set of commands. Fragile — any new command the AI needs (e.g., `dig`, `ping`) would break until added to the allowlist.

## Consequences

- The classification is static and conservative. Unknown commands are blocked, which may cause false positives for legitimate but obscure commands. Users can use `/guard:allow` for those cases.
- The accuracy depends on keeping the command lists up to date as the project's tooling evolves.
- The redirect check (`>`, `>>`, `<`) is the most important heuristic — it catches the most common bash-based write patterns regardless of command.
- Git subcommand analysis provides granular control without overly restricting git usage.
