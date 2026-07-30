# 07 — Bash 只读命令放行

**What to build:** 将 guarded 模式下的 bash 拦截策略从"全部拦截"调整为"只拦截写入性命令"。放行 `ls`、`cat`、`grep`、`find`、`git log`、`git status` 等不改变文件系统的只读命令；拦截包含 `>/>>` 重定向、`rm`、`mkdir`、`git commit`、`npm install` 等写入性命令。

**Blocked by:** None — 可立即开始（与 06 互不阻塞）

**Status:** ready-for-agent

- [ ] `index.ts`: 添加 bash 命令只读/写入分类逻辑——使用前缀匹配和模式检查判断命令意图
- [ ] 放行的只读命令类：ls、cat、head、tail、less、more、wc、grep、rg、ag、ffgrep、fffind、find、file、stat、du、df、which、type、echo（无重定向）、printf（无重定向）、ps、top、htop、uptime、date、cal、curl（仅 GET/HEAD）、ping、dig、nslookup、host
- [ ] 放行的 git 只读命令：git log、git status、git diff、git show、git branch、git tag、git describe、git rev-parse、git ls-files、git stash list
- [ ] 拦截的写入性命令模式：含 `>/*>>*/<` 重定向、sed -i、awk -i、tee、dd、mkfs、mount、touch、mkdir、rmdir、rm、mv、cp、ln、chmod、chown、chattr
- [ ] 拦截的 git 写入命令：git add、git commit、git push、git pull、git merge、git rebase、git reset、git checkout、git branch -d、git tag -d、git stash push、git stash drop
- [ ] 拦截的包管理写入命令：npm install、npm publish、uv sync、pip install
- [ ] 策略原则：保守优先——宁可误拦，不可漏拦；不确定的一律拦截
- [ ] `index.ts`: 更新 `tool_call` handler 中 bash 分支——调用分类逻辑判断是否放行
- [ ] 测试：`index.test.ts` 新增 integration 测试——guarded + 只读 bash 放行、guarded + 写入 bash 拦截
