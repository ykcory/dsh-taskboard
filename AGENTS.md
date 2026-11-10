# dsh-taskbord — DeepSeek Harness 任务看板插件

为 DSH（DeepSeek Harness）Web GUI 开发一个原生「任务看板」面板插件：每个工作区（会话 cwd）一个看板，看板内里程碑页签切换，事项卡片在可自定义的阶段（列）之间流动。

## 当前状态

- **GitHub 仓库**：https://github.com/ykcory/dsh-taskboard （public，remote `origin` 走 SSH，分支 `main`）。
  README 双语：`README.md`（英文默认）+ `README.zh-CN.md`（中文），顶部互链切换。
- **Phase 0 设计图**：第 6 版完成，等待用户在画布上复验。画布节点：ardot 文件「新文件」`745806795348219`，Page 1，
  `21:1` 主界面（board-main）/ `22:1` 新建事项弹层（board-create-task）/ `23:1` 新建里程碑弹层（board-create-epic）/
  `25:1` 阶段色板弹层（board-stage-popover）。帧在画布上的 x/y 按用户视口临时摆放，不影响内容。
- 工具行右对齐已按**节点树实测坐标**修复：四帧按钮组右缘均 = 1501.0（内容区右缘，零偏差）。
  特写图：`design/screenshots/toolbar-closeup-v6.png`。
- **Phase 1 插件实现**：已完成（2026-11-10）。宿主路由、看板 UI、CAS 写入、删除防护、92 项单测全部就绪，
  已 link 安装到 desktop profile 且行 `ui-taskboard` 为 enabled/active。**需用户重启 DSH 服务后右侧栏开始页才会出现卡片。**

## 入口形态（用户 2026-11-10 定稿）

- **只做右侧栏卡片**，不做左侧栏面板入口。用户指的是「开始」页那批工具卡片（工作区文件 / 新建终端 / 浏览器）。
- 机制：`ctx.sidebarRightTabs.register()` 注册页签类型（kind `taskboard`、priority `extension`、guide 卡片），
  再用 `slots.inject('sidebar.right.pane.tab')` + `sidebar.right.pane.tab.title` 在类型 id 下挂页签体与标题。
- **列宽固定**：停靠栏里阶段列固定 240px（`DOCKED_COLUMN_WIDTH`），横向滚动而不是拉伸；工具栏在窄栏下换行。
- **面板根节点必须透明**：宿主把 active 页签圆角下缘悬挂进内容区，根节点铺不透明背景会盖住页签条下缘
  （原生 `.k-1LKG_page` 同样无背景色）。已踩过：`bg-white` 导致「任务看板/文件」页签下缘被压住。
- **卡片图标**：guide 卡片的 `icon` 必须传组件，否则宿主画灰色占位立方体。规格对齐官方
  `GuideArtwork*`（`@deepseek-ai/dsh-client-ui-primitives`）：**36×36 画布、扁平双色填充、无描边无渐变**。
  本插件用 `src/client/view/GuideArtwork.tsx`（三根高低柱 = 阶段列，紫 #7C5CF0/#9B7DF5/#B9A6FB，
  与官方黄/蓝/蓝紫三卡区分）。`icon.svg`（插件列表用）同款配色。
- 左侧栏方案（`sidebar.panellist` + `main` 槽，全屏中栏面板）已按用户要求**整体移除**。

## 技术栈（用户 2026-11-10 定稿）

- **客户端 UI：React 18 + TS + TailwindCSS**（原计划同栈，用户中途要求试 Vue 后明确改回 React，Vue 方案已废弃）。
- Tailwind 用 `@tailwindcss/cli` 预编译：`src/client/tailwind.input.css` → `src/client/tailwind.gen.css`，
  由 tsdown 的 `dsh-css-inline` 插件内联成 `<style data-plugin>`；`tailwind.gen.css` 是构建产物，不进版本库。
- 客户端 bundle 是 `window.__ModuleLoader__` 闭包工厂；只外置 react / react-jsx-runtime，
  其余（含 Tailwind 样式）内联。改动 `src/client/**` 后需 `pnpm build` 重新生成 `lib/client.js`。

## 工程命令

```sh
pnpm install     # 首次；.npmrc/package.json 已声明 pnpm.ignoredBuiltDependencies 规避 ERR_PNPM_IGNORED_BUILDS
pnpm build       # tailwind → tsc 声明 → tsdown（产出 lib/index.js + lib/client.js + lib/types）
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run（tests/ 下 7 个 spec，92 用例）
```

> **pnpm 安装提示**：`ERR_PNPM_IGNORED_BUILDS` 对 `@deepseek-ai/dsh-subprocess-local`、`node-pty`、`koffi` 等
> **传递依赖**报错但依赖已正常落盘，不影响构建与运行；不要为此去执行它们的构建脚本。


## 概念命名（用户已选定 2026-11-10）

- 大任务 → **里程碑**（页签 M0/M1/M2…，名称用户自定义）
- 任务 → **事项**（里程碑下的卡片）
- 列 → **阶段**（带名字 + 颜色的流转环节）
- UI 文案：新建事项 / 新建里程碑 / 添加阶段 / 所属阶段 / 此阶段暂无事项 / 事项标题 / 删除阶段
- 数据模型对应：board.json 里 epics=里程碑、tasks=事项、columns=阶段；事项=某里程碑下带所属阶段的工作条目。

## 目录结构

```
src/
  index.ts                宿主入口：注册 /api/dsh-taskboard/* 路由（inject webServer + sessions，mountOnce 防重）
  core/board.ts           数据模型 + 整板校验 + 删除防护 + 默认板（宿主与浏览器半区共用）
  host/board-store.ts     board.json 读写：原子写、整板 CAS、坏 JSON 拒绝覆盖、缺文件时建默认板
  host/workspaces.ts      工作区枚举（sessions cwd ∪ projcache identity.cwd）与路径规范化
  host/routes.ts          三个路由：workspaces / board(GET+PUT) / health，全部走 loopback 围栏
  http.ts loopback.ts mount-once.ts   从 dsh-web 家族 vendored 的共用模块
  client/
    index.ts              客户端入口：注册 locale 字典 + 注册右侧栏页签类型（inject slots + locale + sidebarRightTabs）
    right-panel.tsx       右侧栏注册：页签类型 + guide 卡片 + 页签体/标题（slot key 为类型 id）
    controller.ts         框架无关的状态与全部看板操作（React 用 useSyncExternalStore 读）
    api.ts                同源 fetch 客户端（路由用文档相对路径，适配子路径部署）
    locales.ts            zh 为 key 源，en 完整对照
    view/                 React 看板 UI：TaskboardPanel（停靠栏）/ StageColumn / Modals / dnd（拖拽状态）/ icons / tint / GuideArtwork（卡片图标）
    tailwind.input.css    Tailwind 入口（@source "./" 扫描 view/）
design/                   Phase 0 设计稿（4 个 HTML + 生成器 + 截图）
tests/                    7 个 spec / 92 用例：board、board-store、workspaces、routes、controller、right-panel、tint
```

## 设计稿流程（ardot MCP）

> **转换器已知坑（2026-11-10）**：html_to_ardot 会把 CSS `flex:1` 占位元素转成零尺寸 Group（布局失效）；
> 工具行右对齐用 `justify-content: space-between` 双子组结构。**capture_screenshot 按源 HTML 意图渲染，
> 可能与画布节点树不一致，不能作为布局验收依据；布局验收必须用 capture_layout（默认只报问题节点，
> 零尺寸会报 ZERO_SIZE）或 batch_read（readDepth 2）读节点坐标。**

ardot MCP 在 `http://127.0.0.1:50501/api/v1/mcp`（本机 ardot 应用）。改设计稿：

1. 改 `build-design-html.mjs` → `node design/build-design-html.mjs` 重新生成 4 个 HTML；
2. MCP `register_assets`（contentType `text/html`，fileUrl `cocraft://localhost/file/745806795348219`）拿上传/下载地址；
3. `curl -X PUT <uploadUrl> -H "Content-Type: text/html" --data-binary @<html>`；
4. MCP `html_to_ardot`（htmlUrl=downloadUrl，pageId `0:1`，viewport `1549`）；
5. `batch_edit` 命名 + 按用户当前视口排布（fetch_editor_state 取 center；注意 `node -e` 传负数坐标要加 `--`）；
6. **布局验收**：`capture_layout`（parentId=帧 id）确认无 ZERO_SIZE，`batch_read`（readDepth 2）核对工具行
   按钮右缘 = 1501；若错，用 `design/tools/fix-toolbar.js`（工具行 layout:none + 显式 x，页签从 0 起、
   按钮从 1501 向左排，间距 10）生成 ops 后 `batch_edit` 执行；
7. `capture_screenshot` 仅作视觉回看（存 design/screenshots）。

## 设计决策（已与用户确认）

- 层级：工作区 → 里程碑页签（M0/M1/…）→ 事项卡片；**默认预置 1 个里程碑「M1」+ 前 4 个阶段**（初始化 / 执行中 / 待审核 / 已完成，不含「失败」），其余由用户「添加阶段」弹窗自建
  （填阶段名，颜色随机；8 色板仍可选），**阶段可自定义：名字 + 颜色**（列底色为阶段色低透明度叠加白底）。
- **里程碑右键菜单**：重命名 / 删除里程碑。**最后一个里程碑不可删**；仍有事项的里程碑也不可删（灰显 + 说明）。
- **事项右键菜单（2026-11-10）**：编辑 / 删除。编辑复用事项表单弹窗（`TaskFormModal`，新建/编辑共用：
  事项标题 + 所属阶段，预填当前值，提交按钮「保存」），改阶段 = 移到目标阶段末尾，一次 CAS 提交
  （`editTask(taskId, {title?, columnId?})`）；删除直接删，无防护（`removeTask`，卡片无依赖）。
  右键菜单壳与里程碑菜单共用（`view/TaskboardPanel.tsx` 里 `ContextMenu` + `MenuItem` +
  `useDismissOnOutside`）。
- 存储：`<工作区>/.dsh/taskboard/board.json`，整板 CAS（expectedRevision）。
- v1 纯手动 UI；agent 直接用文件工具改 JSON。
- 工作区/项目切换器：用户明确暂不做（2026-11-10），v1 面板只显示当前工作区看板。
- 工具行：里程碑页签在左；右侧按钮组「＋ 添加阶段」（白底描边胶囊）+「新建事项」（黑胶囊）**右对齐贴内容区右缘（节点树实测零偏差）**；页签行「＋」打开新建里程碑弹层（字段：名称）。
- 阶段轻量管理（2026-11-10 用户定稿，弃用大弹窗）：点列头**色块**（20px 圆 + 白色调色滴图标）弹小色板（8 预设色，点选改色）+「删除阶段」；**阶段名点击 inline 改名**；**新增阶段 = 工具行「＋ 添加阶段」按钮打开弹窗填阶段名，颜色随机**；预置阶段与新增阶段同规则。删除防护：阶段内仍有事项则禁止删除。空阶段只展示「此阶段暂无事项」说明文字（无虚线框无大按钮）。列头添加事项按钮为 24px 圆形描边按钮（加号图标）。
- 页面四周 24px 间隙；新建事项弹层字段用「所属阶段」（带色块下拉）。
- **拖动排序（2026-11-10）**：排序模型 = `board.columns` 数组顺序即阶段顺序、`board.tasks`
  数组顺序即展示顺序（无独立 order 字段，agent 改文件即可排序）。UI 上阶段列头与事项卡片各有一个
  六点把手：列头把手左右拖整列（阶段条上显示竖向插入条），卡片把手可在同阶段内排序、也可跨阶段拖动
  （列内显示横向插入条，按指针上下半定位插入间隙）。对应控制器操作 `moveTask(taskId, columnId, toIndex?)`、
  `moveStage(columnId, toIndex)`（无变化跳过提交）；拖拽状态（dragover 下读不到 DataTransfer）走
  `view/dnd.ts` 模块级槽位 + dragend 广播清插入条。
- UI 文案已定稿：概念名见上节；通用词（取消/创建/完成/名称）随用。
- **输入框 placeholder 一律用字段用途描述，不用示例值**（如「输入里程碑名称」而非「M4」），
  否则用户会误当成预填内容；中英文都遵守。

## Phase 1 实现要点（已完成）

- 插件包名 `dsh-client-ui-taskboard`（2026-11-10 由 `@linxin666/dsh-client-ui-taskboard` 去 scope 改名，
  package.json / cordis.patch.yml / tsdown ID / mountOnce / TASKBOARD_TAB_ID 五处同步）：宿主 cordis 插件注册
  `/api/dsh-taskboard/*`（loopback 围栏），客户端注册右侧栏页签类型 + guide 卡片；
  TS + React 18 + TailwindCSS + tsdown + vitest；经 `plugin_manager` 本地 link 安装（行 id `ui-taskboard`）。
- 行 id 必须写成 `ui-taskboard`（无内连字符），避免与家族聚合行 `ui-task-board`
  （`@linxin666/dsh-client-ui-task-board`，另一插件）在 loader 全局 id 空间里撞车；行 `name` 必须恰等于包名，
  否则 `dsh-client-modules` 不会把浏览器半区挂上。
- **插件列表显示名走 locale 多语言（2026-11-10 查证）**：管理页/设置页的显示名读插件导出的 `locale/*.json`
  里 `meta.title`/`meta.description`（`LocalizedText`，按界面语言选取，en 必备回退；缺失才回退 `package.json`
  的 `name`）。zh/en 均已写好：「任务看板」/ "Taskboard"；exports 用官方通配写法
  `"./locale/*.json": "./locale/*.json"`。包名本身是技术身份，无多语言，原样显示。
- **安装形态与 GitHub 安装可用性（2026-11-10 定稿：`lib/` 入库）**：GitHub 依赖 `github:ykcory/dsh-taskboard`
  由 pnpm 11 走 **codeload tarball 快路径**安装——不 clone 仓库、不跑任何构建脚本（且 pnpm 11 默认禁止
  git-hosted 依赖执行 prepare，需消费者 allowBuilds 放行）。曾因仓库不提交 `lib/` 又无 prepare，装出来没有
  `lib/index.js`，宿主报 `ERR_MODULE_NOT_FOUND`，行激活失败。**修复：`lib/` 构建产物改为入库**
  （.gitignore 已移除 `lib/`；`*.tsbuildinfo` 仍忽略），GitHub 安装零构建即用。
  **维护铁律：改动 `src/**` 后必须 `pnpm build`，并把更新后的 `lib/` 与源码一起 commit**，
  否则 GitHub 安装会装到旧产物；`link:` 本地形态无此要求（直连工作区目录，build 即生效）。
  症状自检法：`ls ~/.dsh/profiles/desktop/node_modules/dsh-client-ui-taskboard` 里没有 `lib/`，
  就是装到了不含产物的源码版本。
- API：`GET /workspaces`、`GET /board?ws=`、`PUT /board?ws=`（expectedRevision 整板 CAS；坏 JSON 拒绝覆盖；
  删阶段时阶段内仍有事项则阻止）；另 `GET /health`。
- 工作区枚举：宿主 sessions 服务 cwd ∪ `~/.dsh/storages/session_projcache/sessions/*.json` 的 `record.identity.cwd` 去重。
- 存储：`<工作区>/.dsh/taskboard/board.json`，原子写（temp + rename），缺文件时自动建默认板（1 个里程碑 M1 + 前 4 个预置阶段）。
- `~/.dsh/taskboard.sqlite` 与本插件无关，不读写。
- **已验证**：路由 HTTP 200、工作区枚举 4 个工作区、读写落盘、陈旧 revision 409、删非空阶段 409。
- **重启后生效**：宿主 bundle 行变化需重启 DSH 服务，agent 不自行重启。

