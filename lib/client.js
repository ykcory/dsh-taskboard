window.__ModuleLoader__.load({
	id: "dsh-client-ui-taskboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/api.ts
		/** Route paths mirrored from the host (src/host/routes.ts ROUTES). */
		const API = {
			workspaces: "api/dsh-taskboard/workspaces",
			board: "api/dsh-taskboard/board"
		};
		/** One thrown API error with the host-provided message and status. */
		var ApiError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.name = "ApiError";
				this.status = status;
			}
		};
		/** Request timeout for the localhost round-trips (generous; the host is local). */
		const REQUEST_TIMEOUT_MS = 15e3;
		/** Board API client. */
		var BoardApi = class {
			/** List the known workspaces (running sessions ∪ projection cache). */
			async listWorkspaces() {
				return await this.request(API.workspaces);
			}
			/**
			* Read one board (default ws: the active session workspace). A workspace
			* without a board yet gets its default board created by the host.
			*/
			async getBoard(ws) {
				return await this.request(`${API.board}${this.suffix(ws)}`);
			}
			/** Whole-board CAS write: the server bumps the revision on success. */
			async putBoard(input) {
				return await this.request(`${API.board}${this.suffix(input.ws)}`, {
					method: "PUT",
					body: {
						expectedRevision: input.expectedRevision,
						board: input.board
					}
				});
			}
			suffix(ws) {
				return typeof ws === "string" && ws.trim() !== "" ? `?ws=${encodeURIComponent(ws)}` : "";
			}
			async request(path, options = {}) {
				const headers = options.body === void 0 ? new Headers() : new Headers({ "content-type": "application/json" });
				let response;
				try {
					response = await fetch(path, {
						method: options.method ?? "GET",
						headers,
						body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
						signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
					});
				} catch (error) {
					throw new ApiError(0, error instanceof Error ? error.message : String(error));
				}
				let payload;
				try {
					payload = await response.json();
				} catch {
					payload = void 0;
				}
				if (!response.ok) {
					const record = typeof payload === "object" && payload !== null ? payload : {};
					const message = typeof record["error"] === "string" ? record["error"] : `HTTP ${response.status}`;
					throw new ApiError(response.status, message);
				}
				return payload;
			}
		};
		// src/core/board.ts
		/** The eight preset colors of the stage color popover (design palette). */
		const STAGE_PALETTE = [
			"#7d8b99",
			"#e2a53d",
			"#3fa455",
			"#4a72d8",
			"#e05252",
			"#9a6bd8",
			"#e56aa2",
			"#2fb5c2"
		];
		/**
		* Ordering model: the position of a stage column IS its index in
		* `board.columns`, and the position of a task card within its stage (for one
		* milestone) IS its relative order in `board.tasks`. No separate order fields
		* — agents can reorder by editing the JSON file directly.
		*/
		/**
		* Move one task card to `toIndex` within the milestone's visible list of
		* `toColumnId` (same-stage reorder and cross-stage move share one function).
		* The task keeps its milestone. Returns the updated board, or undefined when
		* the task or the target stage does not exist.
		*/
		function reorderTaskInBoard(board, taskId, toColumnId, toIndex) {
			const task = board.tasks.find((candidate) => candidate.id === taskId);
			if (task === void 0) return void 0;
			if (!board.columns.some((column) => column.id === toColumnId)) return void 0;
			const without = board.tasks.filter((candidate) => candidate.id !== taskId);
			const siblings = without.map((candidate, position) => ({
				candidate,
				position
			})).filter((entry) => entry.candidate.epicId === task.epicId && entry.candidate.columnId === toColumnId);
			const index = Math.max(0, Math.min(Math.round(toIndex), siblings.length));
			let insertAt;
			if (siblings.length === 0) insertAt = without.length;
			else if (index === siblings.length) insertAt = siblings[siblings.length - 1].position + 1;
			else insertAt = siblings[index].position;
			const tasks = [...without];
			tasks.splice(insertAt, 0, {
				...task,
				columnId: toColumnId
			});
			return {
				...board,
				tasks
			};
		}
		/**
		* Move one stage column to `toIndex` within `board.columns`. Returns the
		* updated board, or undefined when the column does not exist. The index is
		* clamped so callers can pass the pointer-derived position unchecked.
		*/
		function reorderColumnInBoard(board, columnId, toIndex) {
			const from = board.columns.findIndex((column) => column.id === columnId);
			if (from < 0) return void 0;
			const index = Math.max(0, Math.min(Math.round(toIndex), board.columns.length - 1));
			const columns = [...board.columns];
			const [moved] = columns.splice(from, 1);
			columns.splice(index, 0, moved);
			return {
				...board,
				columns
			};
		}
		/**
		* One fresh unique id with a readable prefix.
		* @param prefix - `epic` / `col` / `task`.
		* @param random - injectable randomness source (defaults to Math.random).
		*/
		function makeId(prefix, random = Math.random) {
			return `${prefix}-${random().toString(36).slice(2, 8).padEnd(6, "0")}`;
		}
		/** Pick one random palette color (used when a new stage is added). */
		function randomStageColor(random = Math.random) {
			return STAGE_PALETTE[Math.floor(random() * STAGE_PALETTE.length)];
		}
		// src/client/controller.ts
		/**
		* Board controller (framework-free store shared by the sidebar row and the
		* React board view). Owns the loaded board snapshot and every mutation; the
		* view reads getSnapshot() through useSyncExternalStore.
		*
		* Mutation flow: build the next board from the current snapshot, PUT it with
		* the observed revision, and adopt the server response (fresh revision). A
		* 409 reloads the server truth and raises the conflict notice; other
		* failures keep the local view and raise the save notice.
		*/
		const INITIAL = {
			phase: "idle",
			board: void 0,
			workspace: void 0,
			selectedEpicId: void 0,
			saving: false,
			notice: void 0
		};
		/** Board controller: one instance per client plugin apply. */
		var TaskboardController = class {
			api;
			listeners = /* @__PURE__ */ new Set();
			state = INITIAL;
			/** Cached so getSnapshot stays referentially stable between changes. */
			snapshot = INITIAL;
			/** Monotonic load token: a superseded load's late response must not land. */
			loadSeq = 0;
			constructor(api) {
				this.api = api;
			}
			getSnapshot() {
				return this.snapshot;
			}
			subscribe(fn) {
				this.listeners.add(fn);
				return () => {
					this.listeners.delete(fn);
				};
			}
			set(patch) {
				this.state = {
					...this.state,
					...patch
				};
				this.snapshot = this.state;
				for (const fn of [...this.listeners]) fn();
			}
			/** Dismiss the transient notice line. */
			dismissNotice() {
				if (this.state.notice === void 0) return;
				this.set({ notice: void 0 });
			}
			/**
			* Load the board of one workspace — the active session's workspace root,
			* read by the tab body from the framework session list (the same source the
			* shipped files tab uses). Always explicit: the host refuses a board read
			* without a workspace, so no default is ever guessed here. A newer load
			* supersedes an in-flight one; its late response is dropped.
			*/
			async load(workspace) {
				const seq = ++this.loadSeq;
				this.set({
					phase: "loading",
					notice: void 0
				});
				try {
					const payload = await this.api.getBoard(workspace);
					if (seq !== this.loadSeq) return;
					this.adopt(payload);
					this.set({ phase: "ready" });
				} catch (error) {
					if (seq !== this.loadSeq) return;
					this.set({
						phase: "error",
						notice: {
							kind: "load",
							detail: error instanceof Error ? error.message : String(error)
						}
					});
				}
			}
			/** Select the milestone tab the board area shows. */
			selectEpic(epicId) {
				if (this.state.selectedEpicId === epicId) return;
				this.set({ selectedEpicId: epicId });
			}
			/** Create a milestone (tab); the new tab becomes the selected one. */
			async createEpic(name) {
				const trimmed = name.trim();
				const board = this.state.board;
				if (board === void 0 || trimmed === "") return "failed";
				const epic = {
					id: makeId("epic"),
					name: trimmed
				};
				const next = {
					...board,
					epics: [...board.epics, epic]
				};
				const saved = await this.commit(next);
				if (saved) this.set({ selectedEpicId: epic.id });
				return saved ? "ok" : "failed";
			}
			/**
			* Add one stage column with the given name and a random palette color.
			* The name is required: the add-stage dialog collects it up front, so a
			* stage never sits unnamed on the board.
			*/
			async addStage(name) {
				const board = this.state.board;
				const trimmed = name.trim();
				if (board === void 0 || trimmed === "") return "failed";
				const column = {
					id: makeId("col"),
					name: trimmed,
					color: randomStageColor()
				};
				const next = {
					...board,
					columns: [...board.columns, column]
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/** Inline-rename one stage column. */
			async renameStage(columnId, name) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				if (!board.columns.some((column) => column.id === columnId)) return "failed";
				const next = {
					...board,
					columns: board.columns.map((column) => column.id === columnId ? {
						...column,
						name
					} : column)
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/** Re-color one stage column from the popover palette. */
			async setStageColor(columnId, color) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				if (!board.columns.some((column) => column.id === columnId)) return "failed";
				const next = {
					...board,
					columns: board.columns.map((column) => column.id === columnId ? {
						...column,
						color
					} : column)
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/**
			* Remove one stage column. The client refuses up front when the stage still
			* holds tasks of ANY epic (the server enforces the same rule); the caller
			* renders the blocked feedback.
			*/
			async removeStage(columnId) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				if (!board.columns.some((column) => column.id === columnId)) return "failed";
				if (board.tasks.some((task) => task.columnId === columnId)) return "blocked";
				const next = {
					...board,
					columns: board.columns.filter((column) => column.id !== columnId)
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/** Create one task card under the milestone, in the given stage. */
			async createTask(input) {
				const board = this.state.board;
				const trimmed = input.title.trim();
				if (board === void 0 || trimmed === "") return "failed";
				if (!board.epics.some((epic) => epic.id === input.epicId)) return "failed";
				if (!board.columns.some((column) => column.id === input.columnId)) return "failed";
				const task = {
					id: makeId("task"),
					epicId: input.epicId,
					columnId: input.columnId,
					title: trimmed,
					createdAt: Date.now()
				};
				const next = {
					...board,
					tasks: [...board.tasks, task]
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/**
			* Edit one task card: a new title and/or a new stage. A stage change moves
			* the card to the END of the target stage's visible list (the edit dialog
			* is about the card's fields, not its order); one CAS commit covers both
			* changes. A no-op edit resolves without a round-trip.
			*/
			async editTask(taskId, input) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				const task = board.tasks.find((candidate) => candidate.id === taskId);
				if (task === void 0) return "failed";
				const title = input.title?.trim();
				if (title !== void 0 && title === "") return "failed";
				const columnId = input.columnId;
				if (columnId !== void 0 && !board.columns.some((column) => column.id === columnId)) return "failed";
				const titleChanged = title !== void 0 && title !== task.title;
				const stageChanged = columnId !== void 0 && columnId !== task.columnId;
				if (!titleChanged && !stageChanged) return "ok";
				let next = titleChanged ? {
					...board,
					tasks: board.tasks.map((candidate) => candidate.id === taskId ? {
						...candidate,
						title
					} : candidate)
				} : board;
				if (stageChanged) {
					const moved = reorderTaskInBoard(next, taskId, columnId, Number.POSITIVE_INFINITY);
					if (moved !== void 0) next = moved;
				}
				return await this.commit(next) ? "ok" : "failed";
			}
			/** Remove one task card (no guard: a card has no dependents). */
			async removeTask(taskId) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				if (!board.tasks.some((task) => task.id === taskId)) return "failed";
				const next = {
					...board,
					tasks: board.tasks.filter((task) => task.id !== taskId)
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/**
			* Move one task card to `toIndex` in the milestone's visible list of
			* `columnId` — same-stage reorder and cross-stage move share the path.
			* Without an index the card appends to the target stage. A no-op move
			* (same list position) resolves without a round-trip.
			*/
			async moveTask(taskId, columnId, toIndex) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				const next = reorderTaskInBoard(board, taskId, columnId, toIndex ?? Number.POSITIVE_INFINITY);
				if (next === void 0) return "failed";
				if (next.tasks.length === board.tasks.length && next.tasks.every((task, position) => task.id === board.tasks[position]?.id && task.columnId === board.tasks[position]?.columnId)) return "ok";
				return await this.commit(next) ? "ok" : "failed";
			}
			/**
			* Move one stage column to `toIndex` (drag by the column-head handle).
			* Out-of-range indexes clamp; a no-op move resolves without a round-trip.
			*/
			async moveStage(columnId, toIndex) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				const next = reorderColumnInBoard(board, columnId, toIndex);
				if (next === void 0) return "failed";
				if (next.columns.every((column, position) => column.id === board.columns[position]?.id)) return "ok";
				return await this.commit(next) ? "ok" : "failed";
			}
			/** Rename one milestone tab. */
			async renameEpic(epicId, name) {
				const board = this.state.board;
				const trimmed = name.trim();
				if (board === void 0 || trimmed === "") return "failed";
				if (!board.epics.some((epic) => epic.id === epicId)) return "failed";
				const next = {
					...board,
					epics: board.epics.map((epic) => epic.id === epicId ? {
						...epic,
						name: trimmed
					} : epic)
				};
				return await this.commit(next) ? "ok" : "failed";
			}
			/**
			* Remove one milestone tab. The LAST milestone cannot be removed (a board
			* always shows at least one tab); a milestone that still holds tasks of any
			* stage is refused up front, matching the server's column-removal guard.
			*/
			async removeEpic(epicId) {
				const board = this.state.board;
				if (board === void 0) return "failed";
				if (!board.epics.some((epic) => epic.id === epicId)) return "failed";
				if (board.epics.length <= 1) return "blocked";
				if (board.tasks.some((task) => task.epicId === epicId)) return "blocked";
				const next = {
					...board,
					epics: board.epics.filter((epic) => epic.id !== epicId),
					tasks: board.tasks.filter((task) => task.epicId !== epicId)
				};
				const saved = await this.commit(next);
				if (saved) {
					const remaining = next.epics[0]?.id;
					if (this.state.selectedEpicId === epicId && remaining !== void 0) this.set({ selectedEpicId: remaining });
				}
				return saved ? "ok" : "failed";
			}
			/** Adopt one host payload: board plus workspace, keeping a valid selection. */
			adopt(payload) {
				const board = payload.board;
				const selected = this.state.selectedEpicId;
				const selectedEpicId = selected !== void 0 && board.epics.some((epic) => epic.id === selected) ? selected : board.epics[0]?.id ?? void 0;
				this.set({
					board,
					workspace: payload.workspace,
					selectedEpicId
				});
			}
			/** Re-read the server truth after a conflict. */
			async reload() {
				try {
					const payload = await this.api.getBoard(this.state.workspace?.cwd);
					this.adopt(payload);
					if (this.state.phase !== "ready") this.set({ phase: "ready" });
				} catch {}
			}
			/** Build, send, adopt. Returns whether the save landed. */
			async commit(next) {
				const board = this.state.board;
				if (board === void 0) return false;
				this.set({ saving: true });
				try {
					const payload = await this.api.putBoard({
						ws: this.state.workspace?.cwd,
						expectedRevision: board.revision,
						board: next
					});
					this.adopt(payload);
					return true;
				} catch (error) {
					if (error instanceof ApiError && error.status === 409) {
						await this.reload();
						this.set({ notice: { kind: "conflict" } });
					} else this.set({ notice: {
						kind: "save",
						detail: error instanceof Error ? error.message : String(error)
					} });
					return false;
				} finally {
					this.set({ saving: false });
				}
			}
		};
		// src/client/locales.ts
		/**
		* taskboard surface copy: zh is the key source, en mirrors every key.
		* The dictionaries register under the `taskboard` locale namespace through
		* ctx.locale.register; module-level t() reads the active language at call
		* time so the sidebar row follows the Language setting without a reload.
		*/
		const NS = "taskboard";
		const zh = {
			"entry.label": "任务看板",
			"guide.description": "按里程碑管理事项的阶段流转",
			"tab.add": "+",
			"action.addStage": "添加阶段",
			"action.newTask": "新建事项",
			"stage.empty": "此阶段暂无事项",
			"stage.delete": "删除阶段",
			"stage.notEmpty": "此阶段仍有事项，移走后再删除",
			"modal.task.title": "新建事项",
			"modal.task.editTitle": "编辑事项",
			"modal.task.fieldTitle": "事项标题",
			"modal.task.placeholderTitle": "输入事项标题",
			"modal.task.fieldStage": "所属阶段",
			"modal.stage.title": "添加阶段",
			"modal.stage.fieldName": "阶段名称",
			"modal.stage.placeholderName": "输入阶段名称",
			"modal.epic.title": "新建里程碑",
			"modal.epic.fieldName": "名称",
			"modal.epic.placeholderName": "输入里程碑名称",
			"epic.menu.rename": "重命名",
			"epic.menu.delete": "删除里程碑",
			"task.menu.edit": "编辑",
			"task.menu.delete": "删除",
			"epic.menu.deleteBlocked": "此里程碑仍有事项，移走后再删除",
			"epic.menu.lastBlocked": "至少保留一个里程碑",
			"common.cancel": "取消",
			"common.create": "创建",
			"common.save": "保存",
			"status.noWorkspace": "未获取到当前会话的工作区",
			"error.load": "看板加载失败",
			"error.conflict": "保存冲突，已重新加载",
			"error.save": "保存失败"
		};
		const en = {
			"entry.label": "Taskboard",
			"guide.description": "Track items across stages by milestone",
			"tab.add": "+",
			"action.addStage": "Add stage",
			"action.newTask": "New task",
			"stage.empty": "No tasks in this stage",
			"stage.delete": "Delete stage",
			"stage.notEmpty": "This stage still has tasks; move them out first",
			"modal.task.title": "New task",
			"modal.task.editTitle": "Edit task",
			"modal.task.fieldTitle": "Task title",
			"modal.task.placeholderTitle": "Enter a task title",
			"modal.task.fieldStage": "Stage",
			"modal.stage.title": "Add stage",
			"modal.stage.fieldName": "Stage name",
			"modal.stage.placeholderName": "Enter a stage name",
			"modal.epic.title": "New milestone",
			"modal.epic.fieldName": "Name",
			"modal.epic.placeholderName": "Enter a milestone name",
			"epic.menu.rename": "Rename",
			"epic.menu.delete": "Delete milestone",
			"task.menu.edit": "Edit",
			"task.menu.delete": "Delete",
			"epic.menu.deleteBlocked": "This milestone still has tasks; move them out first",
			"epic.menu.lastBlocked": "Keep at least one milestone",
			"common.cancel": "Cancel",
			"common.create": "Create",
			"common.save": "Save",
			"status.noWorkspace": "No workspace for the current session",
			"error.load": "Failed to load the board",
			"error.conflict": "Save conflict; the board was reloaded",
			"error.save": "Failed to save"
		};
		/** Active dictionary, picked by the document language at call time. */
		function dictionary() {
			let language = "en";
			try {
				language = document.documentElement.lang || "en";
			} catch {
				language = "en";
			}
			return language.toLowerCase().startsWith("zh") ? zh : en;
		}
		let runtimeTranslate;
		/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
		function setRuntimeTranslate(t) {
			runtimeTranslate = t;
		}
		/** Translate a key with optional {name} template params (current language). */
		function t(key, values) {
			if (runtimeTranslate !== void 0) try {
				return runtimeTranslate(key, values);
			} catch {}
			const text = dictionary()[key] ?? key;
			if (values === void 0) return text;
			return text.replace(/\{(\w+)\}/g, (match, name) => name in values ? String(values[name]) : match);
		}
		// src/client/view/GuideArtwork.tsx
		/** Back column: the lightest tone. */
		const TONE_BACK = "#B9A6FB";
		/** Front column: the base tone. */
		const TONE_FRONT = "#7C5CF0";
		/** Middle column: between the two. */
		const TONE_MID = "#9B7DF5";
		/**
		* The card glyph.
		* @param props.size - square edge in px (the guide passes its own size).
		* @param props.className - extra class from the guide.
		* @returns the decorative artwork.
		*/
		function GuideArtworkTaskboard({ size = 36, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				"aria-hidden": "true",
				viewBox: "0 0 36 36",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "5.5",
						y: "9",
						width: "7",
						height: "18",
						rx: "2.4",
						fill: TONE_FRONT
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "14.5",
						y: "15",
						width: "7",
						height: "12",
						rx: "2.4",
						fill: TONE_MID
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "23.5",
						y: "12",
						width: "7",
						height: "15",
						rx: "2.4",
						fill: TONE_BACK
					})
				]
			});
		}
		// src/client/view/dnd.ts
		/**
		* Drag-and-drop plumbing shared by the stage columns and the task cards.
		*
		* HTML5 drag events cannot read the DataTransfer payload during `dragover`
		* (protected mode), so the dragged item travels in this module-level slot —
		* one drag lives in one window, so a single mutable slot is enough. `endDrag`
		* also dispatches a window event so columns and the column strip can clear
		* their insertion hints when a drag ends anywhere (drop OR cancel).
		*/
		/** DataTransfer mime carrying the dragged task id (kept for inspectors). */
		const TASK_ID_MIME = "application/x-taskboard-task";
		let current = null;
		const DRAG_END_EVENT = "taskboard:dragend";
		/** Remember the item a dragstart picked up. */
		function beginDrag(payload) {
			current = payload;
		}
		/** Clear the slot and tell every listener the drag is over. */
		function endDrag() {
			current = null;
			window.dispatchEvent(new Event(DRAG_END_EVENT));
		}
		/** The payload of the drag in flight, if any. */
		function getDragPayload() {
			return current;
		}
		/** Subscribe to drag end (drop or cancel); returns the unsubscribe function. */
		function onDragEnd(listener) {
			window.addEventListener(DRAG_END_EVENT, listener);
			return () => {
				window.removeEventListener(DRAG_END_EVENT, listener);
			};
		}
		/** Read the dragged task id out of a drop event (fallback: text/plain). */
		function readDraggedTaskId(event) {
			const transfer = event.dataTransfer;
			if (transfer === null) return void 0;
			const dragged = transfer.getData("application/x-taskboard-task") || transfer.getData("text/plain");
			return dragged === "" ? void 0 : dragged;
		}
		// \0dsh-css:src/client/tailwind.gen.css.mjs
		const css = "/*! tailwindcss v4.3.5 | MIT License | https://tailwindcss.com */\n@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:block))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-border-style:solid;--tw-leading:initial;--tw-font-weight:initial;--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-outline-style:solid}}}@layer theme{:root,:host{--font-sans:-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", \"Noto Sans\", Arial, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\";--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;--color-black:#000;--color-white:#fff;--spacing:.25rem;--font-weight-medium:500;--font-weight-semibold:600;--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", \"Noto Sans\", Arial, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring:where(:not(iframe)){outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab, red, red)){::placeholder{color:color-mix(in oklab, currentcolor 50%, transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}}@layer components;@layer utilities{.visible{visibility:visible}.absolute{position:absolute}.fixed{position:fixed}.relative{position:relative}.static{position:static}.inset-0{inset:0}.top-\\[4px\\]{top:4px}.top-\\[44px\\]{top:44px}.right-0{right:0}.right-\\[4px\\]{right:4px}.left-0{left:0}.left-\\[12px\\]{left:12px}.z-\\[5\\]{z-index:5}.z-\\[10\\]{z-index:10}.z-\\[11\\]{z-index:11}.z-\\[20\\]{z-index:20}.container{width:100%}@media (width>=40rem){.container{max-width:40rem}}@media (width>=48rem){.container{max-width:48rem}}@media (width>=64rem){.container{max-width:64rem}}@media (width>=80rem){.container{max-width:80rem}}@media (width>=96rem){.container{max-width:96rem}}.mt-\\[10px\\]{margin-top:10px}.mb-\\[8px\\]{margin-bottom:8px}.ml-\\[6px\\]{margin-left:6px}.ml-auto{margin-left:auto}.block{display:block}.contents{display:contents}.flex{display:flex}.inline{display:inline}.table{display:table}.h-\\[2px\\]{height:2px}.h-\\[16px\\]{height:16px}.h-\\[18px\\]{height:18px}.h-\\[20px\\]{height:20px}.h-\\[24px\\]{height:24px}.h-\\[40px\\]{height:40px}.h-full{height:100%}.min-h-0{min-height:0}.w-\\[2px\\]{width:2px}.w-\\[16px\\]{width:16px}.w-\\[18px\\]{width:18px}.w-\\[20px\\]{width:20px}.w-\\[24px\\]{width:24px}.w-\\[236px\\]{width:236px}.w-\\[440px\\]{width:440px}.w-full{width:100%}.min-w-0{min-width:0}.min-w-\\[140px\\]{min-width:140px}.flex-1{flex:1}.shrink-0{flex-shrink:0}.transform{transform:var(--tw-rotate-x, ) var(--tw-rotate-y, ) var(--tw-rotate-z, ) var(--tw-skew-x, ) var(--tw-skew-y, )}.cursor-default{cursor:default}.cursor-grab{cursor:grab}.cursor-pointer{cursor:pointer}.cursor-text{cursor:text}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.justify-center{justify-content:center}.justify-end{justify-content:flex-end}.gap-\\[4px\\]{gap:4px}.gap-\\[6px\\]{gap:6px}.gap-\\[8px\\]{gap:8px}.gap-\\[9px\\]{gap:9px}.gap-\\[10px\\]{gap:10px}.gap-\\[14px\\]{gap:14px}.self-stretch{align-self:stretch}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-hidden{overflow:hidden}.overflow-x-auto{overflow-x:auto}.overflow-y-auto{overflow-y:auto}.overflow-y-hidden{overflow-y:hidden}.rounded-\\[1px\\]{border-radius:1px}.rounded-\\[6px\\]{border-radius:6px}.rounded-\\[8px\\]{border-radius:8px}.rounded-\\[10px\\]{border-radius:10px}.rounded-\\[12px\\]{border-radius:12px}.rounded-\\[14px\\]{border-radius:14px}.rounded-full{border-radius:2147483647px}.border{border-style:var(--tw-border-style);border-width:1px}.border-\\[\\#e3e5e8\\]{border-color:#e3e5e8}.border-black{border-color:var(--color-black)}.border-black\\/10{border-color:#0000001a}@supports (color:color-mix(in lab, red, red)){.border-black\\/10{border-color:color-mix(in oklab, var(--color-black) 10%, transparent)}}.border-black\\/\\[0\\.06\\]{border-color:#0000000f}@supports (color:color-mix(in lab, red, red)){.border-black\\/\\[0\\.06\\]{border-color:color-mix(in oklab, var(--color-black) 6%, transparent)}}.bg-\\[\\#1c1e21\\]{background-color:#1c1e21}.bg-\\[\\#1c1e21\\]\\/25{background-color:oklab(23.4175% -.00131188 -.0063705/.25)}.bg-\\[\\#f2f3f5\\]{background-color:#f2f3f5}.bg-\\[rgba\\(15\\,17\\,20\\,0\\.4\\)\\]{background-color:#0f111466}.bg-white{background-color:var(--color-white)}.px-6{padding-inline:calc(var(--spacing) * 6)}.px-\\[6px\\]{padding-inline:6px}.px-\\[10px\\]{padding-inline:10px}.px-\\[12px\\]{padding-inline:12px}.px-\\[14px\\]{padding-inline:14px}.px-\\[16px\\]{padding-inline:16px}.px-\\[20px\\]{padding-inline:20px}.py-\\[4px\\]{padding-block:4px}.py-\\[5px\\]{padding-block:5px}.py-\\[6px\\]{padding-block:6px}.py-\\[7px\\]{padding-block:7px}.py-\\[8px\\]{padding-block:8px}.py-\\[9px\\]{padding-block:9px}.py-\\[12px\\]{padding-block:12px}.pt-\\[2px\\]{padding-top:2px}.pt-\\[12px\\]{padding-top:12px}.pt-\\[14px\\]{padding-top:14px}.pt-\\[18px\\]{padding-top:18px}.pb-\\[6px\\]{padding-bottom:6px}.pb-\\[8px\\]{padding-bottom:8px}.pb-\\[10px\\]{padding-bottom:10px}.pb-\\[12px\\]{padding-bottom:12px}.pb-\\[14px\\]{padding-bottom:14px}.pb-\\[20px\\]{padding-bottom:20px}.text-left{text-align:left}.text-\\[11px\\]{font-size:11px}.text-\\[12px\\]{font-size:12px}.text-\\[13px\\]{font-size:13px}.text-\\[14px\\]{font-size:14px}.text-\\[15px\\]{font-size:15px}.text-\\[16px\\]{font-size:16px}.leading-\\[1\\.4\\]{--tw-leading:1.4;line-height:1.4}.leading-\\[1\\.55\\]{--tw-leading:1.55;line-height:1.55}.leading-none{--tw-leading:1;line-height:1}.font-medium{--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium)}.font-semibold{--tw-font-weight:var(--font-weight-semibold);font-weight:var(--font-weight-semibold)}.\\[overflow-wrap\\:anywhere\\]{overflow-wrap:anywhere}.text-\\[\\#1e2126\\]{color:#1e2126}.text-\\[\\#2f3237\\]{color:#2f3237}.text-\\[\\#3a3d42\\]{color:#3a3d42}.text-\\[\\#4a4d52\\]{color:#4a4d52}.text-\\[\\#9aa0a8\\]{color:#9aa0a8}.text-\\[\\#33363b\\]{color:#33363b}.text-\\[\\#b0b6bd\\]{color:#b0b6bd}.text-\\[\\#c9ccd1\\]{color:#c9ccd1}.text-\\[\\#e05252\\]{color:#e05252}.text-white{color:var(--color-white)}.lowercase{text-transform:lowercase}.opacity-0{opacity:0}.opacity-40{opacity:.4}.opacity-45{opacity:.45}.shadow-\\[0_8px_24px_rgba\\(0\\,0\\,0\\,0\\.15\\)\\]{--tw-shadow:0 8px 24px var(--tw-shadow-color,#00000026);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.shadow-\\[0_12px_40px_rgba\\(0\\,0\\,0\\,0\\.18\\)\\]{--tw-shadow:0 12px 40px var(--tw-shadow-color,#0000002e);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.outline,.outline-1{outline-style:var(--tw-outline-style);outline-width:1px}.-outline-offset-2{outline-offset:calc(2px * -1)}.transition-opacity{transition-property:opacity;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.outline-none{--tw-outline-style:none;outline-style:none}@media (hover:hover){:is(:where(.group):hover .group-hover\\:opacity-100){opacity:1}}.placeholder\\:text-\\[\\#b3b8bf\\]::placeholder{color:#b3b8bf}@media (hover:hover){.hover\\:border-black\\/30:hover{border-color:#0000004d}@supports (color:color-mix(in lab, red, red)){.hover\\:border-black\\/30:hover{border-color:color-mix(in oklab, var(--color-black) 30%, transparent)}}.hover\\:bg-\\[\\#f2f3f5\\]:hover{background-color:#f2f3f5}.hover\\:bg-\\[\\#f3f4f6\\]:hover{background-color:#f3f4f6}.hover\\:bg-\\[\\#f5f6f7\\]:hover{background-color:#f5f6f7}.hover\\:text-\\[\\#1c1e21\\]:hover{color:#1c1e21}.hover\\:text-\\[\\#4a4d52\\]:hover{color:#4a4d52}.hover\\:text-\\[\\#e05252\\]:hover{color:#e05252}.hover\\:opacity-80:hover{opacity:.8}.hover\\:opacity-90:hover{opacity:.9}}.focus\\:border-black\\/40:focus{border-color:#0006}@supports (color:color-mix(in lab, red, red)){.focus\\:border-black\\/40:focus{border-color:color-mix(in oklab, var(--color-black) 40%, transparent)}}.focus-visible\\:opacity-100:focus-visible{opacity:1}.active\\:cursor-grabbing:active{cursor:grabbing}}@property --tw-rotate-x{syntax:\"*\";inherits:false}@property --tw-rotate-y{syntax:\"*\";inherits:false}@property --tw-rotate-z{syntax:\"*\";inherits:false}@property --tw-skew-x{syntax:\"*\";inherits:false}@property --tw-skew-y{syntax:\"*\";inherits:false}@property --tw-border-style{syntax:\"*\";inherits:false;initial-value:solid}@property --tw-leading{syntax:\"*\";inherits:false}@property --tw-font-weight{syntax:\"*\";inherits:false}@property --tw-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:\"*\";inherits:false}@property --tw-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:\"*\";inherits:false}@property --tw-inset-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:\"*\";inherits:false}@property --tw-ring-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:\"*\";inherits:false}@property --tw-inset-ring-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:\"*\";inherits:false}@property --tw-ring-offset-width{syntax:\"<length>\";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:\"*\";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --tw-outline-style{syntax:\"*\";inherits:false;initial-value:solid}";
		const tagId = "dsh-client-ui-taskboard/src/client/tailwind.gen.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-taskboard";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		// src/client/view/icons.tsx
		/** The white droplet inside a stage color dot (design chipIcon). */
		function ChipDroplet() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "10",
				height: "10",
				viewBox: "0 0 12 12",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6 1.2 C6 1.2 2.4 5.4 2.4 8 a3.6 3.6 0 0 0 7.2 0 C9.6 5.4 6 1.2 6 1.2 Z",
					fill: "#ffffff"
				})
			});
		}
		/** Column-head add button plus sign (design plusIcon). */
		function PlusIcon({ size = 12, stroke = "#4a4d52" }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 12 12",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6 2.2 V9.8 M2.2 6 H9.8",
					stroke,
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})
			});
		}
		/** Select dropdown chevron (design chevronSvg). */
		function ChevronIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "10",
				height: "10",
				viewBox: "0 0 10 10",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2 3.5 L5 6.5 L8 3.5",
					fill: "none",
					stroke: "#6b7076",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		// src/client/view/Modals.tsx
		/**
		* The board dialogs: 事项 (新建 + 编辑 share one form), 新建里程碑,
		* 添加阶段 and 重命名里程碑. All close on Escape, overlay clicks and the
		* close button; all share the design's modal metrics (440px card).
		*/
		/** Modal shell shared by both dialogs (overlay, card, close button). */
		function ModalShell({ title, onCancel, children, footer }) {
			(0, react.useEffect)(() => {
				const onKeydown = (event) => {
					if (event.key === "Escape") onCancel();
				};
				window.addEventListener("keydown", onKeydown);
				return () => {
					window.removeEventListener("keydown", onKeydown);
				};
			}, [onCancel]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "absolute inset-0 z-[10] flex items-center justify-center bg-[rgba(15,17,20,0.4)]",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				"data-dsh-part": "overlay",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "w-[440px] rounded-[14px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)]",
					"data-dsh-part": "modal",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between px-[20px] pb-[14px] pt-[18px]",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "text-[15px] font-semibold text-[#1e2126]",
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "cursor-pointer text-[16px] leading-none text-[#9aa0a8] hover:text-[#4a4d52]",
								onClick: onCancel,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "flex flex-col gap-[14px] px-[20px] pb-[6px] pt-[2px]",
							children
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "flex justify-end gap-[10px] px-[20px] pb-[20px] pt-[14px]",
							children: footer
						})
					]
				})
			});
		}
		/** Cancel / primary footer pair; the submit label comes from the caller. */
		function ModalFooter({ canSubmit, submitLabel, onSubmit, onCancel }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "cursor-pointer rounded-[8px] bg-[#f2f3f5] px-[16px] py-[9px] text-[13px] font-medium text-[#3a3d42] hover:opacity-80",
				onClick: onCancel,
				children: t("common.cancel")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: canSubmit ? "cursor-pointer rounded-[8px] bg-[#1c1e21] px-[16px] py-[9px] text-[13px] font-medium text-white hover:opacity-90" : "cursor-default rounded-[8px] bg-[#1c1e21] px-[16px] py-[9px] text-[13px] font-medium text-white opacity-40",
				onClick: () => {
					if (canSubmit) onSubmit();
				},
				children: submitLabel
			})] });
		}
		/**
		* 事项 dialog (新建 + 编辑 share one form): 事项标题 + 所属阶段
		* (color-dot dropdown). The heading, prefilled title and submit label
		* distinguish the two modes; the caller translates the submit into the right
		* controller mutation.
		*/
		function TaskFormModal({ stages, initialStageId, initialTitle, heading, submitLabel, onCancel, onSubmit }) {
			const [title, setTitle] = (0, react.useState)(initialTitle);
			const [stageId, setStageId] = (0, react.useState)(initialStageId);
			const [dropdownOpen, setDropdownOpen] = (0, react.useState)(false);
			const inputRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			}, []);
			const selected = stages.find((stage) => stage.id === stageId) ?? stages[0];
			const canSubmit = title.trim() !== "";
			const submit = () => {
				if (!canSubmit) return;
				onSubmit({
					columnId: stageId,
					title: title.trim()
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ModalShell, {
				title: heading,
				onCancel,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalFooter, {
					canSubmit,
					submitLabel,
					onSubmit: submit,
					onCancel
				}),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-[8px]",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: "text-[13px] text-[#4a4d52]",
						htmlFor: "taskboard-task-title",
						children: t("modal.task.fieldTitle")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: "taskboard-task-title",
						ref: inputRef,
						className: "h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40",
						value: title,
						placeholder: t("modal.task.placeholderTitle"),
						onChange: (event) => {
							setTitle(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter") submit();
						}
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-[8px]",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "text-[13px] text-[#4a4d52]",
						children: t("modal.task.fieldStage")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "relative",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "flex h-[40px] w-full cursor-pointer items-center justify-between rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] hover:border-black/30",
							onClick: () => {
								setDropdownOpen((open) => !open);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "flex items-center gap-[8px]",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "flex h-[20px] w-[20px] items-center justify-center rounded-full",
									style: { background: selected?.color ?? "#7d8b99" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChipDroplet, {})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: selected?.name ?? "" })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, {})]
						}), dropdownOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "absolute left-0 right-0 top-[44px] z-[11] flex flex-col rounded-[10px] bg-white px-[6px] py-[6px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]",
							children: stages.map((stage) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "flex cursor-pointer items-center gap-[8px] rounded-[8px] px-[6px] py-[8px] text-left text-[13px] text-[#33363b] hover:bg-[#f2f3f5]",
								onClick: () => {
									setStageId(stage.id);
									setDropdownOpen(false);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "flex h-[16px] w-[16px] items-center justify-center rounded-full",
									style: { background: stage.color }
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "truncate",
									children: stage.name
								})]
							}, stage.id))
						}) : null]
					})]
				})]
			});
		}
		/** 新建里程碑 dialog: 名称 only. */
		function CreateEpicModal({ onCancel, onCreate }) {
			const [name, setName] = (0, react.useState)("");
			const inputRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				inputRef.current?.focus();
			}, []);
			const canCreate = name.trim() !== "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalShell, {
				title: t("modal.epic.title"),
				onCancel,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalFooter, {
					canSubmit: canCreate,
					submitLabel: t("common.create"),
					onSubmit: () => {
						if (canCreate) onCreate(name.trim());
					},
					onCancel
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-[8px]",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: "text-[13px] text-[#4a4d52]",
						htmlFor: "taskboard-epic-name",
						children: t("modal.epic.fieldName")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: "taskboard-epic-name",
						ref: inputRef,
						className: "h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40",
						value: name,
						placeholder: t("modal.epic.placeholderName"),
						onChange: (event) => {
							setName(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" && canCreate) onCreate(name.trim());
						}
					})]
				})
			});
		}
		/** 添加阶段 dialog: 阶段名称 + a random palette color picked on creation. */
		function CreateStageModal({ onCancel, onCreate }) {
			const [name, setName] = (0, react.useState)("");
			const inputRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				inputRef.current?.focus();
			}, []);
			const canCreate = name.trim() !== "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalShell, {
				title: t("modal.stage.title"),
				onCancel,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalFooter, {
					canSubmit: canCreate,
					submitLabel: t("common.create"),
					onSubmit: () => {
						if (canCreate) onCreate(name.trim());
					},
					onCancel
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-[8px]",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: "text-[13px] text-[#4a4d52]",
						htmlFor: "taskboard-stage-name",
						children: t("modal.stage.fieldName")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: "taskboard-stage-name",
						ref: inputRef,
						className: "h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40",
						value: name,
						placeholder: t("modal.stage.placeholderName"),
						onChange: (event) => {
							setName(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" && canCreate) onCreate(name.trim());
						}
					})]
				})
			});
		}
		/** 重命名里程碑 dialog: 名称 prefilled with the current name. */
		function RenameEpicModal({ initialName, onCancel, onSubmit }) {
			const [name, setName] = (0, react.useState)(initialName);
			const inputRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			}, []);
			const canSubmit = name.trim() !== "" && name.trim() !== initialName;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalShell, {
				title: t("epic.menu.rename"),
				onCancel,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalFooter, {
					canSubmit,
					submitLabel: t("common.create"),
					onSubmit: () => {
						if (canSubmit) onSubmit(name.trim());
					},
					onCancel
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-[8px]",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: "text-[13px] text-[#4a4d52]",
						htmlFor: "taskboard-epic-rename",
						children: t("modal.epic.fieldName")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: "taskboard-epic-rename",
						ref: inputRef,
						className: "h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40",
						value: name,
						onChange: (event) => {
							setName(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" && canSubmit) onSubmit(name.trim());
						}
					})]
				})
			});
		}
		// src/client/view/tint.ts
		/**
		* Column background tint.
		*
		* The stage color is laid over white at a low opacity rather than blended by
		* hand, so every palette color (and every agent-written hex) yields the same
		* soft wash the five preset stages show — no per-color tuning, no surprise
		* saturation when a saturated color is picked.
		*
		* The alpha is deliberately small: the column is a container behind white
		* cards, and the stage dot already carries the color at full strength.
		*/
		/** Opacity of the stage color over white for a column background. */
		const COLUMN_TINT_ALPHA = .08;
		/**
		* Parse `#rrggbb` into channels.
		* @param color - hex color, with or without the leading `#`.
		* @returns the channels, or undefined when the value is not a hex color.
		*/
		function parseHexColor(color) {
			const match = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
			if (match === null) return void 0;
			const value = Number.parseInt(match[1], 16);
			return {
				r: value >> 16 & 255,
				g: value >> 8 & 255,
				b: value & 255
			};
		}
		/**
		* One column's background for its stage color: the color at
		* {@link COLUMN_TINT_ALPHA} over white. The alpha is emitted as `rgba` rather
		* than pre-blended so the wash stays identical over any surface the column
		* is composited onto.
		* @param color - the stage color (`#rrggbb`).
		* @returns a CSS color, or the neutral fallback for an unusable value.
		*/
		function tintBackground(color) {
			const channels = parseHexColor(color);
			if (channels === void 0) return "#f2f3f5";
			return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${COLUMN_TINT_ALPHA})`;
		}
		// src/client/view/StageColumn.tsx
		/**
		* One stage column: head (whole-row drag, color popover, inline rename,
		* count, add button), the card list with drag-and-drop reordering, and the
		* empty-stage hint.
		*
		* Cards drag anywhere on the card (no handle) within their stage and across
		* stages; the whole column head drags the stage left/right. While a drag is
		* in flight the source fades to 45% opacity, and hovering a column tints its
		* outline with the stage color. Drop positions still show as a thin
		* insertion bar. The column talks to the controller directly for its own
		* mutations (rename, recolor, remove) so the popover feedback stays local;
		* opening the create-task dialog belongs to the page (it owns the modal
		* state).
		*/
		/** One draggable task card; delete lives in the hover-revealed corner ×. */
		function TaskCard({ task, onDelete, onContextMenu }) {
			const [dragging, setDragging] = (0, react.useState)(false);
			const onDragStart = (event) => {
				const transfer = event.dataTransfer;
				if (transfer === null) return;
				beginDrag({
					kind: "task",
					taskId: task.id
				});
				transfer.effectAllowed = "move";
				transfer.setData(TASK_ID_MIME, task.id);
				transfer.setData("text/plain", task.id);
				setDragging(true);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `group relative flex cursor-grab items-start rounded-[10px] border border-black/[0.06] bg-white px-[10px] py-[12px] text-[13px] leading-[1.55] text-[#33363b] [overflow-wrap:anywhere] active:cursor-grabbing ${dragging ? "opacity-45" : ""}`,
				draggable: true,
				onDragStart,
				onDragEnd: () => {
					setDragging(false);
					endDrag();
				},
				onContextMenu: (event) => {
					event.preventDefault();
					onContextMenu(task, event);
				},
				"data-dsh-part": "card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "min-w-0",
					children: task.title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "absolute right-[4px] top-[4px] flex h-[20px] w-[20px] cursor-pointer items-center justify-center rounded-[6px] text-[13px] leading-none text-[#9aa0a8] opacity-0 hover:bg-[#f3f4f6] hover:text-[#e05252] focus-visible:opacity-100 group-hover:opacity-100",
					"aria-label": t("task.menu.delete"),
					onClick: (event) => {
						event.stopPropagation();
						onDelete(task);
					},
					"data-dsh-part": "card-delete",
					children: "×"
				})]
			});
		}
		/** The thin insertion bar shown at a valid drop position. */
		function DropHint({ vertical = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: vertical ? "w-[2px] shrink-0 self-stretch rounded-[1px] bg-[#1c1e21]/25" : "h-[2px] shrink-0 rounded-[1px] bg-[#1c1e21]/25",
				"data-dsh-part": "drop-hint"
			});
		}
		/** One stage column. */
		function StageColumn({ column, tasks, controller, onOpenCreateTask, onTaskDelete, onTaskContextMenu }) {
			const [popoverOpen, setPopoverOpen] = (0, react.useState)(false);
			const [popoverBlocked, setPopoverBlocked] = (0, react.useState)(false);
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [renameDraft, setRenameDraft] = (0, react.useState)("");
			const [dropping, setDropping] = (0, react.useState)(false);
			/** Fade the whole column while its head drag is in flight. */
			const [dragging, setDragging] = (0, react.useState)(false);
			/** Position the hovered pointer would drop a card at (gap index). */
			const [dropHint, setDropHint] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const bodyRef = (0, react.useRef)(null);
			const renameInputRef = (0, react.useRef)(null);
			const closePopover = (0, react.useCallback)(() => {
				setPopoverOpen(false);
				setPopoverBlocked(false);
			}, []);
			(0, react.useEffect)(() => {
				if (!popoverOpen) return void 0;
				const onMousedown = (event) => {
					const host = rootRef.current;
					if (host !== null && event.target instanceof Node && host.contains(event.target)) return;
					closePopover();
				};
				document.addEventListener("mousedown", onMousedown);
				return () => {
					document.removeEventListener("mousedown", onMousedown);
				};
			}, [popoverOpen, closePopover]);
			(0, react.useEffect)(() => onDragEnd(() => setDropHint(null)), []);
			(0, react.useEffect)(() => {
				if (!renaming) return;
				renameInputRef.current?.focus();
				renameInputRef.current?.select();
			}, [renaming]);
			const togglePopover = () => {
				setPopoverOpen((open) => !open);
				setPopoverBlocked(false);
			};
			const pickColor = async (color) => {
				await controller.setStageColor(column.id, color);
				closePopover();
			};
			const removeStage = async () => {
				if (await controller.removeStage(column.id) === "blocked") {
					setPopoverBlocked(true);
					return;
				}
				closePopover();
			};
			const startRename = () => {
				setRenameDraft(column.name);
				setRenaming(true);
			};
			const commitRename = async () => {
				if (!renaming) return;
				setRenaming(false);
				const next = renameDraft.trim();
				if (next === column.name) return;
				await controller.renameStage(column.id, next);
			};
			/** The gap index a task drag at `clientY` would drop at. */
			const hintAt = (clientY) => {
				const body = bodyRef.current;
				if (body === null) return tasks.length;
				const cards = body.querySelectorAll("[data-dsh-part=\"card\"]");
				for (let index = 0; index < cards.length; index += 1) {
					const rect = cards[index].getBoundingClientRect();
					if (clientY < rect.top + rect.height / 2) return index;
				}
				return cards.length;
			};
			const onCardDragOver = (event) => {
				if (getDragPayload()?.kind !== "task") return;
				event.preventDefault();
				if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
				setDropping(true);
				setDropHint(hintAt(event.clientY));
			};
			const onCardDragLeave = (event) => {
				const body = bodyRef.current;
				if (body !== null && event.relatedTarget instanceof Node && body.contains(event.relatedTarget)) return;
				setDropping(false);
				setDropHint(null);
			};
			const onCardDrop = async (event) => {
				event.preventDefault();
				setDropping(false);
				const hint = dropHint;
				setDropHint(null);
				const payload = getDragPayload();
				const taskId = payload?.kind === "task" ? payload.taskId : readDraggedTaskId(event);
				if (taskId === void 0 || taskId === "") return;
				await controller.moveTask(taskId, column.id, hint ?? tasks.length);
			};
			const onColumnDragStart = (event) => {
				const transfer = event.dataTransfer;
				if (transfer === null) return;
				beginDrag({
					kind: "column",
					columnId: column.id
				});
				transfer.effectAllowed = "move";
				transfer.setData("application/x-taskboard-column", column.id);
				const root = rootRef.current;
				if (root !== null) try {
					transfer.setDragImage(root, 120, 20);
				} catch {}
				setDragging(true);
			};
			const bodyClass = "flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[10px] pb-[10px]";
			const bodyChildren = [];
			for (let index = 0; index <= tasks.length; index += 1) {
				if (dropHint === index) bodyChildren.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DropHint, {}, `hint-${index}`));
				const task = tasks[index];
				if (task !== void 0) bodyChildren.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
					task,
					onDelete: onTaskDelete,
					onContextMenu: onTaskContextMenu
				}, task.id));
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: `relative flex h-full w-full flex-col rounded-[12px] ${dragging ? "opacity-45" : ""}`,
				style: {
					background: `linear-gradient(${tintBackground(column.color)}, ${tintBackground(column.color)}), #ffffff`,
					boxShadow: dropping ? `inset 0 0 0 2px ${column.color}` : void 0
				},
				"data-dsh-part": "column",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "flex cursor-grab items-center gap-[8px] px-[10px] pb-[10px] pt-[14px] active:cursor-grabbing",
						draggable: !renaming,
						onDragStart: onColumnDragStart,
						onDragEnd: () => {
							setDragging(false);
							endDrag();
						},
						"data-dsh-part": "stage-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "flex h-[20px] w-[20px] shrink-0 cursor-pointer items-center justify-center rounded-full",
								style: { background: column.color },
								onClick: togglePopover,
								"data-dsh-part": "stage-color",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChipDroplet, {})
							}),
							renaming ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: renameInputRef,
								className: "min-w-0 flex-1 rounded-[6px] border border-[#e3e5e8] px-[6px] text-[13px] font-semibold text-[#2f3237] outline-none focus:border-black/40",
								value: renameDraft,
								onChange: (event) => {
									setRenameDraft(event.target.value);
								},
								onKeyDown: (event) => {
									if (event.key === "Enter") commitRename();
									if (event.key === "Escape") setRenaming(false);
								},
								onBlur: () => void commitRename()
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "cursor-text truncate text-[13px] font-semibold text-[#2f3237]",
								title: column.name,
								onClick: startRename,
								children: column.name === "" ? "\xA0" : column.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "text-[12px] text-[#9aa0a8]",
								children: tasks.length
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ml-auto flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white hover:bg-[#f5f6f7]",
								onClick: () => {
									onOpenCreateTask(column.id);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlusIcon, {})
							})
						]
					}),
					popoverOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "absolute left-[12px] top-[44px] z-[5] flex w-[236px] flex-col gap-[10px] rounded-[10px] bg-white px-[12px] pb-[8px] pt-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]",
						"data-dsh-part": "stage-popover",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "flex gap-[9px]",
								children: STAGE_PALETTE.map((color) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-[18px] w-[18px] cursor-pointer rounded-full",
									style: {
										background: color,
										boxShadow: color.toLowerCase() === column.color.toLowerCase() ? "0 0 0 2px #ffffff, 0 0 0 4px #1c1e21" : void 0
									},
									onClick: () => void pickColor(color)
								}, color))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "cursor-pointer text-left text-[12px] text-[#e05252] hover:opacity-80",
								onClick: () => void removeStage(),
								children: t("stage.delete")
							}),
							popoverBlocked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "text-[11px] leading-[1.4] text-[#9aa0a8]",
								children: t("stage.notEmpty")
							}) : null
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: bodyRef,
						className: bodyClass,
						onDragOver: onCardDragOver,
						onDragLeave: onCardDragLeave,
						onDrop: (event) => {
							onCardDrop(event);
						},
						children: [bodyChildren, tasks.length === 0 && dropHint === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "flex flex-1 items-center justify-center text-[12px] text-[#b0b6bd]",
							children: t("stage.empty")
						}) : null]
					})
				]
			});
		}
		/** Notice kind to locale key. */
		const NOTICE_KEYS = {
			conflict: "error.conflict",
			save: "error.save",
			load: "error.load"
		};
		/** Ref + outside-mousedown dismissal shared by the pointer-positioned menus. */
		function useDismissOnOutside(open, close) {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const onMousedown = (event) => {
					if (ref.current !== null && event.target instanceof Node && ref.current.contains(event.target)) return;
					close();
				};
				document.addEventListener("mousedown", onMousedown);
				return () => {
					document.removeEventListener("mousedown", onMousedown);
				};
			}, [open, close]);
			return ref;
		}
		/** The pointer-positioned menu shell both context menus share. */
		function ContextMenu({ x, y, menuRef, part, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: menuRef,
				className: "fixed z-[20] flex min-w-[140px] flex-col rounded-[10px] bg-white py-[4px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]",
				style: {
					left: x,
					top: y
				},
				"data-dsh-part": part,
				children
			});
		}
		/** One menu row; `danger` turns the label red, `disabled` grays it out. */
		function MenuItem({ label, hint, danger = false, disabled = false, onClick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `px-[14px] py-[8px] text-left text-[13px] ${disabled ? "cursor-default" : "cursor-pointer hover:bg-[#f2f3f5]"} ${disabled ? "text-[#c9ccd1]" : danger ? "text-[#e05252]" : "text-[#33363b]"}`,
				onClick: () => {
					if (disabled) return;
					onClick();
				},
				children: [label, hint !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "ml-[6px] text-[11px] text-[#9aa0a8]",
					children: hint
				}) : null]
			});
		}
		/** The board as a right-Sidebar tab body. */
		function TaskboardPanel({ controller }) {
			const snapshot = (0, react.useSyncExternalStore)((onChange) => controller.subscribe(onChange), () => controller.getSnapshot());
			const [taskModalStage, setTaskModalStage] = (0, react.useState)(null);
			const [epicModalOpen, setEpicModalOpen] = (0, react.useState)(false);
			const [stageModalOpen, setStageModalOpen] = (0, react.useState)(false);
			/** Milestone whose context menu is open (positioned at the pointer). */
			const [epicMenu, setEpicMenu] = (0, react.useState)(null);
			/** Task whose context menu is open (positioned at the pointer). */
			const [taskMenu, setTaskMenu] = (0, react.useState)(null);
			/** Task being edited in the shared task form modal. */
			const [editTaskState, setEditTaskState] = (0, react.useState)(null);
			const [renameEpicId, setRenameEpicId] = (0, react.useState)(null);
			/** Gap index a dragged stage column would drop at in the strip. */
			const [columnDropHint, setColumnDropHint] = (0, react.useState)(null);
			const stripRef = (0, react.useRef)(null);
			const closeEpicMenu = (0, react.useCallback)(() => {
				setEpicMenu(null);
			}, []);
			const closeTaskMenu = (0, react.useCallback)(() => {
				setTaskMenu(null);
			}, []);
			const epicMenuRef = useDismissOnOutside(epicMenu !== null, closeEpicMenu);
			const taskMenuRef = useDismissOnOutside(taskMenu !== null, closeTaskMenu);
			const board = snapshot.board;
			const epics = board?.epics ?? [];
			const columns = board?.columns ?? [];
			const selectedEpicId = snapshot.selectedEpicId;
			/** Cards of the selected milestone in one column, in board (display) order. */
			const tasksByColumn = (0, react.useMemo)(() => {
				const grouped = /* @__PURE__ */ new Map();
				if (board === void 0 || selectedEpicId === void 0) return grouped;
				for (const task of board.tasks) {
					if (task.epicId !== selectedEpicId) continue;
					const bucket = grouped.get(task.columnId);
					if (bucket === void 0) grouped.set(task.columnId, [task]);
					else bucket.push(task);
				}
				return grouped;
			}, [board, selectedEpicId]);
			const openTaskModal = (0, react.useCallback)((columnId) => {
				if (selectedEpicId === void 0 || columns.length === 0) return;
				const initial = typeof columnId === "string" && columns.some((column) => column.id === columnId) ? columnId : columns[0].id;
				setTaskModalStage(initial);
			}, [columns, selectedEpicId]);
			const notice = snapshot.notice;
			const noticeText = notice === void 0 ? "" : t(NOTICE_KEYS[notice.kind]);
			const canCreateTask = selectedEpicId !== void 0;
			(0, react.useEffect)(() => onDragEnd(() => setColumnDropHint(null)), []);
			/** The gap index a stage-column drag at `clientX` would drop at. */
			const columnHintAt = (clientX) => {
				const strip = stripRef.current;
				if (strip === null) return columns.length;
				const slots = strip.querySelectorAll("[data-dsh-part=\"column-slot\"]");
				for (let index = 0; index < slots.length; index += 1) {
					const rect = slots[index].getBoundingClientRect();
					if (clientX < rect.left + rect.width / 2) return index;
				}
				return slots.length;
			};
			const onStripDragOver = (event) => {
				if (getDragPayload()?.kind !== "column") return;
				event.preventDefault();
				if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
				setColumnDropHint(columnHintAt(event.clientX));
			};
			const onStripDragLeave = (event) => {
				const strip = stripRef.current;
				if (strip !== null && event.relatedTarget instanceof Node && strip.contains(event.relatedTarget)) return;
				setColumnDropHint(null);
			};
			const onStripDrop = (event) => {
				const payload = getDragPayload();
				if (payload?.kind !== "column") return;
				event.preventDefault();
				const hint = columnDropHint;
				setColumnDropHint(null);
				controller.moveStage(payload.columnId, hint ?? columns.length);
			};
			const epicBeingMenued = epicMenu === null ? void 0 : epics.find((epic) => epic.id === epicMenu.epicId);
			const taskBeingMenued = taskMenu === null || board === void 0 ? void 0 : board.tasks.find((task) => task.id === taskMenu.taskId);
			const isLastEpic = epics.length <= 1;
			const menuedEpicTaskCount = epicBeingMenued === void 0 || board === void 0 ? 0 : board.tasks.filter((task) => task.epicId === epicBeingMenued.id).length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "relative flex h-full w-full flex-col overflow-hidden px-[12px] pb-[12px] pt-[14px]",
				"data-dsh-plugin": "taskboard",
				children: [
					notice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mb-[8px] flex shrink-0 items-center gap-[6px] text-[12px] text-[#e05252]",
						"data-dsh-part": "notice",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "truncate",
							children: noticeText
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "cursor-pointer text-[14px] leading-none text-[#9aa0a8] hover:text-[#4a4d52]",
							onClick: () => {
								controller.dismissNotice();
							},
							children: "×"
						})]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "flex shrink-0 flex-wrap items-center justify-between gap-[8px]",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "flex min-w-0 flex-wrap items-center gap-[6px]",
							children: [epics.map((epic) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: epic.id === selectedEpicId ? "cursor-pointer rounded-full bg-[#1c1e21] px-[12px] py-[6px] text-[12px] font-medium text-white" : "cursor-pointer rounded-full bg-[#f2f3f5] px-[12px] py-[6px] text-[12px] font-medium text-[#4a4d52] hover:text-[#1c1e21]",
								"data-dsh-part": "epic-tab",
								onClick: () => {
									controller.selectEpic(epic.id);
								},
								onContextMenu: (event) => {
									event.preventDefault();
									setEpicMenu({
										epicId: epic.id,
										x: event.clientX,
										y: event.clientY
									});
								},
								children: epic.name
							}, epic.id)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "cursor-pointer rounded-full bg-[#f2f3f5] px-[10px] py-[5px] text-[13px] text-[#9aa0a8] hover:text-[#4a4d52]",
								"data-dsh-part": "epic-add",
								onClick: () => {
									setEpicModalOpen(true);
								},
								children: t("tab.add")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ml-auto flex items-center gap-[6px]",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "flex cursor-pointer items-center gap-[4px] rounded-full border border-[#e3e5e8] bg-white px-[12px] py-[6px] text-[12px] font-medium text-[#4a4d52] hover:opacity-80",
								"data-dsh-part": "stage-add",
								onClick: () => {
									setStageModalOpen(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlusIcon, {
									size: 10,
									stroke: "#6b7076"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.addStage") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: canCreateTask ? "cursor-pointer rounded-full bg-[#1c1e21] px-[14px] py-[7px] text-[12px] font-medium text-white hover:opacity-90" : "cursor-default rounded-full bg-[#1c1e21] px-[14px] py-[7px] text-[12px] font-medium text-white opacity-40",
								"data-dsh-part": "task-add",
								onClick: () => {
									openTaskModal();
								},
								children: t("action.newTask")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mt-[10px] min-h-0 flex-1 overflow-x-auto overflow-y-hidden",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							ref: stripRef,
							className: "flex h-full gap-[10px]",
							onDragOver: onStripDragOver,
							onDragLeave: onStripDragLeave,
							onDrop: onStripDrop,
							children: Array.from({ length: columns.length + 1 }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [columnDropHint === index ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DropHint, { vertical: true }) : null, columns[index] !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "h-full shrink-0",
								style: { width: 240 },
								"data-dsh-part": "column-slot",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageColumn, {
									column: columns[index],
									tasks: tasksByColumn.get(columns[index].id) ?? [],
									controller,
									onOpenCreateTask: openTaskModal,
									onTaskDelete: (task) => {
										controller.removeTask(task.id);
									},
									onTaskContextMenu: (task, event) => {
										setTaskMenu({
											taskId: task.id,
											x: event.clientX,
											y: event.clientY
										});
									}
								})
							}) : null] }, columns[index]?.id ?? `hint-tail-${index}`))
						})
					}),
					taskModalStage !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskFormModal, {
						stages: columns,
						initialStageId: taskModalStage,
						initialTitle: "",
						heading: t("modal.task.title"),
						submitLabel: t("common.create"),
						onCancel: () => {
							setTaskModalStage(null);
						},
						onSubmit: (input) => {
							setTaskModalStage(null);
							if (selectedEpicId === void 0) return;
							controller.createTask({
								epicId: selectedEpicId,
								columnId: input.columnId,
								title: input.title
							});
						}
					}) : null,
					editTaskState !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskFormModal, {
						stages: columns,
						initialStageId: editTaskState.columnId,
						initialTitle: editTaskState.title,
						heading: t("modal.task.editTitle"),
						submitLabel: t("common.save"),
						onCancel: () => {
							setEditTaskState(null);
						},
						onSubmit: (input) => {
							setEditTaskState(null);
							controller.editTask(editTaskState.id, {
								title: input.title,
								columnId: input.columnId
							});
						}
					}) : null,
					stageModalOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateStageModal, {
						onCancel: () => {
							setStageModalOpen(false);
						},
						onCreate: (name) => {
							setStageModalOpen(false);
							controller.addStage(name);
						}
					}) : null,
					epicModalOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateEpicModal, {
						onCancel: () => {
							setEpicModalOpen(false);
						},
						onCreate: (name) => {
							setEpicModalOpen(false);
							controller.createEpic(name);
						}
					}) : null,
					renameEpicId !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RenameEpicModal, {
						initialName: epics.find((epic) => epic.id === renameEpicId)?.name ?? "",
						onCancel: () => {
							setRenameEpicId(null);
						},
						onSubmit: (name) => {
							setRenameEpicId(null);
							controller.renameEpic(renameEpicId, name);
						}
					}) : null,
					epicMenu !== null && epicBeingMenued !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ContextMenu, {
						x: epicMenu.x,
						y: epicMenu.y,
						menuRef: epicMenuRef,
						part: "epic-menu",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuItem, {
							label: t("epic.menu.rename"),
							onClick: () => {
								setRenameEpicId(epicBeingMenued.id);
								setEpicMenu(null);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuItem, {
							label: t("epic.menu.delete"),
							danger: true,
							disabled: isLastEpic || menuedEpicTaskCount > 0,
							hint: isLastEpic ? t("epic.menu.lastBlocked") : menuedEpicTaskCount > 0 ? t("epic.menu.deleteBlocked") : void 0,
							onClick: () => {
								setEpicMenu(null);
								controller.removeEpic(epicBeingMenued.id);
							}
						})]
					}) : null,
					taskMenu !== null && taskBeingMenued !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextMenu, {
						x: taskMenu.x,
						y: taskMenu.y,
						menuRef: taskMenuRef,
						part: "task-menu",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuItem, {
							label: t("task.menu.edit"),
							onClick: () => {
								setEditTaskState({
									id: taskBeingMenued.id,
									title: taskBeingMenued.title,
									columnId: taskBeingMenued.columnId
								});
								setTaskMenu(null);
							}
						})
					}) : null
				]
			});
		}
		// src/client/right-panel.tsx
		/**
		* Right-sidebar tab registration for the taskboard.
		*
		* The board is a docked tab type in the right Sidebar, reached from the
		* guide (开始) page's card row — the same mechanism the shipped 工作区文件 /
		* 新建终端 / 浏览器 cards use. Two stages, exactly like every other type:
		*
		* 1. `sidebarRightTabs.register(definition)` — what the type IS: its kind,
		*    priority band, tab chip title, and the guide card(s) it contributes.
		* 2. `slots.inject('sidebar.right.pane.tab')` (+ `.title`) — the body and the
		*    live chip title, dispatched under the definition's own `id`.
		*
		* Registration problems are logged, never thrown: the web shell fails the
		* whole boot when a plugin apply throws, and an external plugin must not take
		* the GUI down.
		*/
		/** Implementation identity of this tab type (unique across every registration). */
		const TASKBOARD_TAB_ID = "dsh-client-ui-taskboard";
		/** Type discriminator: what the tabs of this type are, and what `openTab` names. */
		const TASKBOARD_TAB_KIND = "taskboard";
		/** Position of the guide card among every type's entries (files is 10, terminal later). */
		const GUIDE_ORDER = 30;
		/** Absent-kit stand-in keeping the hook call order fixed: reads nothing. */
		const useSessionsAbsent = () => void 0;
		/**
		* Register the taskboard's tab type, its guide card, and its tab body/title.
		* @param ctx - client root context (services: slots, sidebarRightTabs).
		* @param controller - the board controller the body drives.
		* @param api - the board API client handed through the slot inject face.
		* @returns disposer releasing every registration.
		*/
		function registerTaskboardTab(ctx, controller, api) {
			const faces = ctx;
			const slots = ctx.slots;
			const disposers = [];
			const registry = faces.sidebarRightTabs;
			if (registry === void 0) return () => {};
			faces.effect?.(() => registry.register({
				id: TASKBOARD_TAB_ID,
				kind: TASKBOARD_TAB_KIND,
				priority: "extension",
				title: () => t("entry.label"),
				guide: [{
					id: "board",
					order: GUIDE_ORDER,
					title: () => t("entry.label"),
					description: () => t("guide.description"),
					icon: GuideArtworkTaskboard
				}]
			}), "taskboard: tab type");
			if (slots === void 0) return () => {};
			disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register({
				name: "sidebar.right.pane.tab",
				key: TASKBOARD_TAB_ID,
				inject: () => ({
					controller,
					api
				})
			}, TaskboardTabBody)));
			disposers.push(slots.inject("sidebar.right.pane.tab.title", () => slots.register({
				name: "sidebar.right.pane.tab.title",
				key: TASKBOARD_TAB_ID
			}, TaskboardTabTitle)));
			return () => {
				for (const dispose of disposers.splice(0)) dispose();
			};
		}
		/**
		* The docked tab body: resolve the session's workspace root from the
		* framework session list (exactly the shipped files tab's read:
		* `useSessions(s => s.byId[sessionId]?.cwd)`), load that workspace's board,
		* and re-load when the session switch changes the root. Without a resolved
		* root the body shows the status line — the board is never loaded against a
		* guessed workspace (the host refuses a ws-less read anyway).
		*/
		function TaskboardTabBody(props) {
			const { controller, sessionId, useSessions } = props;
			const workspace = (useSessions ?? useSessionsAbsent)((list) => sessionId === void 0 ? void 0 : list.byId[sessionId]?.cwd);
			(0, react.useEffect)(() => {
				if (workspace === void 0) return;
				controller.load(workspace);
			}, [controller, workspace]);
			if (workspace === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "flex h-full items-center justify-center px-6 text-[12px] text-[#b0b6bd]",
				"data-dsh-part": "taskboard-no-workspace",
				children: t("status.noWorkspace")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskboardPanel, { controller });
		}
		/** The tab chip text. */
		function TaskboardTabTitle() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: t("entry.label") });
		}
		// src/client/index.ts
		/** Required services (fiber inject waiting — the runtime must be up first). */
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs"
		];
		/**
		* Mount the taskboard surfaces.
		* @param ctx - client root context (locale, slots, sidebarRightTabs).
		*/
		function apply(ctx) {
			const faces = ctx;
			faces.effect?.(() => {
				try {
					return faces.locale?.register("taskboard", {
						zh,
						en
					}) ?? (() => {});
				} catch {
					return () => {};
				}
			}, "taskboard: dictionaries");
			try {
				setRuntimeTranslate(faces.locale?.bind(NS));
			} catch {}
			const api = new BoardApi();
			const controller = new TaskboardController(api);
			try {
				faces.effect?.(() => registerTaskboardTab(ctx, controller, api), "taskboard: right tab");
			} catch (error) {
				console.warn("[taskboard] right-sidebar registration failed:", error);
			}
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map