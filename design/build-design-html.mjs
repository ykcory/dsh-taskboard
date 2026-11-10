// 任务看板插件设计稿生成器：产出 4 个静态 HTML（1549×875）
// 用法: node design/build-design-html.mjs
// 产物: design/board-main.html          主界面
//       design/board-create-task.html   新建事项弹层
//       design/board-create-epic.html   新建里程碑弹层
//       design/board-stage-popover.html 阶段色板弹层示意（执行中列色点弹出）
// 反馈修订记录：
// - 2026-11-10 a：四周 24px 间隙；阶段自定义（名字+颜色）；去掉工作区切换器
// - 2026-11-10 b：补「新建里程碑」弹窗；阶段支持增删
// - 2026-11-10 c：命名定稿（里程碑/事项/阶段）；工具行只留新建事项
// - 2026-11-10 e：html_to_ardot 会把 flex:1 占位元素压成零尺寸（工具行右对齐失效），
//                 改用 space-between 双子组结构；导入后必须用 capture_layout/batch_read
//                 核对工具行（capture_screenshot 渲染可能与节点树不一致，不可作为布局依据）
// - 2026-11-10 d：
//   · 「添加阶段」做成按钮，与「新建事项」并排、工具行右对齐；看板末尾幽灵列删除
//   · 空阶段不放大虚线框，只展示说明文字
//   · 阶段头色块加大（20px）并内置调色图标，示意可点击改色
//   · 列头右上角添加按钮改为 24px 圆形描边按钮（含加号图标）
// 命名：大任务→里程碑，任务→事项，列→阶段
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// 阶段预设色板（点列头色块弹出）
const palette = [
  "#7d8b99", // 灰
  "#e2a53d", // 橙
  "#3fa455", // 绿
  "#4a72d8", // 蓝
  "#e05252", // 红
  "#9a6bd8", // 紫
  "#e56aa2", // 粉
  "#2fb5c2", // 青
];

// 阶段 = 名字 + 颜色；项目初始化预置这五个，均可改名/改色/删除，也可新增（颜色随机）
const columns = [
  { key: "init", name: "初始化", dot: "#7d8b99", bg: "#f1f2f4" },
  { key: "run", name: "执行中", dot: "#e2a53d", bg: "#fdf3df" },
  { key: "review", name: "待审核", dot: "#3fa455", bg: "#e7f4e6" },
  { key: "done", name: "已完成", dot: "#4a72d8", bg: "#e4e9f8" },
  { key: "fail", name: "失败", dot: "#e05252", bg: "#fdeaea" },
];

const tasks = {
  init: [
    "M1 进货单 / 销售单（审核驱动库存与移动加权成本）",
    "M1 其他出入库 / 调拨 / 盘点",
    "M1 收款单 / 付款单 / 其他收支",
    "M1 即时库存 / 库存流水 / 进销存汇总（替换 mock 与假数据）",
    "M1 应收应付明细与汇总",
    "M1 打印模板（销售单 / 进货单 A4 与针式小票）",
    "M1 客户预存（充值 / 额度账 / 流水，fin_prepay）",
    "M1 平台侧账套备份下载 / 恢复上传",
  ],
  run: ["M1 单据审核流转联调（审核驱动库存与成本）"],
  review: ["M1 期初建账 + 期初应收应付接口", "M1 进销存汇总报表导出（A4）"],
  done: ["M1 工程骨架与仓库初始化（api / web 拆分）"],
  fail: [],
};

const chevronSvg = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="#6b7076" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// 色块内置的白色调色滴图标（示意可点改色）
const chipIcon = `<svg width="10" height="10" viewBox="0 0 12 12"><path d="M6 1.2 C6 1.2 2.4 5.4 2.4 8 a3.6 3.6 0 0 0 7.2 0 C9.6 5.4 6 1.2 6 1.2 Z" fill="#ffffff"/></svg>`;
// 列头添加按钮的加号图标
const plusIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2.2 V9.8 M2.2 6 H9.8" stroke="#4a4d52" stroke-width="1.4" stroke-linecap="round"/></svg>`;
// 工具行「添加阶段」按钮的小加号
const plusSmall = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2.2 V9.8 M2.2 6 H9.8" stroke="#6b7076" stroke-width="1.4" stroke-linecap="round"/></svg>`;

const css = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1549px; height: 875px; overflow: hidden; }
body {
  font-family: -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  background: #ffffff;
}
/* 页面包裹层：四周 24px 间隙 */
.page {
  width: 1549px; height: 875px; padding: 24px;
  display: flex; flex-direction: column; position: relative;
}
/* 工具行：里程碑页签在左；「添加阶段」「新建事项」按钮组右对齐（贴内容区右缘） */
.toolbar { display: flex; flex-direction: row; align-items: center; justify-content: space-between; height: 36px; }
.toolbar .tabs-group { display: flex; flex-direction: row; align-items: center; gap: 10px; }
.toolbar .actions-group { display: flex; flex-direction: row; align-items: center; gap: 10px; }
.tab {
  background: #f2f3f5; color: #4a4d52; font-size: 13px; font-weight: 500;
  border-radius: 999px; padding: 8px 16px;
}
.tab.active { background: #1c1e21; color: #ffffff; }
.tab-add { background: #f2f3f5; color: #9aa0a8; font-size: 15px; border-radius: 999px; padding: 6px 14px; }
.btn-stage {
  background: #ffffff; border: 1px solid #e3e5e8; color: #4a4d52;
  font-size: 13px; font-weight: 500; border-radius: 999px; padding: 8px 16px;
  display: flex; flex-direction: row; align-items: center; gap: 6px;
}
.btn-new {
  background: #1c1e21; color: #ffffff; font-size: 13px; font-weight: 500;
  border-radius: 999px; padding: 9px 18px; display: flex; align-items: center;
}
.board { display: flex; flex-direction: row; gap: 14px; height: 733px; margin-top: 14px; }
.column { flex: 1; border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: visible; position: relative; }
.col-head { display: flex; flex-direction: row; align-items: center; padding: 14px 14px 10px; gap: 8px; }
/* 阶段色块：20px 圆 + 白色调色图标，示意可点击改色 */
.chip { width: 20px; height: 20px; border-radius: 999px; display: flex; flex-direction: row; align-items: center; justify-content: center; }
.chip svg { display: block; }
.col-name { font-size: 13px; font-weight: 600; color: #2f3237; }
.col-count { font-size: 12px; color: #9aa0a8; }
/* 列头添加按钮：24px 圆形描边按钮 */
.col-add {
  margin-left: auto; width: 24px; height: 24px; border-radius: 999px;
  background: #ffffff; border: 1px solid rgba(0,0,0,0.10);
  display: flex; flex-direction: row; align-items: center; justify-content: center;
}
.col-add svg { display: block; }
.col-body { display: flex; flex-direction: column; gap: 10px; padding: 0 10px 10px; overflow: hidden; flex: 1; min-height: 0; }
.card {
  background: #ffffff; border: 1px solid rgba(0,0,0,0.06); border-radius: 10px;
  padding: 12px 12px; font-size: 13px; line-height: 1.55; color: #33363b;
}
/* 空阶段：只展示说明文字 */
.col-empty { flex: 1; display: flex; flex-direction: row; align-items: center; justify-content: center; font-size: 12px; color: #b0b6bd; }
/* 阶段色板 popover：点列头色块弹出（改色；含删除阶段） */
.pop {
  position: absolute; top: 44px; left: 12px; background: #ffffff; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15); padding: 12px 12px 8px; z-index: 5;
  display: flex; flex-direction: column; gap: 10px; width: 236px;
}
.pop .colors { display: flex; flex-direction: row; gap: 9px; }
.pop .opt { width: 18px; height: 18px; border-radius: 999px; }
.pop .opt.selected { box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #1c1e21; }
.pop .del { font-size: 12px; color: #e05252; }
.overlay { position: absolute; left: 0; top: 0; width: 1549px; height: 875px; background: rgba(15,17,20,0.4); display: flex; align-items: center; justify-content: center; }
.modal { background: #ffffff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.18); }
.modal-head { display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 18px 20px 14px; }
.modal-title { font-size: 15px; font-weight: 600; color: #1e2126; }
.modal-close { font-size: 16px; color: #9aa0a8; }
.modal-body { padding: 2px 20px 6px; display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 8px; }
.label { font-size: 13px; color: #4a4d52; }
.input, .select {
  height: 40px; border: 1px solid #e3e5e8; border-radius: 8px; padding: 0 12px;
  font-size: 13px; color: #33363b; display: flex; flex-direction: row; align-items: center; justify-content: space-between;
}
.input .ph { color: #b3b8bf; }
.modal-foot { display: flex; flex-direction: row; justify-content: flex-end; gap: 10px; padding: 14px 20px 20px; }
.btn { border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 500; }
.btn-secondary { background: #f2f3f5; color: #3a3d42; }
.btn-primary { background: #1c1e21; color: #ffffff; }
`;

function toolbar() {
  const items = ["M0", "M1", "M2", "M3"].map((t, i) => `<div class="tab${i === 1 ? " active" : ""}">${t}</div>`).join("\n    ");
  return `<div class="toolbar">
  <div class="tabs-group">
    ${items}
    <div class="tab-add">+</div>
  </div>
  <div class="actions-group">
    <div class="btn-stage">${plusSmall}<span>添加阶段</span></div>
    <div class="btn-new">新建事项</div>
  </div>
</div>`;
}

function column(col, pop = false) {
  const list = tasks[col.key] ?? [];
  const cards = list.map((t) => `<div class="card">${t}</div>`).join("\n    ");
  const body = list.length
    ? `<div class="col-body">\n    ${cards}\n  </div>`
    : `<div class="col-body">\n    <div class="col-empty">此阶段暂无事项</div>\n  </div>`;
  const popHtml = pop
    ? `<div class="pop">
    <div class="colors">${palette
      .map((p) => `<div class="opt${p === col.dot ? " selected" : ""}" style="background:${p}"></div>`)
      .join("")}</div>
    <div class="del">删除阶段</div>
  </div>`
    : "";
  return `<div class="column" style="background:${col.bg}">
  <div class="col-head">
    <div class="chip" style="background:${col.dot}">${chipIcon}</div>
    <div class="col-name">${col.name}</div>
    <div class="col-count">${list.length}</div>
    <div class="col-add">${plusIcon}</div>
  </div>
  ${body}
  ${popHtml}
</div>`;
}

function board({ popInRun = false } = {}) {
  return `<div class="board">
  ${columns.map((c) => column(c, popInRun && c.key === "run")).join("\n")}
</div>`;
}

function page({ overlay = "", popInRun = false } = {}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>任务看板设计稿</title>
<style>${css}</style>
</head>
<body>
<div class="page">
  ${toolbar()}
  ${board({ popInRun })}
  ${overlay}
</div>
</body>
</html>
`;
}

const overlayCreate = `<div class="overlay">
  <div class="modal" style="width: 440px;">
    <div class="modal-head">
      <div class="modal-title">新建事项</div>
      <div class="modal-close">×</div>
    </div>
    <div class="modal-body">
      <div class="field">
        <div class="label">事项标题</div>
        <div class="input"><span class="ph">事项标题</span></div>
      </div>
      <div class="field">
        <div class="label">所属阶段</div>
        <div class="select">
          <span style="display:flex; flex-direction:row; align-items:center; gap:8px;"><span class="chip" style="background:#7d8b99;">${chipIcon}</span><span>初始化</span></span>
          ${chevronSvg}
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <div class="btn btn-secondary">取消</div>
      <div class="btn btn-primary">创建</div>
    </div>
  </div>
</div>`;

const overlayCreateEpic = `<div class="overlay">
  <div class="modal" style="width: 440px;">
    <div class="modal-head">
      <div class="modal-title">新建里程碑</div>
      <div class="modal-close">×</div>
    </div>
    <div class="modal-body">
      <div class="field">
        <div class="label">名称</div>
        <div class="input"><span class="ph">M4</span></div>
      </div>
    </div>
    <div class="modal-foot">
      <div class="btn btn-secondary">取消</div>
      <div class="btn btn-primary">创建</div>
    </div>
  </div>
</div>`;

mkdirSync(here, { recursive: true });
writeFileSync(join(here, "board-main.html"), page());
writeFileSync(join(here, "board-create-task.html"), page({ overlay: overlayCreate }));
writeFileSync(join(here, "board-create-epic.html"), page({ overlay: overlayCreateEpic }));
writeFileSync(join(here, "board-stage-popover.html"), page({ popInRun: true }));
console.log("written 4 html files to", here);
