# skillpkg (`sm`) — Agent Skills 管理器

> **A package manager for coding-agent skills — "npm for skills".**
> 一条命令，把任意 git 仓库里的技能（skills）安装进 Claude Code / ZCode / Codex，统一列出、更新、安全体检、干净卸载。

**English TL;DR:** skillpkg installs, lists, updates, audits and uninstalls [SKILL.md](https://code.claude.com/docs/en/skills)-style agent skills across Claude Code, ZCode and Codex from any git repo, with a lockfile for reproducibility and a heuristic security scanner (`sm doctor`). MIT licensed.

---

## 为什么需要它

2026 年，编码 agent 的 skills 生态正在爆发，但管理方式还停留在原始社会：

- **安装** = 手动 `git clone` 再人肉拷贝，每家 agent 的目录约定还各不相同
- **更新** = 不存在；**卸载** = 手动删文件夹，还删不干净
- **风险** = 来路不明的技能里藏着 `curl ... | sh`，没人帮你检查

```bash
# 以前：clone、找目录、复制、祈祷
git clone https://github.com/someone/some-skill
cp -r some-skill ~/.claude/skills/       # zcode 的目录又是另一个……

# 现在
sm install someone/some-skill           # 自动装进所有已检测到的 agent
```

## 安装

```bash
# 零安装试用
npx skillpkg list

# 或全局安装
npm install -g skillpkg
```

要求：Node ≥ 20，`git` 可用（GitHub 简写需要网络）。

## 命令

| 命令 | 说明 |
|---|---|
| `sm install <source>` | 从 git 仓库 / `owner/repo` 简写 / 本地目录安装技能 |
| `sm list` | 跨 agent、跨作用域列出所有技能与版本（commit） |
| `sm update [name]` | 更新到源仓库最新 commit，显示 `旧 → 新` 变更摘要 |
| `sm uninstall <name>` | 按锁文件干净移除，不留残留 |
| `sm doctor` | 静态安全体检所有已装技能（只报告，不拦截） |
| `sm agents` | 显示支持的 agent 与本机检测状态 |

### install 详解

```bash
sm install anthropics/skills --skill docx        # GitHub 简写 + 从多技能仓库挑一个
sm install https://github.com/x/y --all          # 装下仓库里全部技能
sm install ./my-local-skill                      # 本地目录（开发技能时配合 --link 很香）
sm install x/y --agent claude-code,zcode         # 默认装进所有已检测到的 agent
sm install x/y --scope project                   # 装进当前项目（.claude/skills 等）
sm install x/y --link                            # 链接而非拷贝：源更新即生效（Windows 用 junction）
```

安装时自动解析 `SKILL.md` frontmatter：缺失 `description`、名称与目录不一致等问题会给出警告——社区技能质量参差，这道校验本身就有价值。

### 锁文件（skills.lock.json）

用户级锁文件在 `~/.skillpkg/skills.lock.json`，项目级在项目根 `skills.lock.json`，可提交进 git 实现团队复现：

```json
{
  "version": 1,
  "skills": [
    {
      "name": "docx",
      "source": "https://github.com/anthropics/skills",
      "path": "document-skills/docx",
      "commit": "a1b2c3d",
      "installedAt": "2026-10-25",
      "agents": ["claude-code", "zcode"],
      "scope": "user",
      "license": "MIT"
    }
  ]
}
```

### sm doctor 安全体检

安装来源不明的技能前先扫一遍。规则开源可审、只报告不拦截、可用 `--ignore <rule>` 压噪：

| 严重度 | 规则 | 识别内容 |
|---|---|---|
| high | `HIGH_PIPE_TO_SHELL` | `curl/wget ... \| sh`、`\| powershell` 下载即执行 |
| high | `HIGH_INVOKE_EXPRESSION` / `HIGH_EVAL_EXEC` | `Invoke-Expression` / `iex` / `eval('...')` |
| high | `HIGH_BASE64_DECODE_EXEC` | base64 解码后直接执行（混淆载荷） |
| high | `HIGH_CREDS_EXFIL` | 同一文件内既引用凭据（`~/.ssh`、`.env`、浏览器配置）又有网络请求 |
| medium | `MED_DATA_EGRESS` | POST / 上传数据到外部 |
| medium | `MED_ENV_COLLECTION` | 收集环境变量并交给网络代码 |
| medium | `MED_PERSISTENCE` | 改 shell 配置、注册启动项、计划任务 |
| low | `LOW_BINARY_BLOB` / `LOW_LONG_LINE` | 技能内含二进制 / 超长单行（混淆嫌疑） |

> ⚠️ doctor 是启发式静态分析：**可能漏报也可能误报**，结论仅供参考，不能替代人工审查。

## 支持的 agent

| Agent | 用户级目录 | 项目级目录 |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `<repo>/.claude/skills/` |
| ZCode | `~/.zcode/skills/` | `<repo>/.zcode/skills/` |
| Codex | `~/.codex/skills/` | `<repo>/.codex/skills/` |

新 agent = 新增一个约 10 行的适配器文件，欢迎 PR。

## 开发

```bash
git clone https://github.com/lixiaonatongxue/Agent-SkillsManager
cd Agent-SkillsManager
npm install
npm test          # vitest，55+ 用例
npm run build     # tsc -> dist/
node dist/cli.js --help
```

测试全部使用合成数据与沙箱 home（`SKILLPKG_HOME`），不会触碰你真实的 `~/.claude` 等目录。

## 路线图

- [x] v0.1：install / list / update / uninstall / 锁文件 / 多 agent 适配
- [x] `sm doctor` 静态安全扫描
- [ ] v0.2：技能种子索引与 `sm search`；项目级 `sm disable`
- [ ] v1.0：同名/触发冲突检测；技能使用统计与清理建议；Homebrew/winget 分发

## 许可

MIT。本工具只做"安装器 + 体检"，不分发技能内容本身；各技能仓库的 License 归其作者所有。
