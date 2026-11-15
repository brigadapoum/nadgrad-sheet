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
  JOB_SCENE_FOLDER, pinnedClocks, BG_DEFAULT, PHOTO_DEFAULT, BG_ZOOM, readBgView, readPhotoView, photoPreview, bgCss, bgPan, bgZoom, skinLabel, nextSkin,
} from "./job-logic.mjs";
import { CLOCK_TYPE, clockSrc, normClock } from "./clock-logic.mjs";
import { stepClock, createClockDialog } from "./clock.mjs";

const FLAG = "jobScene";
const ART = `modules/${MODULE_ID}/art/job`;
const TPL = `modules/${MODULE_ID}/templates`;
const DEFAULTS = { bg: `${ART}/backdrops/stilts.webp`, logo: `${ART}/figure.webp`, side: `${ART}/side.webp`, corner: `${ART}/corner.webp` };
/** Арт-подложка: «none» — убран мастером, пусто — арт модуля. */
const artOf = (t, key) => (t[key] === "none" ? "" : (t[key] || DEFAULTS[key]));
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

/** Новый задник: картинка во флаг и в фон сцены, кадр — по умолчанию. */
function setBackdrop(scene, src) {
  if (!game.user.isGM || !scene) return;
  // fit: cover — чтобы под скрытым столом задник не растягивался (если версия Foundry это поле знает)
  return scene.update({ [`flags.${MODULE_ID}.${FLAG}.bg`]: src, [`flags.${MODULE_ID}.${FLAG}.bgView`]: { ...BG_DEFAULT }, "background.src": src, "background.fit": "cover" });
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

/** Часы к фото (мастер): счётчики стола — сверху, остальные — ниже; «Новые часы…»; «без часов» — открепить. */
async function photoClockDialog(t, current) {
  const all = (game.actors?.contents ?? []).filter((a) => a.type === CLOCK_TYPE).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const opt = (a) => { const c = normClock(a.system); return `<option value="${esc(a.id)}"${a.id === current ? " selected" : ""}>${esc(a.name)} — ${c.value}/${c.size}</option>`; };
  const onTable = all.filter((a) => t.clocks.includes(a.id));
  const rest = all.filter((a) => !t.clocks.includes(a.id));
  const content = `<div class="form-group"><select name="ngClock" autofocus>
    <option value="">— без часов —</option>
    ${onTable.length ? `<optgroup label="На столе">${onTable.map(opt).join("")}</optgroup>` : ""}
    ${rest.length ? `<optgroup label="Остальные счётчики">${rest.map(opt).join("")}</optgroup>` : ""}
    <option value="__new">Новые часы…</option>
  </select></div><p class="hint">Часы встанут в угол фото и уйдут с полосы внизу. Без часов — вернутся на полосу.</p>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Часы к фото" },
    content,
    ok: { label: "Готово", callback: (event, button) => button.form.elements.ngClock.value },
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
    background: { src: DEFAULTS.bg, fit: "cover" },
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
  root.addEventListener("pointerover", onArtOver);
  root.addEventListener("pointerout", onArtOut);
  root.addEventListener("wheel", (e) => { if (e.target.closest(".ng-job-stage")) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  return root;
}
function unmount() {
  hideArt();
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

function clockView(id) {
  const a = id ? game.actors.get(id) : null;
  if (!a || a.type !== CLOCK_TYPE) return null;
  const c = normClock(a.system);
  return { id: a.id, name: a.name, src: clockSrc(a.system), value: c.value, size: c.size, full: c.value >= c.size, canStep: a.isOwner };
}

/** Фото с приколотыми часами: часы — на фото (угол рамки), клик +1, правый −1. */
function boardContext(t, isGM) {
  const board = boardView(t, { isGM });
  board.slots = board.slots.map((s) => ({ ...s, clockView: s.has ? clockView(s.clock) : null }));
  return board;
}

function clocksContext(t, isGM) {
  const pinned = pinnedClocks(t);
  const list = t.clocks.filter((id) => !pinned.has(id)).map(clockView).filter(Boolean);
  const choices = isGM && state.picker === "clocks"
    ? (game.actors?.contents ?? []).filter((a) => a.type === CLOCK_TYPE && !t.clocks.includes(a.id))
      .map((a) => { const c = normClock(a.system); return { id: a.id, name: a.name, value: c.value, size: c.size }; })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    : [];
  return { list, choices, open: isGM && state.picker === "clocks", show: isGM || list.length > 0 };
}

async function render() {
  const scene = canvas?.scene;
  if (!isJobScene(scene)) return unmount();
  const el = mount();
  const skin = skinOf();
  for (const s of SKIN_IDS) el.classList.toggle(`skin-${s}`, s === skin);
  const t = tableOf(scene);
  const isGM = game.user.isGM;
  // «Скрыть стол» (мастер): слоя нет — обычная сцена Foundry; у мастера сверху — «Показать стол»
  if (t.hidden) {
    hideArt();
    if (!isGM) return unmount();
    el.innerHTML = `<button type="button" class="ng-job-unhide" data-job="show" title="Вернуть стол дела у всех"><i class="fa-solid fa-eye"></i> Показать стол дела</button>`;
    return;
  }
  const scenes = jobScenes(sceneList(), t.job).map((s) => ({ ...s, current: s.id === scene.id }));
  const ctx = {
    layout: fitStage(freeArea(), STAGE),
    isGM,
    bg: t.bg || DEFAULTS.bg,
    bgv: bgCss(t.bgView),
    skinLabel: skinLabel(skin),
    logo: t.logo || DEFAULTS.logo,
    side: artOf(t, "side"),
    corner: artOf(t, "corner"),
    job: headerContext(t),
    board: boardContext(t, isGM),
    runners: runnersContext(t, isGM),
    clocks: clocksContext(t, isGM),
    scenes: scenes.length > 1 ? scenes : [],
    hasHall: !!hallScene(),
  };
  hideArt();
  el.innerHTML = await tpl("job.hbs", ctx);
  fitTitle(el);
}

/** Длинное название дела — шрифт меньше, пока не влезет целиком (до 22 px), а не обрезка. */
function fitTitle(el) {
  const t = el.querySelector(".ng-job-title");
  if (!t) return;
  let size = 40;
  t.style.fontSize = `${size}px`;
  while (t.scrollWidth > t.clientWidth + 1 && size > 22) {
    size -= 2;
    t.style.fontSize = `${size}px`;
  }
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
      if (path) await setSlot(scene, n, { img: path, view: { ...PHOTO_DEFAULT } });
      return;
    }
    case "photo-clear": return gm && setSlot(scene, n, { img: "", view: { ...PHOTO_DEFAULT } });
    case "photo-clock": {
      if (!gm) return;
      let pick = await photoClockDialog(t, t.slots[n - 1]?.clock ?? "");
      if (pick == null) return;
      if (pick === "__new") pick = (await createClockDialog())?.id ?? null;
      if (pick == null) return;
      const now = tableOf(scene);
      const slots = now.slots.map((s, i) => (i === n - 1 ? { ...s, clock: pick } : s));
      // приколотые часы — тоже «на столе»: открепишь — вернутся на полосу внизу
      const clocks = pick && !now.clocks.includes(pick) ? [...now.clocks, pick] : now.clocks;
      return setTable(scene, { slots, clocks });
    }
    case "photo-clock-clear": return gm && setSlot(scene, n, { clock: "" });
    case "caption": {
      if (!gm) return;
      const text = await captionDialog(t.slots[n - 1]?.caption ?? "");
      if (text != null) await setSlot(scene, n, { caption: String(text).trim() });
      return;
    }
    case "bg": {
      if (!gm) return;
      const path = await pickImage(t.bg);
      if (path) await setBackdrop(scene, path);
      return;
    }
    case "bg-frame": return gm && openFrame(0);
    case "photo-frame": return gm && openFrame(n);
    case "hide": state.picker = null; return gm && setTable(scene, { hidden: true });
    case "show": return gm && setTable(scene, { hidden: false });
    case "skin-next": return game.settings.set(MODULE_ID, "theme", nextSkin(skinOf()));
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

// ---------- крупный арт рискаря при наведении (автор, 2026-11-14: «как модуль, что выводит арт при наведении на токен») ----------
// Окно вне сцены — не масштабируется вместе со столом; слева от карточки, по высоте — 78% экрана.
let hoverEl = null;
let hoverFor = null;
function hoverBox() {
  if (hoverEl?.isConnected) return hoverEl;
  hoverEl = document.createElement("div");
  hoverEl.id = "ng-job-hover";
  hoverEl.setAttribute("aria-hidden", "true");
  hoverEl.innerHTML = "<img alt=\"\"><span></span>";
  document.body.appendChild(hoverEl);
  return hoverEl;
}
function showArt(card) {
  const src = card.dataset.art;
  if (!src) return;
  const box = hoverBox();
  const H = Math.round(Math.min(window.innerHeight * 0.78, 820));
  const r = card.getBoundingClientRect();
  box.querySelector("img").src = src;
  box.querySelector("span").textContent = card.dataset.artName ?? "";
  box.style.height = `${H}px`;
  box.style.right = `${Math.max(8, Math.round(window.innerWidth - r.left + 16))}px`;
  box.style.top = `${Math.round(Math.min(Math.max(8, r.top + r.height / 2 - H / 2), window.innerHeight - H - 8))}px`;
  box.classList.add("on");
  hoverFor = card;
}
function hideArt() {
  hoverFor = null;
  hoverEl?.classList.remove("on");
}
function onArtOver(event) {
  const card = event.target.closest?.("[data-art]");
  if (card && card !== hoverFor) showArt(card);
}
function onArtOut(event) {
  if (!hoverFor) return;
  if (event.relatedTarget && hoverFor.contains(event.relatedTarget)) return;
  if (event.target.closest?.("[data-art]") === hoverFor) hideArt();
}

// ---------- окно «Кадр» (мастер) — задник или картинка в фото: тянуть мышкой, колесо — ближе ----------
// Задник — как вырез аватарки под кольцо (2026-11-14); фото — так же (автор, 2026-11-15: «картинку внутри фото двигать, как задник»).

let Frame = null;
const frames = new Map();
/** slot 0 — задник сцены, 1…9 — фото на доске. Окно на каждый кадр своё; повторный клик — поднять открытое. */
function openFrame(slot = 0) {
  const open = frames.get(slot);
  if (open?.rendered) return open.bringToFront?.();
  const app = new (frameClass())({ id: `ng-job-frame-${slot || "bg"}`, ngSlot: slot });
  frames.set(slot, app);
  return app.render(true);
}
function frameClass() {
  if (Frame) return Frame;
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  Frame = class NadgradJobFrame extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: ["ng-hall-win"],
      window: { title: "Кадр задника", icon: "fa-solid fa-crop-simple" },
      position: { width: 1000, height: "auto" },
      actions: {
        ngBgCenter: function () { this.view = { ...this.def, y: 0.5 }; this.paint(); },
        ngBgReset: function () { this.view = { ...this.def }; this.paint(); },
        ngBgCancel: function () { this.close(); },
        ngBgSave: async function () {
          const s = canvas?.scene;
          if (isJobScene(s)) {
            const v = readBgView(this.view, this.def);
            await (this.slot ? setSlot(s, this.slot, { view: v }) : setTable(s, { bgView: v }));
          }
          this.close();
        },
      },
    };
    static PARTS = { body: { template: `${TPL}/job-frame.hbs` } };
    view = null;
    get slot() { return Number(this.options.ngSlot) || 0; }
    get def() { return this.slot ? PHOTO_DEFAULT : BG_DEFAULT; }
    get title() {
      if (!this.slot) return "Кадр задника";
      const c = isJobScene(canvas?.scene) ? tableOf(canvas.scene).slots[this.slot - 1]?.caption : "";
      return `Кадр фото ${this.slot}${c ? ` — ${c}` : ""}`;
    }
    _initializeApplicationOptions(options) {
      const o = super._initializeApplicationOptions(options);
      if (Number(options.ngSlot)) o.position = { ...o.position, width: 760 };
      return o;
    }
    async _prepareContext() {
      const s = canvas?.scene;
      if (!isJobScene(s)) return { none: "Это окно — для сцены дела." };
      const t = tableOf(s);
      const base = { zoomMin: BG_ZOOM.min * 100, zoomMax: BG_ZOOM.max * 100 };
      if (this.slot) {
        const data = t.slots[this.slot - 1];
        const pos = layoutOf(t.layout).slots[this.slot - 1];
        if (!data?.img || !pos) return { none: "В этом слоте нет фото — сначала добавь картинку." };
        this.view ??= readPhotoView(data.view);
        return { ...base, src: data.img, photo: photoPreview(pos.w, pos.h), css: bgCss(this.view, PHOTO_DEFAULT), zoomPct: Math.round(this.view.z * 100) };
      }
      this.view ??= readBgView(t.bgView);
      const half = (n) => Math.round(n / 2);
      return {
        ...base,
        src: t.bg || DEFAULTS.bg,
        css: bgCss(this.view),
        zoomPct: Math.round(this.view.z * 100),
        ghosts: boardView(t, { isGM: true }).slots.map((x) => ({ x: half(x.x), y: half(x.y), w: half(x.frame), h: half(x.h + 56), rot: x.rot })),
      };
    }
    paint() {
      const img = this.element?.querySelector(".ng-job-bgcrop-view img");
      if (!img) return;
      const c = bgCss(this.view, this.def);
      Object.assign(img.style, { width: `${c.w}%`, height: `${c.h}%`, left: `${c.left}%`, top: `${c.top}%`, objectPosition: c.pos });
      const z = this.element.querySelector(".ng-job-bgcrop-zoom");
      if (z) z.value = String(Math.round(this.view.z * 100));
    }
    _onClose(options) {
      if (frames.get(this.slot) === this) frames.delete(this.slot);
      return super._onClose?.(options);
    }
    _onRender() {
      const box = this.element.querySelector(".ng-job-bgcrop-view");
      const img = box?.querySelector("img");
      if (!box || !img) return;
      let start = null;
      const size = () => {
        const r = box.getBoundingClientRect();
        return { W: r.width || box.offsetWidth || 1, H: r.height || box.offsetHeight || 1 };
      };
      box.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        start = { x: e.clientX, y: e.clientY, view: { ...this.view } };
        box.setPointerCapture(e.pointerId);
        box.classList.add("drag");
      });
      box.addEventListener("pointermove", (e) => {
        if (!start || !img.naturalWidth) return;
        const { W, H } = size();
        this.view = bgPan(start.view, e.clientX - start.x, e.clientY - start.y, img.naturalWidth, img.naturalHeight, W, H, this.def);
        this.paint();
      });
      const end = () => { start = null; box.classList.remove("drag"); };
      box.addEventListener("pointerup", end);
      box.addEventListener("pointercancel", end);
      box.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.view = bgZoom(this.view, this.view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), this.def);
        this.paint();
      }, { passive: false });
      this.element.querySelector(".ng-job-bgcrop-zoom")?.addEventListener("input", (e) => {
        this.view = bgZoom(this.view, Number(e.target.value) / 100, this.def);
        this.paint();
      });
    }
  };
  return Frame;
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
          await setBackdrop(scene(), target.dataset.src);
          this.render();
        },
        ngPickBg: async function () {
          const path = await pickImage(tableOf(scene()).bg);
          if (path) await setBackdrop(scene(), path);
          this.render();
        },
        ngPick: async function (event, target) {
          const key = target.dataset.key;
          const path = await pickImage(tableOf(scene())[key]);
          if (path) await set(this, { [key]: path });
        },
        ngReset: function (event, target) { return set(this, { [target.dataset.key]: "" }); },
        ngNoSide: function () { return set(this, { side: "none" }); },
        ngOff: function (event, target) { return set(this, { [target.dataset.key]: "none" }); },
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
        ngFrame: function () { openFrame(0); },
        ngHidden: function () { return set(this, { hidden: !tableOf(scene()).hidden }); },
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
        corner: artOf(t, "corner"),
        cornerCustom: !!t.corner && t.corner !== "none",
        cornerOff: t.corner === "none",
        hidden: t.hidden,
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
