// Стол дела в Foundry: сцена дела с отметкой модуля + HTML-слой по макету «А · Доска дела».
// Сцена на дело (их может быть несколько), раскладка — один из трёх шаблонов (scripts/job-logic.mjs).
// Шапка — из записи журнала дела (доска холла); фото, задник, рискари и часы — во флаге сцены nadgrad.jobScene.
// Менять может только мастер: кнопки внутри фото, «Сменить задник», «+ рискарь», «+ часы», окно стола (шестерёнка).
// Переходы: в холле у мастера ▶ на карточке дела — сцена дела становится активной (Foundry переводит всех);
// в шапке стола — «Холл».
import { MODULE_ID } from "./logic.mjs";
import { STAGE, fitStage, readJob, jobView } from "./hall-logic.mjs";
import { freeArea, skinOf, hallScene, runnerRows, openActor } from "./hall.mjs";
import {
  LAYOUTS, layoutOf, readTable, boardView, stressView, tableRunners, addableRunners, jobScenes, lastScene, sceneName,
  JOB_SCENE_FOLDER,
} from "./job-logic.mjs";
import { CLOCK_TYPE, clockSrc, normClock } from "./clock-logic.mjs";
import { stepClock, createClockDialog } from "./clock.mjs";

const FLAG = "jobScene";
const ART = `modules/${MODULE_ID}/art/job`;
const TPL = `modules/${MODULE_ID}/templates`;
const DEFAULTS = { bg: `${ART}/backdrops/stilts.webp`, logo: `${ART}/figure.webp`, side: `${ART}/side.webp` };
/** Задники из модуля — кадры автора (2026-11-14). */
export const BACKDROPS = [
  { file: "stilts.webp", label: "Дома на сваях" },
  { file: "round.webp", label: "Круглый дом над переулком" },
  { file: "stairs.webp", label: "Пожарные лестницы" },
  { file: "floors.webp", label: "Бетонные ярусы" },
  { file: "arches.webp", label: "Арки, снег, толпа" },
  { file: "tunnel.webp", label: "Красный тоннель" },
].map((b) => ({ ...b, src: `${ART}/backdrops/${b.file}` }));
const SKIN_IDS = ["tush", "smog", "acid", "classic"];
const DEFAULT_IMG = /mystery-man|icons\/svg\//;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const isJobScene = (scene) => !!scene?.getFlag?.(MODULE_ID, FLAG);
const tableOf = (scene) => readTable(scene?.getFlag?.(MODULE_ID, FLAG));
const sceneList = () => (game.scenes?.contents ?? []).filter(isJobScene).map((s) => ({ id: s.id, name: s.name, sort: s.sort, table: tableOf(s) }));
const tpl = (name, ctx) => foundry.applications.handlebars.renderTemplate(`${TPL}/${name}`, ctx);

let root = null;
let timer = null;
const state = { picker: null }; // какой список открыт у мастера: "runners" | "clocks" | null

// ---------- запись (только мастер) ----------

async function setTable(scene, patch) {
  if (!game.user.isGM || !scene) return;
  const upd = {};
  for (const [k, v] of Object.entries(patch)) upd[`flags.${MODULE_ID}.${FLAG}.${k}`] = v;
  return scene.update(upd);
}
async function setSlot(scene, n, patch) {
  const t = tableOf(scene);
  const slots = t.slots.map((s, i) => (i === n - 1 ? { ...s, ...patch } : s));
  return setTable(scene, { slots });
}

/** Выбор картинки встроенным файловым браузером Foundry: загруженное или загрузка с компьютера. */
function pickImage(current = "") {
  return new Promise((resolve) => {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const opts = { type: "image", callback: (path) => resolve(path || null) };
    if (current && !current.startsWith(`modules/${MODULE_ID}/`)) opts.current = current;
    const fp = new FP(opts);
    fp.render(true);
  });
}

function showImage(src, title) {
  if (!src) return;
  const IP = foundry.applications?.apps?.ImagePopout;
  try {
    if (IP) return new IP({ src, window: { title: title || "Фото" } }).render(true);
  } catch (err) { console.warn(`${MODULE_ID} | ImagePopout v13`, err); }
  try { new globalThis.ImagePopout(src, { title: title || "Фото" }).render(true); } catch (err) { console.warn(`${MODULE_ID} | ImagePopout`, err); }
}

async function captionDialog(current) {
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Подпись к фото" },
    content: `<div class="form-group"><input type="text" name="ngCaption" maxlength="80" value="${esc(current)}" placeholder="кто или что это" autofocus></div><p class="hint">Пустая подпись — у игроков её не видно.</p>`,
    ok: { label: "Сохранить", callback: (event, button) => button.form.elements.ngCaption.value },
    rejectClose: false,
  });
}

/** Выбор раскладки для новой сцены дела. */
async function chooseLayout(jobName) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: `Стол дела${jobName ? `: ${jobName}` : ""}` },
    content: `<p>Раскладка фото на доске. Поменять можно потом в окне стола (шестерёнка).</p><ul>${LAYOUTS.map((l) => `<li><b>${esc(l.label)}</b> — ${esc(l.hint)}</li>`).join("")}</ul>`,
    buttons: LAYOUTS.map((l, i) => ({ action: l.id, label: l.label, default: i === 0 })),
    rejectClose: false,
  });
}

async function sceneFolder() {
  let f = game.folders.find((x) => x.type === "Scene" && x.name === JOB_SCENE_FOLDER);
  if (!f) f = await Folder.create({ name: JOB_SCENE_FOLDER, type: "Scene", color: "#E0763A" });
  return f;
}

/** Новая сцена-стол для дела: 1920×1080, без сетки и тумана, задник модуля. Не активирует. */
export async function createJobScene(entry, layout) {
  if (!game.user.isGM || !entry) return null;
  const folder = await sceneFolder();
  const count = jobScenes(sceneList(), entry.id).length;
  const name = sceneName(entry.name, count);
  return Scene.create({
    name,
    navName: name.replace(/^Дело:\s*/, ""),
    navigation: true,
    folder: folder?.id ?? null,
    width: 1920, height: 1080, padding: 0,
    backgroundColor: "#14120F",
    background: { src: DEFAULTS.bg },
    grid: { type: CONST.GRID_TYPES.GRIDLESS },
    tokenVision: false,
    fog: { exploration: false },
    flags: { [MODULE_ID]: { [FLAG]: { job: entry.id, layout: layoutOf(layout).id, slots: [], runners: [], clocks: [], at: Date.now() } } },
  });
}

/** «▶ На дело» из холла: последняя сцена этого дела (или новая) — активной, дело — «в игре». */
export async function goToJob(entryId) {
  if (!game.user.isGM) return;
  const entry = game.journal.get(entryId);
  if (!entry) return;
  const last = lastScene(jobScenes(sceneList(), entry.id));
  let scene = last ? game.scenes.get(last.id) : null;
  if (!scene) {
    const layout = await chooseLayout(entry.name);
    if (!layout) return;
    scene = await createJobScene(entry, layout);
  }
  if (!scene) return;
  if (readJob(entry.getFlag(MODULE_ID, "job")).status === "open") await entry.setFlag(MODULE_ID, "job.status", "playing");
  await scene.activate();
}

// ---------- слой ----------

function mount() {
  if (root?.isConnected) return root;
  root = document.createElement("div");
  root.id = "ng-job";
  root.setAttribute("aria-label", "Стол дела");
  const uiEl = document.getElementById("interface");
  const board = document.getElementById("board");
  const zi = parseInt(uiEl ? getComputedStyle(uiEl).zIndex : "", 10);
  const zb = parseInt(board ? getComputedStyle(board).zIndex : "", 10);
  root.style.zIndex = String(Number.isFinite(zi) ? zi : (Number.isFinite(zb) ? zb : 0) + 1);
  if (uiEl?.parentElement) uiEl.parentElement.insertBefore(root, uiEl);
  else document.body.appendChild(root);
  root.addEventListener("click", onClick);
  root.addEventListener("contextmenu", onContext);
  root.addEventListener("wheel", (e) => { if (e.target.closest(".ng-job-stage")) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  return root;
}
function unmount() {
  root?.remove();
  root = null;
  state.picker = null;
}

function headerContext(t) {
  const entry = t.job ? game.journal.get(t.job) : null;
  if (!entry) return { name: canvas.scene?.name ?? "Дело", meta: "", reward: "", chips: [], unknown: false, linked: false };
  const v = jobView(entry.getFlag(MODULE_ID, "job"), { id: entry.id });
  return { ...v, name: v.name || entry.name, linked: true, canOpen: game.user.isGM || entry.testUserPermission(game.user, "LIMITED") };
}

function runnersContext(t, isGM) {
  const rows = runnerRows();
  const list = tableRunners(t, rows).map((r) => {
    const a = game.actors.get(r.id);
    return {
      ...r,
      initial: (r.name.trim()[0] ?? "?").toUpperCase(),
      rankText: r.rank == null ? "?" : String(r.rank),
      stress: stressView(a?.system?.stress?.value, a?.system?.stress?.max),
    };
  });
  const addable = isGM && state.picker === "runners"
    ? addableRunners(t, rows).map((r) => ({ ...r, initial: (r.name.trim()[0] ?? "?").toUpperCase(), rankText: r.rank == null ? "?" : String(r.rank) }))
    : [];
  return { list, addable, open: isGM && state.picker === "runners" };
}

function clocksContext(t, isGM) {
  const list = t.clocks
    .map((id) => game.actors.get(id))
    .filter((a) => a && a.type === CLOCK_TYPE)
    .map((a) => {
      const c = normClock(a.system);
      return { id: a.id, name: a.name, src: clockSrc(a.system), value: c.value, size: c.size, full: c.value >= c.size, canStep: a.isOwner };
    });
  const choices = isGM && state.picker === "clocks"
    ? (game.actors?.contents ?? []).filter((a) => a.type === CLOCK_TYPE && !t.clocks.includes(a.id))
      .map((a) => { const c = normClock(a.system); return { id: a.id, name: a.name, value: c.value, size: c.size }; })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    : [];
  return { list, choices, open: isGM && state.picker === "clocks" };
}

async function render() {
  const scene = canvas?.scene;
  if (!isJobScene(scene)) return unmount();
  const el = mount();
  const skin = skinOf();
  for (const s of SKIN_IDS) el.classList.toggle(`skin-${s}`, s === skin);
  const t = tableOf(scene);
  const isGM = game.user.isGM;
  const scenes = jobScenes(sceneList(), t.job).map((s) => ({ ...s, current: s.id === scene.id }));
  const ctx = {
    layout: fitStage(freeArea(), STAGE),
    isGM,
    bg: t.bg || DEFAULTS.bg,
    logo: t.logo || DEFAULTS.logo,
    side: t.side === "none" ? "" : (t.side || DEFAULTS.side),
    job: headerContext(t),
    board: boardView(t, { isGM }),
    runners: runnersContext(t, isGM),
    clocks: clocksContext(t, isGM),
    scenes: scenes.length > 1 ? scenes : [],
    hasHall: !!hallScene(),
  };
  el.innerHTML = await tpl("job.hbs", ctx);
}

export function refresh() {
  clearTimeout(timer);
  timer = setTimeout(() => render().catch((err) => console.error(`${MODULE_ID} | стол дела`, err)), 60);
}

function relayout() {
  const stage = root?.querySelector(".ng-job-stage");
  if (!stage) return;
  const l = fitStage(freeArea(), STAGE);
  stage.style.transform = `scale(${l.scale})`;
  stage.style.left = `${l.left}px`;
  stage.style.top = `${l.top}px`;
}

async function onContext(event) {
  if (!event.target.closest(".ng-job-stage")) return;
  event.preventDefault();
  const btn = event.target.closest('[data-job="clock"]');
  if (btn) return stepClock(game.actors.get(btn.dataset.id), -1);
}

async function onClick(event) {
  const btn = event.target.closest("[data-job]");
  if (!btn) return;
  event.preventDefault();
  const scene = canvas.scene;
  const t = tableOf(scene);
  const n = Number(btn.dataset.n) || 0;
  const id = btn.dataset.id;
  const gm = game.user.isGM;
  switch (btn.dataset.job) {
    case "photo": {
      const s = t.slots[n - 1];
      return showImage(s?.img, s?.caption);
    }
    case "photo-pick": {
      if (!gm) return;
      const path = await pickImage(t.slots[n - 1]?.img);
      if (path) await setSlot(scene, n, { img: path });
      return;
    }
    case "photo-clear": return gm && setSlot(scene, n, { img: "" });
    case "caption": {
      if (!gm) return;
      const text = await captionDialog(t.slots[n - 1]?.caption ?? "");
      if (text != null) await setSlot(scene, n, { caption: String(text).trim() });
      return;
    }
    case "bg": {
      if (!gm) return;
      const path = await pickImage(t.bg);
      if (path) await scene.update({ [`flags.${MODULE_ID}.${FLAG}.bg`]: path, "background.src": path });
      return;
    }
    case "job": return game.journal.get(t.job)?.sheet.render(true);
    case "hall": {
      const h = hallScene();
      if (!h) return ui.notifications?.warn("Холла нет — создай его в настройках модуля («Холл кампании»).");
      return gm ? h.activate() : h.view();
    }
    case "scene": return gm && game.scenes.get(id)?.activate();
    case "settings": return gm && new (adminClass())().render(true);
    case "runner": return openActor(id);
    case "runner-remove": return gm && setTable(scene, { runners: t.runners.filter((x) => x !== id) });
    case "runners-pick": state.picker = state.picker === "runners" ? null : "runners"; return render();
    case "runner-add": state.picker = null; return gm && setTable(scene, { runners: [...t.runners, id] });
    case "clocks-pick": state.picker = state.picker === "clocks" ? null : "clocks"; return render();
    case "clock-add": state.picker = null; return gm && setTable(scene, { clocks: [...t.clocks, id] });
    case "clock-remove": return gm && setTable(scene, { clocks: t.clocks.filter((x) => x !== id) });
    case "clock-new": {
      if (!gm) return;
      state.picker = null;
      const actor = await createClockDialog();
      if (actor) await setTable(scene, { clocks: [...tableOf(scene).clocks, actor.id] });
      return render();
    }
    case "clock": return stepClock(game.actors.get(id), 1);
  }
}

// ---------- окно стола (мастер) ----------

let Admin = null;
function adminClass() {
  if (Admin) return Admin;
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  const scene = () => canvas?.scene;
  const set = async (app, patch) => { await setTable(scene(), patch); app.render(); };
  Admin = class NadgradJobAdmin extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "ng-job-admin",
      classes: ["ng-hall-win"],
      window: { title: "Стол дела", icon: "fa-solid fa-thumbtack" },
      position: { width: 600, height: "auto" },
      actions: {
        ngLayout: function (event, target) { return set(this, { layout: target.dataset.id }); },
        ngBackdrop: async function (event, target) {
          const src = target.dataset.src;
          await scene()?.update({ [`flags.${MODULE_ID}.${FLAG}.bg`]: src, "background.src": src });
          this.render();
        },
        ngPickBg: async function () {
          const path = await pickImage(tableOf(scene()).bg);
          if (path) await scene()?.update({ [`flags.${MODULE_ID}.${FLAG}.bg`]: path, "background.src": path });
          this.render();
        },
        ngPick: async function (event, target) {
          const key = target.dataset.key;
          const path = await pickImage(tableOf(scene())[key]);
          if (path) await set(this, { [key]: path });
        },
        ngReset: function (event, target) { return set(this, { [target.dataset.key]: "" }); },
        ngNoSide: function () { return set(this, { side: "none" }); },
        ngNewScene: async function () {
          const entry = game.journal.get(tableOf(scene()).job);
          if (!entry) return ui.notifications.warn("Сначала привяжи дело.");
          const layout = await chooseLayout(entry.name);
          if (!layout) return;
          const s = await createJobScene(entry, layout);
          if (s) ui.notifications.info(`Сцена «${s.name}» создана — она в папке «${JOB_SCENE_FOLDER}» и в переключателе сцен в шапке стола.`);
          this.render();
        },
        ngGo: function (event, target) { return game.scenes.get(target.dataset.id)?.activate(); },
      },
    };
    static PARTS = { body: { template: `${TPL}/job-admin.hbs` } };
    _onRender() {
      this.element.querySelector("select[name=job]")?.addEventListener("change", (e) => setTable(scene(), { job: e.target.value }).then(() => this.render()));
    }
    async _prepareContext() {
      const s = scene();
      if (!isJobScene(s)) return { none: true };
      const t = tableOf(s);
      const jobs = (game.journal?.contents ?? []).filter((j) => j.getFlag(MODULE_ID, "job"))
        .map((j) => ({ id: j.id, name: j.name, on: j.id === t.job }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      const filled = t.slots.slice(0, layoutOf(t.layout).slots.length).filter((x) => x.img).length;
      return {
        sceneName: s.name,
        jobs,
        noJob: !t.job,
        layouts: LAYOUTS.map((l) => ({ ...l, count: l.slots.length, on: l.id === t.layout })),
        filled,
        hiddenFilled: t.slots.slice(layoutOf(t.layout).slots.length).filter((x) => x.img).length,
        backdrops: BACKDROPS.map((b) => ({ ...b, on: (t.bg || DEFAULTS.bg) === b.src })),
        bgCustom: t.bg && !BACKDROPS.some((b) => b.src === t.bg) ? t.bg : "",
        logo: t.logo || DEFAULTS.logo,
        logoCustom: !!t.logo,
        side: t.side === "none" ? "" : (t.side || DEFAULTS.side),
        sideCustom: !!t.side && t.side !== "none",
        sideOff: t.side === "none",
        scenes: jobScenes(sceneList(), t.job).map((x) => ({ ...x, current: x.id === s.id })),
      };
    }
  };
  return Admin;
}

// ---------- регистрация ----------

export function registerJobTable() {
  Hooks.once("ready", () => { if (game.system?.id === "CBRPNK") refresh(); });
  Hooks.on("canvasReady", () => refresh());
  Hooks.on("updateScene", (scene, change) => {
    // последняя сцена дела, где была партия, — для «▶ На дело» (пишет один мастер)
    if (change.active === true && isJobScene(scene) && game.users?.activeGM?.isSelf) {
      scene.setFlag(MODULE_ID, `${FLAG}.at`, Date.now()).catch(() => {});
    }
    if (scene.id === canvas?.scene?.id || isJobScene(scene)) refresh();
  });
  for (const h of ["createScene", "deleteScene", "updateJournalEntry", "createActor", "updateActor", "deleteActor"]) {
    Hooks.on(h, () => { if (root) refresh(); });
  }
  Hooks.on("collapseSidebar", () => setTimeout(relayout, 250));
  Hooks.on("renderSceneNavigation", () => setTimeout(relayout, 50));
  window.addEventListener("resize", () => relayout());
}
