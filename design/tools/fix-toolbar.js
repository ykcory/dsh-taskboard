// 修复某帧工具行: 用法 node fix-toolbar.js <frameId>
// 输出可执行的 ops 文本(行分隔)
const FRAME = process.argv[2];
async function call(body){
  const res = await fetch("http://127.0.0.1:50501/api/v1/mcp", {
    method:"POST", headers:{"Content-Type":"application/json", Accept:"application/json, text/event-stream"},
    body: JSON.stringify(body)
  });
  const text = await res.text();
  const m = text.match(/^data: (.*)$/ms);
  return JSON.parse(m ? m[1] : text);
}
async function readNodes(ids, depth){
  const j = await call({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"batch_edit_read_placeholder"}});
  return j;
}
// 简化：直接用 MCP batch_read
async function batchRead(args){
  const j = await call({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"batch_read",arguments:{fileUrl:"cocraft://localhost/file/745806795348219",...args}}});
  return j.result ? JSON.parse(j.result.content.filter(i=>i.type==="text").map(i=>i.text).join("")) : null;
}
const FRAMEURL="cocraft://localhost/file/745806795348219";
const root = (await batchRead({nodeIds:[FRAME], readDepth:2})).data.nodes[0];
// 找 level-1 Frame（页面容器），其 children 里找工具行: layout=horizontal 且 h≈36
const pageFrame = root.children.find(c=>c.children && c.children.some(g=>g.layout==="horizontal" && Math.abs(g.height-36)<2));
const toolbar = pageFrame.children.find(c=>c.layout==="horizontal" && Math.abs(c.height-36)<2);
const tb = (await batchRead({nodeIds:[toolbar.id], readDepth:2})).data.nodes[0];
const kids = tb.children;
const spacer = kids.find(k=>k.type==="GROUP" || Math.abs(k.height)<1);
const buttons = kids.filter(k=>k!==spacer && Math.abs(k.height-36)<1); // 添加阶段(w104) + 新建事项(w88)
const tabs = kids.filter(k=>k!==spacer && !buttons.includes(k));
const GAP=10, RIGHT=1501;
const ops=[];
ops.push(`U("${toolbar.id}", {layout: "none"})`);
let x=0;
for(const t of tabs){ ops.push(`U("${t.id}", {x: ${x.toFixed(1)}, y: ${((36-t.height)/2).toFixed(1)}})`); x += t.width + GAP; }
if(spacer) ops.push(`D("${spacer.id}")`);
// 按钮从右往左摆
const ordered = [...buttons].reverse(); // 新建事项(w88)在后 → 先定它
let rx = RIGHT;
for(const b of ordered){
  rx -= b.width;
  ops.push(`U("${b.id}", {x: ${rx.toFixed(1)}, y: 0})`);
  rx -= GAP;
}
console.log(ops.join("\n"));
