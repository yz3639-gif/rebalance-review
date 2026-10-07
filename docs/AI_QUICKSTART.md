# Let a coding assistant set up Rebalance Review

Use an assistant that can read project files, run terminal commands and ideally operate a browser. A chat-only assistant can explain these steps but cannot complete or verify them on your computer.

Open your cloned repository or extracted ZIP in that assistant, then paste one of the prompts below. The normal application needs **Node 24.21.0**, an initial internet connection, `npm ci` and `npm start`. Python, uv, an API key, Docker and a hosting account are not prerequisites for using it.

## English prompt

```text
Set up Rebalance Review locally and leave it running for me to try.

1. Locate the project root containing package.json, .nvmrc and scripts/start.mjs.
   Read the repository's README.md, docs/AI_QUICKSTART.md and applicable AGENTS.md.
   If I have not downloaded it, clone
   https://github.com/yz3639-gif/rebalance-review.git into a new directory.
   Do not overwrite an existing folder, erase local work or reset Git changes.

2. Read .nvmrc and inspect the actual node and npm used by this terminal.
   This checkout requires exactly Node 24.21.0. If missing, use my existing
   version manager, or install that exact official Node build in user space
   for the correct OS/architecture and verify the official checksum. Preserve
   other Node versions; set this process's PATH as needed. Do not use sudo,
   modify package.json engines, weaken scripts/start.mjs, regenerate the lockfile
   or downgrade dependencies to conceal a mismatch. Check node --version again.

3. Run npm ci in the project root. Diagnose a real failure before retrying;
   keep its exit code and useful error. Do not use npm audit fix --force,
   ignore-scripts, or a different dependency installer as an unexplained shortcut.
   Launch npm start in a terminal/session that remains alive. This builds and
   runs the complete Cloudflare Worker; npm run dev alone is not equivalent.
   If port 8787 is occupied, identify it without killing unrelated processes,
   then use npm start -- --port 8788 or another free port. Use that port below.

4. Wait for startup and verify actual HTTP responses for:
   http://127.0.0.1:8787/design/
   http://127.0.0.1:8787/api/providers/local/status
   The page must return the app, and local status should be JSON with enabled:true.
   An HTTP 200 containing an unrelated service or an HTML fallback is not enough.

5. Open /design/ in a browser and run Load example -> Compare portfolios.
   Keep its synthetic-data label. Check that analysis appears, the five views
   open and Edit portfolios & data returns to the inputs. If browser control is
   unavailable, say UI verification is pending; do not infer it from a build.
   Do not overwrite my already-entered portfolios: use a separate fresh tab.

6. In a separate fresh review, try A = SPY 100%, B = SPY 80% / SOXL 20%.
   These are functional test inputs, not advice. Select the local no-key Yahoo
   connection and Compare portfolios. Report the actual source, final observed
   date and success, or the exact sanitized provider error. Do not manufacture
   market prices, silently switch sources, weaken data validation, bypass a
   rate limit/login, or treat a synthetic success as a live-provider success.
   If the provider is unavailable, leave the app running with the usable
   synthetic walkthrough and explain the real-data limitation.

7. Do not ask for API keys in chat, read unrelated secrets or put keys in code,
   commands, reports or source control. If I choose Tiingo, direct me to enter
   my own key only in the app's dedicated field. Public demo access does not
   enable this computer's local Worker or grant market-data redistribution rights.

8. Finish with the actual clickable local URL, commands/checks completed, any
   unresolved failure, and how to stop the server. Keep it running. Distinguish
   installation, build, HTTP, browser-demo and real-provider results. Do not say
   setup is complete based only on a proposed command or successful compilation.
```

## 中文提示词

```text
请直接帮我配置并启动本地 Rebalance Review，完成后保持服务运行让我试用。

1. 找到同时包含 package.json、.nvmrc、scripts/start.mjs 的项目根目录。
   阅读 README.md、docs/AI_QUICKSTART.md 和适用的 AGENTS.md。
   如果我尚未下载，从 https://github.com/yz3639-gif/rebalance-review.git
   克隆到一个新目录。不要覆盖已有文件夹、删除我的文件或重置 Git 改动。

2. 读取 .nvmrc，并检查当前终端实际使用的 node 和 npm。
   本版本要求精确的 Node 24.21.0。缺少时优先使用已有版本管理器；没有时，
   在用户目录安装与操作系统、CPU 架构匹配的官方版本，并核对官方校验值。
   保留其他 Node 版本，必要时只修改当前进程的 PATH，再次检查 node --version。
   不要用 sudo，不要修改 engines 或启动脚本来绕过版本要求，不要重建锁文件、
   降低依赖版本来掩盖错误。

3. 在项目根目录执行 npm ci。失败时先定位原因，保留退出码及必要错误信息，
   不要使用 npm audit fix --force、ignore-scripts 或悄悄换安装器。
   在可持续运行的终端/会话执行 npm start。它会构建并启动完整 Cloudflare
   Worker；只启动 npm run dev 不算完成。若 8787 端口被占用，先确认情况，
   不要杀掉无关进程，改用 npm start -- --port 8788 或其他空闲端口，
   后面的所有检查地址也要同步调整。

4. 等待启动完成，实际检查以下 HTTP 响应：
   http://127.0.0.1:8787/design/
   http://127.0.0.1:8787/api/providers/local/status
   前者必须是本项目页面，后者应为包含 enabled:true 的 JSON。
   无关服务返回 200，或者 API 返回 HTML 首页，都不能算成功。

5. 用浏览器打开 /design/，完成 Load example -> Compare portfolios，
   保留“合成数据”标识，确认分析结果出现、五个视图可打开，
   Edit portfolios & data 可以返回输入。没有浏览器操作能力时，明确标为
   “UI 待验证”，不能从构建通过推断。如果我已经输入组合，请另开新标签页测试，
   不要覆盖我的输入。

6. 再开一个独立的新复查，测试 A = SPY 100%，B = SPY 80% / SOXL 20%。
   这只是功能测试，不是投资建议。选择本地免 key Yahoo 行情并点击比较。
   如实记录实际来源、最后观测日期及成功结果，或者经过脱敏的真实供应商错误。
   不要伪造价格、失败后静默换数据源、放宽校验、绕过限流/登录，
   也不要把合成示例成功当作真实行情成功。供应商不可用时仍保持应用运行，
   提供可操作的合成示例，并说明真实行情限制。

7. 不要在聊天中索取 API key，不要读取无关密钥，也不要把凭证写入源码、
   命令、报告或 Git。如果我选择 Tiingo，请让我仅在产品的专用输入框中填写。
   公开演示网页不等于我电脑上的本地服务，也不授予行情再分发权限。

8. 最后给出实际可点击的本地地址、执行过的命令和检查、未解决问题以及停止方式。
   保持服务运行。明确区分安装、构建、HTTP、浏览器示例和真实行情验证的状态；
   只写出命令或编译通过，不能声称已经全部完成。
```

## Minimal manual path

From a terminal with Node 24.21.0 active:

```sh
git clone https://github.com/yz3639-gif/rebalance-review.git
cd rebalance-review
npm ci
npm start
```

If you downloaded the ZIP, skip `git clone` and enter the extracted directory containing `package.json`. With an existing `nvm` installation, run `nvm install && nvm use` in that directory before `npm ci`.

Open `http://127.0.0.1:8787/design/`. The local URL works only on the computer running this terminal. Leave the process alive while using the app; `Ctrl+C` stops it. Use a second terminal for diagnostics:

```sh
curl --fail --show-error http://127.0.0.1:8787/api/providers/local/status
curl --fail --show-error --output /dev/null http://127.0.0.1:8787/design/
```

Use `curl.exe` in Windows PowerShell if `curl` resolves to a different command; replace `/dev/null` with `NUL`. If using port 8788, update both URLs. Browser UI checks still matter after these requests succeed.

## Expected outcomes and limits

| Check | Evidence of success | What it does not prove |
|---|---|---|
| Installation | `npm ci` exits 0 under pinned Node | The server has started |
| Complete server | `npm start` remains running; `/design/` serves the app | A market provider is reachable |
| Local capability | Status endpoint returns JSON `enabled: true` | Yahoo will serve every selected ETF |
| Synthetic walkthrough | A computed, clearly labeled example opens in the UI | Real market history or provider permissions |
| Live local comparison | Actual source, observed date and computed result appear | A supported official Yahoo API, future availability, or export rights |
| Tiingo | A request with the user's own UI-entered key succeeds | Any other user's entitlement or public deployment readiness |

The hosted [interactive demo](https://yz3639-gif.github.io/rebalance-review/) is synthetic and static. The real-data app runs locally with the full Worker. No observation dataset is supplied as a reusable public feed.

## Fix the common setup problems

**Missing market prices.** “Import market prices first. Your holdings have been preserved.” means CSV mode has no applied price dataset. In **Price data connection**, choose Yahoo local research, configure another API, or preview/apply a permitted CSV. Typing `SOXL` chooses an asset identity; it does not itself download history.

**Missing local connection.** Start with `npm start`, use a loopback address, and inspect the status endpoint. `npm run preview:full` intentionally leaves the local-only connection disabled; GitHub Pages cannot provide it. `npm run dev` alone serves only the frontend.

**Wrong Node.** The launcher checks the exact `.nvmrc` version. Install/select 24.21.0, reopen the terminal if your version manager requires it, and verify the executable actually used. Do not edit the requirement.

**Port conflict.** Run `npm start -- --port 8788` and open `http://127.0.0.1:8788/design/`. Do not stop another application's server merely to free the default port.

**Ticker search confusion.** The allocation editor searches the ETF directory. The analysis **Holdings** search only filters the current result. Use **Edit portfolios & data** to add another ETF.

**Older dates.** Real daily requests target the previous trading session; they are not live quotes. **AS OF** reports the last observation used. Synthetic examples intentionally have a fixed cutoff. Do not replace date labels or accept stale final sessions just to make a screen look current.

**Provider or history failure.** Keep the user's inputs and surface the error. Rate limits, unsupported identities, missing adjusted data and fewer than 253 common observations can prevent a valid result. Try later or use another explicitly selected permitted source; a passing demo is still only a demo.

**Full report/save disabled.** Yahoo local and Tiingo have a restrictive calculation-only policy. Raw history is released after calculation; a later comparison fetches again. A decision-only PDF includes the user's inputs/reasoning, without analytical results. Use the local synthetic example to test full report and journal features, or a source with recorded permissions for those outputs.

For more detail: [README](../README.md), [provider setup](PROVIDERS.md), [data formats](DATA_FORMATS.md), [privacy](PRIVACY.md).
