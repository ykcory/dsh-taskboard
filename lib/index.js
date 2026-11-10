import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
// src/core/board.ts
/**
* The milestone a fresh board starts with.
*
* A board always shows at least one tab (the last one cannot be removed), so
* a new board opens on M1 rather than an empty tab row.
*/
const DEFAULT_EPICS = [{
	id: "epic-m1",
	name: "M1"
}];
/**
* The stages a fresh board starts with: the first four presets.
*
* The five-color preset list stays available in the stage color popover and
* the palette, but a new board opens on this four-stage pipeline (the former
* fifth stage, 失败, is not part of the default flow).
*/
const DEFAULT_COLUMNS = [
	{
		id: "col-init",
		name: "初始化",
		color: "#7d8b99"
	},
	{
		id: "col-run",
		name: "执行中",
		color: "#e2a53d"
	},
	{
		id: "col-review",
		name: "待审核",
		color: "#3fa455"
	},
	{
		id: "col-done",
		name: "已完成",
		color: "#4a72d8"
	}
];
/** Hard size bounds keeping one board file small and the shape checks cheap. */
const BOARD_LIMITS = {
	/** Max bytes of one board.json file the host accepts. */
	fileBytes: 524288,
	/** Max bytes of one PUT request body. */
	putBodyBytes: 524288,
	epics: 100,
	columns: 24,
	tasks: 2e3,
	/** Max characters of an epic/stage name. */
	nameLength: 200,
	/** Max characters of a task title. */
	titleLength: 500
};
/** Id grammar shared by epics, columns and tasks (readable for agents). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/**
* Validate one parsed board document (shape + referential integrity + id
* uniqueness). The revision is checked for shape only — the store assigns a
* fresh revision on save.
* @param value - the parsed JSON value.
* @returns the validated board or the first failing reason.
*/
function validateBoard(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {
		ok: false,
		reason: "board must be a JSON object"
	};
	const raw = value;
	const revision = raw["revision"];
	if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return {
		ok: false,
		reason: "board.revision must be a non-negative integer"
	};
	const epics = raw["epics"];
	if (!Array.isArray(epics)) return {
		ok: false,
		reason: "board.epics must be an array"
	};
	if (epics.length > BOARD_LIMITS.epics) return {
		ok: false,
		reason: `board.epics exceeds ${BOARD_LIMITS.epics} entries`
	};
	const epicIds = /* @__PURE__ */ new Set();
	for (const entry of epics) {
		const fail = validateEpic(entry, epicIds);
		if (fail !== void 0) return {
			ok: false,
			reason: fail
		};
	}
	const columns = raw["columns"];
	if (!Array.isArray(columns)) return {
		ok: false,
		reason: "board.columns must be an array"
	};
	if (columns.length > BOARD_LIMITS.columns) return {
		ok: false,
		reason: `board.columns exceeds ${BOARD_LIMITS.columns} entries`
	};
	const columnIds = /* @__PURE__ */ new Set();
	for (const entry of columns) {
		const fail = validateColumn(entry, columnIds);
		if (fail !== void 0) return {
			ok: false,
			reason: fail
		};
	}
	const tasks = raw["tasks"];
	if (!Array.isArray(tasks)) return {
		ok: false,
		reason: "board.tasks must be an array"
	};
	if (tasks.length > BOARD_LIMITS.tasks) return {
		ok: false,
		reason: `board.tasks exceeds ${BOARD_LIMITS.tasks} entries`
	};
	const taskIds = /* @__PURE__ */ new Set();
	for (const entry of tasks) {
		const fail = validateTask(entry, taskIds, epicIds, columnIds);
		if (fail !== void 0) return {
			ok: false,
			reason: fail
		};
	}
	return {
		ok: true,
		board: {
			revision,
			epics,
			columns,
			tasks
		}
	};
}
/** Validate one epic entry; a string result is the failure reason. */
function validateEpic(value, ids) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return "board.epics entries must be objects";
	const epic = value;
	const id = epic["id"];
	if (typeof id !== "string" || !ID_PATTERN.test(id)) return "board.epics[].id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}";
	if (ids.has(id)) return `board.epics[].id duplicated: ${id}`;
	const name = epic["name"];
	if (typeof name !== "string" || name.length > BOARD_LIMITS.nameLength) return `board.epics[].name must be a string of at most ${BOARD_LIMITS.nameLength} characters`;
	ids.add(id);
}
/** Validate one column entry; a string result is the failure reason. */
function validateColumn(value, ids) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return "board.columns entries must be objects";
	const column = value;
	const id = column["id"];
	if (typeof id !== "string" || !ID_PATTERN.test(id)) return "board.columns[].id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}";
	if (ids.has(id)) return `board.columns[].id duplicated: ${id}`;
	const name = column["name"];
	if (typeof name !== "string" || name.length > BOARD_LIMITS.nameLength) return `board.columns[].name must be a string of at most ${BOARD_LIMITS.nameLength} characters`;
	const color = column["color"];
	if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return "board.columns[].color must be a #rrggbb hex color";
	ids.add(id);
}
/** Validate one task entry; a string result is the failure reason. */
function validateTask(value, taskIds, epicIds, columnIds) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return "board.tasks entries must be objects";
	const task = value;
	const id = task["id"];
	if (typeof id !== "string" || !ID_PATTERN.test(id)) return "board.tasks[].id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}";
	if (taskIds.has(id)) return `board.tasks[].id duplicated: ${id}`;
	const epicId = task["epicId"];
	if (typeof epicId !== "string" || !epicIds.has(epicId)) return "board.tasks[].epicId must reference an existing epic";
	const columnId = task["columnId"];
	if (typeof columnId !== "string" || !columnIds.has(columnId)) return "board.tasks[].columnId must reference an existing column";
	const title = task["title"];
	if (typeof title !== "string" || title.length === 0 || title.length > BOARD_LIMITS.titleLength) return `board.tasks[].title must be a non-empty string of at most ${BOARD_LIMITS.titleLength} characters`;
	const createdAt = task["createdAt"];
	if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return "board.tasks[].createdAt must be a finite number (epoch ms)";
	taskIds.add(id);
}
/**
* Guard applied on save when a save removes columns: a stage that still holds
* tasks must not be removed (project AGENTS.md 删除防护).
* @param current - the board currently on disk.
* @param incoming - the validated replacement board.
* @returns the first still-populated removed column name, or undefined.
*/
function firstRemovedNonEmptyColumn(current, incoming) {
	const kept = new Set(incoming.columns.map((column) => column.id));
	const removedIds = new Set(current.columns.filter((column) => !kept.has(column.id)).map((column) => column.id));
	if (removedIds.size === 0) return void 0;
	const blocked = current.tasks.find((task) => removedIds.has(task.columnId));
	if (blocked === void 0) return void 0;
	return current.columns.find((column) => column.id === blocked.columnId)?.name ?? blocked.columnId;
}
/** Fresh board contents: revision 1, one milestone, the four preset stages, no work. */
function defaultBoard() {
	return {
		revision: 1,
		epics: DEFAULT_EPICS.map((epic) => ({ ...epic })),
		columns: DEFAULT_COLUMNS.map((column) => ({ ...column })),
		tasks: []
	};
}
// src/host/board-store.ts
/**
* Board file storage under `<workspace>/.dsh/taskboard/board.json`.
*
* One JSON document per workspace, whole-board CAS: every save names the
* revision it observed, and the server refuses to overwrite when the file has
* moved on — or when the file on disk is not valid JSON (a hand edit in
* progress must never be silently clobbered; the agent half edits this file
* with plain file tools).
*/
/** Absolute path of one workspace's board file. */
function boardFilePath(workspace) {
	return join(workspace, ".dsh", "taskboard", "board.json");
}
/**
* Read and validate one workspace's board file.
* @param workspace - absolute workspace root.
* @returns the parsed board, missing when no file exists, invalid with the
*   first failing reason when the file exists but is unusable.
*/
async function readBoard(workspace) {
	const path = boardFilePath(workspace);
	let size;
	try {
		size = (await stat(path)).size;
	} catch {
		return { status: "missing" };
	}
	if (size > BOARD_LIMITS.fileBytes) return {
		status: "invalid",
		reason: `board file exceeds ${BOARD_LIMITS.fileBytes} bytes`
	};
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return {
			status: "invalid",
			reason: error instanceof Error ? error.message : String(error)
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			status: "invalid",
			reason: `board file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	const checked = validateBoard(parsed);
	return checked.ok ? {
		status: "ok",
		board: checked.board
	} : {
		status: "invalid",
		reason: checked.reason
	};
}
/**
* Save one whole board with optimistic concurrency.
*
* - A missing file starts from revision 0, so a first save may name 0.
* - An existing file that is not valid JSON refuses every save (the human or
*   agent editing it by hand wins over the GUI).
* - `expectedRevision` must equal the revision on disk; the written revision
*   is that value plus one.
* - A save that removes a column which still holds tasks is refused.
* @param workspace - absolute workspace root.
* @param expectedRevision - the revision the caller based the edit on.
* @param incoming - the replacement board (its revision field is overwritten).
* @returns the saved board with its fresh revision, or the HTTP status and
*   error message to answer with.
*/
async function saveBoard(workspace, expectedRevision, incoming) {
	const current = await readBoard(workspace);
	if (current.status === "invalid") return {
		ok: false,
		httpStatus: 409,
		error: "board file on disk is not usable; fix or remove it before saving"
	};
	const currentRevision = current.status === "ok" ? current.board.revision : 0;
	if (expectedRevision !== currentRevision) return {
		ok: false,
		httpStatus: 409,
		error: `revision conflict: expected ${expectedRevision}, current ${currentRevision}; reload the board and retry`
	};
	const checked = validateBoard(incoming);
	if (!checked.ok) return {
		ok: false,
		httpStatus: 400,
		error: checked.reason
	};
	if (current.status === "ok") {
		const blocked = firstRemovedNonEmptyColumn(current.board, checked.board);
		if (blocked !== void 0) return {
			ok: false,
			httpStatus: 409,
			error: `stage "${blocked}" still has items; move or remove them first`
		};
	}
	const board = {
		...checked.board,
		revision: currentRevision + 1
	};
	try {
		await writeBoardFile(workspace, board);
	} catch (error) {
		return {
			ok: false,
			httpStatus: 500,
			error: error instanceof Error ? error.message : String(error)
		};
	}
	return {
		ok: true,
		board
	};
}
/**
* Atomically write one board file: mkdir -p, write a unique temp file in the
* same directory, rename over the target. A crashed write therefore never
* leaves a half-written board behind.
*/
async function writeBoardFile(workspace, board) {
	const path = boardFilePath(workspace);
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
	const body = `${JSON.stringify(board, null, 2)}\n`;
	await writeFile(temp, body, "utf8");
	await rename(temp, path);
}
/**
* Read one board, creating the default one (five preset stages, revision 1)
* when no file exists yet. An existing but invalid file is NOT replaced —
* the caller answers the reason so the panel can surface it.
* @param workspace - absolute workspace root.
* @returns the board plus whether this call created the file.
*/
async function readOrInitBoard(workspace) {
	const current = await readBoard(workspace);
	if (current.status === "ok") return {
		board: current.board,
		created: false
	};
	if (current.status === "invalid") return { error: current.reason };
	const saved = await saveBoard(workspace, 0, defaultBoard());
	if (!saved.ok) return { error: saved.error };
	return {
		board: saved.board,
		created: true
	};
}
// src/http.ts
/** Default body cap for readJsonBody: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 65536;
/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"referrer-policy": "no-referrer"
};
/**
* Lenient bounded body reader: parse a request body as JSON, or null on an
* empty body, invalid JSON, or a body past maxBytes. Overflow destroys the
* request instead of draining the remainder; callers must not keep reading
* the request afterwards. With objectOnly, non-JSON-object payloads also
* yield null.
*/
async function readJsonBody(req, opts = {}) {
	const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) {
			req.destroy();
			return null;
		}
		chunks.push(buffer);
	}
	let parsed;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return null;
	}
	if (opts.objectOnly === true && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) return null;
	return parsed;
}
/** Narrow a value to a JSON object, or undefined when it is not one. */
function asJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/**
* Write one JSON response. Default headers are the family defaults
* (content-type and referrer-policy); caller headers are appended or
* override them.
*/
function writeJson(res, status, body, headers) {
	res.writeHead(status, headers === void 0 ? { ...JSON_HEADERS } : {
		...JSON_HEADERS,
		...headers
	});
	res.end(JSON.stringify(body));
}
// src/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
/**
* Whether a reverse proxy stood between the client and this host: the request
* carries CF-Connecting-IP or X-Forwarded-For. Either header is stamped by a
* hop that forwards traffic, so the request did not originate on this machine.
*/
function isProxiedRequest(request) {
	return request.headers["cf-connecting-ip"] !== void 0 || request.headers["x-forwarded-for"] !== void 0;
}
/**
* Request-level trust fence: a loopback socket address AND a loopback Host
* header, plus browser same-origin markers. The socket address is
* authoritative for a direct connection; a request that carries a forwarding
* header is refused outright.
*/
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	if (isProxiedRequest(request)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
// src/host/workspaces.ts
/**
* Workspace enumeration for the per-workspace boards.
*
* The candidate set is the union of the running sessions' cwds (host
* `sessions` service) and every cwd recorded in the session projection cache
* (`~/.dsh/storages/session_projcache/sessions/session-*.json`,
* `record.identity.cwd`), deduplicated by absolute path. The first session
* cwd counts as the active workspace.
*/
/** Cap on the projcache files read per request (a stale cache must not stall the route). */
const PROJCACHE_MAX_FILES = 500;
/**
* Deduplicate session cwds and projcache cwds into workspace rows. The first
* session cwd is the active workspace; a cwd that also appears later keeps
* one row. Entries that are not absolute paths are dropped.
*/
function dedupeWorkspaces(sessionCwds, projcacheCwds) {
	const rows = /* @__PURE__ */ new Map();
	const add = (cwd, active) => {
		const trimmed = cwd.trim();
		if (trimmed === "" || !isAbsolute(trimmed)) return;
		const key = resolve(trimmed);
		if (rows.has(key)) return;
		rows.set(key, {
			cwd: key,
			name: basename(key) || key,
			active
		});
	};
	sessionCwds.forEach((cwd, index) => {
		add(cwd, index === 0);
	});
	for (const cwd of projcacheCwds) add(cwd, false);
	return [...rows.values()];
}
/**
* Read every projcache session record's identity cwd. The directory shape is
* `<dshHome>/storages/session_projcache/sessions/session-*.json`; anything
* unreadable degrades to an empty list (this source only widens the set —
* the running sessions remain).
* @param dshHome - the DSH home root.
*/
async function projcacheCwds(dshHome) {
	const dir = join(dshHome, "storages", "session_projcache", "sessions");
	let names;
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const cwds = [];
	for (const name of names.slice(0, PROJCACHE_MAX_FILES)) {
		if (!name.endsWith(".json")) continue;
		try {
			const text = await readFile(join(dir, name), "utf8");
			const cwd = JSON.parse(text).record?.identity?.cwd;
			if (typeof cwd === "string" && cwd !== "") cwds.push(cwd);
		} catch {}
	}
	return cwds;
}
/**
* Normalize one workspace root: absolute, no `.` / `..` segments, resolved.
* The write routes create directories under this root, so a relative or
* traversal path is refused rather than resolved against a surprise base.
*/
function normalizeWorkspaceRoot(value) {
	const trimmed = value.trim();
	if (trimmed === "" || !isAbsolute(trimmed)) return void 0;
	const segments = trimmed.split(/[\\/]+/).filter((segment) => segment !== "");
	if (segments.includes(".") || segments.includes("..")) return void 0;
	return resolve(trimmed);
}
// src/host/routes.ts
/** Route paths (client bundle mirrors these literals; tests assert both sides). */
const ROUTES = {
	workspaces: "/api/dsh-taskboard/workspaces",
	board: "/api/dsh-taskboard/board",
	health: "/api/dsh-taskboard/health"
};
/**
* Build every /api/dsh-taskboard route (exact paths).
* @param ctx - host context (kept for family shape parity).
* @param deps - injectable route dependencies.
* @returns the route list for ctx.webServer.register.
*/
function makeRoutes(ctx, deps) {
	const guard = (req, res) => {
		if (isLoopbackRequest(req)) return true;
		writeJson(res, 403, { error: "loopback only" });
		return false;
	};
	const workspacePayload = (workspace) => ({
		cwd: workspace,
		name: workspace.split(/[\\/]+/).pop() || workspace
	});
	return [
		{
			kind: "exact",
			path: ROUTES.workspaces,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				try {
					writeJson(res, 200, { workspaces: dedupeWorkspaces(deps.sessionCwds(), await deps.projcacheCwds()) });
				} catch (error) {
					deps.logger.warn(error);
					writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		},
		{
			kind: "exact",
			path: ROUTES.board,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				try {
					const override = new URL(req.url ?? "/", "http://localhost").searchParams.get("ws") ?? void 0;
					const workspace = deps.resolveWorkspace(override);
					if (workspace === void 0) {
						writeJson(res, 400, { error: "ws must be an absolute workspace path" });
						return;
					}
					if (req.method === "GET") {
						const result = await deps.readOrInitBoard(workspace);
						if ("error" in result) {
							writeJson(res, 409, { error: result.error });
							return;
						}
						writeJson(res, 200, {
							workspace: workspacePayload(workspace),
							board: result.board
						});
						return;
					}
					if (req.method === "PUT") {
						const body = asJsonObject(await readJsonBody(req, {
							maxBytes: BOARD_LIMITS.putBodyBytes,
							objectOnly: true
						}));
						if (body === void 0) {
							writeJson(res, 400, { error: "body must be a JSON object with expectedRevision and board" });
							return;
						}
						const expectedRevision = body["expectedRevision"];
						if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
							writeJson(res, 400, { error: "expectedRevision must be a non-negative integer" });
							return;
						}
						const saved = await deps.saveBoard(workspace, expectedRevision, body["board"]);
						if (!saved.ok) {
							writeJson(res, saved.httpStatus, { error: saved.error });
							return;
						}
						writeJson(res, 200, {
							workspace: workspacePayload(workspace),
							board: saved.board
						});
						return;
					}
					writeJson(res, 405, { error: "method not allowed" });
				} catch (error) {
					deps.logger.warn(error);
					writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		},
		{
			kind: "exact",
			path: ROUTES.health,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				writeJson(res, 200, {
					ok: true,
					plugin: "taskboard",
					skill: deps.skillStatus(),
					skillDebug: deps.skillDebug()
				});
			}
		}
	];
}
/**
* The skill body. Facts mirror src/core/board.ts (validation limits, id
* grammar, ordering model) and src/host/board-store.ts (CAS revision,
* corrupt-JSON refusal) — update both sides together.
*/
const TASKBOARD_SKILL = {
	name: "taskboard",
	source: "runtime",
	description: "操作本工作区的任务看板（任务看板面板的数据文件，存于 <工作区>/.dsh/taskboard/board.json）。当用户要求更新任务、新增/移动/删除事项、调整里程碑或阶段、改看板排序，或提到任务看板、board.json 时使用。",
	content: `任务看板数据存于 <工作区>/.dsh/taskboard/board.json，单个 JSON 文档，无数据库，AI 可直接用文件工具读写。

结构（概念：epics=里程碑页签，columns=阶段，tasks=事项）：
- \`epics[]\`：\`{ id, name }\`。
- \`columns[]\`：\`{ id, name, color }\`，color 为 #rrggbb。
- \`tasks[]\`：\`{ id, epicId, columnId, title, createdAt }\`，epicId/columnId 必须引用已存在条目，createdAt 为 epoch ms。

操作规则：
- 数组顺序即展示顺序：\`columns\` 数组顺序 = 阶段列顺序；\`tasks\` 数组顺序 = 同一里程碑同一阶段内卡片顺序。排序/移动 = 调整数组位置；跨阶段移动改 \`columnId\`。
- 改前先重新读一次文件，改完整体写回；\`revision\` 必须在原值上 +1（面板靠它做并发防护，不递增会被面板的下一次保存覆盖）。
- 整个文件必须保持合法 JSON：写坏会让看板面板拒绝加载，且宿主拒绝一切保存。
- \`id\` 在各自集合内唯一，且匹配 \`[A-Za-z0-9][A-Za-z0-9_-]{0,63}\`，建议前缀 epic- / col- / task-。
- 容量上限：里程碑 100、阶段 24、事项 2000；name ≤200 字符，title 非空且 ≤500 字符。
- 删除阶段前先移走或删除该阶段内全部事项（保存路径会拒绝删除非空阶段）。
- 面板不轮询文件：直接改文件后，面板需重新加载才可见。`
};
/**
* Register the skill into the host skills service. Defensive by design: the
* inject list guarantees the service at apply time, but a degraded registry
* (missing register, throwing call) must never take the board routes down
* with it — the outcome is reported instead.
* @param skills - the skills service face (may be undefined).
* @param warn - sink for registration failures (plugin logger).
* @returns what happened, including the service disposer when registered.
*/
function registerBoardSkill(skills, warn) {
	const register = skills?.register;
	if (typeof register !== "function") return { status: "service-missing" };
	try {
		const result = register(TASKBOARD_SKILL);
		return {
			status: "registered",
			disposer: typeof result === "function" ? result : void 0
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stack = error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : void 0;
		warn(`taskboard skill registration failed: ${message}`);
		return {
			status: "failed",
			error: message,
			stack
		};
	}
}
// src/mount-once.ts
/**
* Host single-instance guard. The aggregate family bundle and a standalone
* install of the same package can coexist in one profile, so a second host
* apply must be a no-op instead of re-registering the same webserver routes
* and failing the boot.
*
* A no-op is only safe while the holder is ALIVE. The Host reloads a profile
* by creating the new loader entries before the old ones are torn down, so
* the new entry may mount while the previous one still owns the name; a
* refused mount dropped there would lose the plugin for good. The refused
* mount is therefore QUEUED, not dropped, and replayed the moment the holder
* releases the name — if the waiting fiber is still alive then.
*
* The registry rides a global symbol so two module instances of the same
* package (npm copy vs repository link) still share one verdict.
*
* cordis `ctx.effect` runs its callback immediately and treats the callback's
* return value as the fiber disposer, so the unmarker is returned, not run.
*/
/** Published cross-repository contract: package names currently mounted. */
const MOUNTED = Symbol.for("dsh-web.mounted-plugins");
/** Additive key this guard owns: refused mounts waiting for the name. */
const WAITERS = Symbol.for("dsh-web.mounted-plugins.waiters");
/** The shared name registry, always a `Set` whatever another build stored there. */
function mountedSet() {
	const registry = globalThis;
	const existing = registry[MOUNTED];
	if (existing instanceof Set) return existing;
	const created = /* @__PURE__ */ new Set();
	registry[MOUNTED] = created;
	return created;
}
/** Queue per package name for mounts refused while a holder was alive. */
function mountWaiters() {
	const registry = globalThis;
	const existing = registry[WAITERS];
	if (existing instanceof Map) return existing;
	const created = /* @__PURE__ */ new Map();
	registry[WAITERS] = created;
	return created;
}
/**
* Wrap a cordis plugin apply so the package runs at most once per process.
* The first mount registers normally and releases the name when its fiber
* disposes; a mount refused while that name is held waits for the release and
* then runs, unless its own fiber disposes first.
* @param packageName - npm package identity shared by every install source.
* @param fn - the original plugin apply.
* @returns an apply of the same shape.
*/
function mountOnce(packageName, fn) {
	const mount = (...args) => {
		const mounted = mountedSet();
		const ctx = args[0];
		if (mounted.has(packageName)) {
			const waiters = mountWaiters();
			const queue = waiters.get(packageName) ?? [];
			let alive = true;
			const pending = { run: () => {
				if (alive) mount(...args);
			} };
			ctx?.effect?.(() => () => {
				alive = false;
				const index = queue.indexOf(pending);
				if (index >= 0) queue.splice(index, 1);
			});
			queue.push(pending);
			waiters.set(packageName, queue);
			return;
		}
		mounted.add(packageName);
		ctx?.effect?.(() => () => {
			mounted.delete(packageName);
			const waiters = mountWaiters();
			const queue = waiters.get(packageName);
			if (queue === void 0) return;
			waiters.delete(packageName);
			for (const waiter of queue.splice(0)) queueMicrotask(() => {
				waiter.run();
			});
		});
		return fn(...args);
	};
	return mount;
}
// src/index.ts
/**
* taskboard — host half. Serves the per-workspace milestone board: the
* /api/dsh-taskboard route family (workspace enumeration, board read with
* default-board creation, whole-board CAS write, health) over the loopback
* trust fence. The board file is plain JSON at
* `<workspace>/.dsh/taskboard/board.json`, equally writable by agents with
* file tools. Besides the routes, the plugin registers a runtime skill
* (`taskboard`) into the host skills registry so every session's agent
* discovers how to operate the board file. The browser half (./client)
* renders the board panel.
*/
/** Stable cordis plugin name. */
const name = "taskboard";
/**
* Services required before the board routes can mount. `skills` guarantees the
* registry exists when the agent-facing skill registers (same hard-inject
* pattern the official skill center plugin uses).
*/
const inject = [
	"webServer",
	"skills",
	"sessions"
];
/**
* Resolve the workspace one request addresses: the explicit ws override,
* strictly normalized. There is NO default — a request without a usable ws
* is refused by the route (400), because the panel and every agent caller
* name the workspace they mean; guessing one (first session, process cwd)
* silently read and wrote a foreign workspace's board.
* @param override - the request's ws parameter.
* @returns the absolute workspace root, or undefined when absent/unusable.
*/
function resolveRequestedWorkspace(override) {
	if (override === void 0 || override.trim() === "") return void 0;
	return normalizeWorkspaceRoot(override);
}
/**
* Mount the board routes.
* @param ctx - host plugin context carrying webServer/sessions.
* @param config - resolved plugin config.
*/
function applyImpl(ctx, config) {
	if (config?.enabled === false) return;
	const hostCtx = ctx;
	const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? `${homedir()}${sep}.dsh`;
	/** Running session cwds, degraded to [] when the registry is unavailable. */
	const sessionCwds = () => {
		try {
			const sessions = hostCtx.sessions;
			if (typeof sessions?.list !== "function") return [];
			return sessions.list().map((session) => session.header?.cwd).filter((cwd) => typeof cwd === "string" && cwd.trim() !== "");
		} catch {
			return [];
		}
	};
	/**
	* The workspace a request addresses: the ws override, or nothing — the
	* route refuses a ws-less board read/write (see resolveRequestedWorkspace).
	*/
	const resolveWorkspace = resolveRequestedWorkspace;
	/** Skill registration outcome, read by the health route for outside diagnosis. */
	let skillStatus = "not-applied";
	/** Shape of the host skills service + failure stack, for diagnosing the host-side gap. */
	let skillDebug = {};
	const routes = makeRoutes(hostCtx, {
		sessionCwds,
		projcacheCwds: () => projcacheCwds(dshHome),
		resolveWorkspace,
		saveBoard: (workspace, expectedRevision, board) => saveBoard(workspace, expectedRevision, board),
		readOrInitBoard: (workspace) => readOrInitBoard(workspace),
		skillStatus: () => skillStatus,
		skillDebug: () => skillDebug,
		logger: { warn: (error) => ctx.logger.warn(error) }
	});
	ctx.effect(() => {
		skillDebug = {
			serviceType: hostCtx.skills?.constructor?.name ?? typeof hostCtx.skills,
			registerType: typeof hostCtx.skills?.register,
			prototypeChain: (() => {
				const names = [];
				let proto = hostCtx.skills ? Object.getPrototypeOf(hostCtx.skills) : void 0;
				while (proto && proto !== Object.prototype && names.length < 4) {
					names.push(proto.constructor?.name ?? "(anon)");
					proto = Object.getPrototypeOf(proto);
				}
				return names.join(" → ");
			})()
		};
		const outcome = registerBoardSkill(hostCtx.skills, (message) => ctx.logger.warn(message));
		if (outcome.status === "failed") {
			skillStatus = `failed: ${outcome.error}`;
			skillDebug.stack = outcome.stack;
		} else skillStatus = outcome.status;
		const disposers = routes.map((route) => hostCtx.webServer.register(route));
		return () => {
			if (outcome.status === "registered") outcome.disposer?.();
			for (const dispose of disposers) dispose();
		};
	}, "taskboard: routes and skill");
}
/**
* Single-instance guard: the aggregate family bundle and a standalone install
* of this package can coexist in one profile, so the second host apply must
* be a no-op instead of re-registering the same routes and failing the boot.
*/
const apply = mountOnce("dsh-client-ui-taskboard", applyImpl);
export { apply, inject, name, resolveRequestedWorkspace };
