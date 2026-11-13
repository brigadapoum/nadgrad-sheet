// Холл кампании в Foundry: сцена с отметкой модуля + HTML-слой по макету «Д · Гибрид 2».
// Данные: дела — записи журнала в папке «Доска дел» (флаг nadgrad.job), наполняются из data/jobs.json
// (таблица Notion, присылает автор); рискари — актёры-рискари со статусом в кампании (флаг nadgrad.campaign,
// иначе — база PC из data/roster.json); новости и Заслон — настройки мира.
import { MODULE_ID, readState } from "./logic.mjs";
import { effectiveTheme } from "./dom.mjs";
import {
  STAGE, JOBS_PAGE, RUNNERS_PAGE, JOB_FOLDER, readJob, jobView, boardJobs, page, ring, turn, syncPlan,
  CAMPAIGN, campaignStatus, runnerViews, countBy, fitStage, ZASLON, zaslonOf, newsViews,
} from "./hall-logic.mjs";

const ART = `modules/${MODULE_ID}/art/hall`;
const TPL = `modules/${MODULE_ID}/templates`;
const RUNNER_TYPE = "runner";
const DEFAULT_IMG = /mystery-man|icons\/svg\//;

// фото по правому краю карты — как на макете (рамка = картинка + 16)
const PHOTOS = [
  { file: "photo-dropships.webp", alt: "Десантные дроны над городом ночью", w: 250, h: 141, right: 46, top: 96, rot: -4, tape: 3 },
  { file: "photo-chain-war.webp", alt: "Рискари в машине на фоне горящей Цепи-2", w: 150, h: 212, right: 176, top: 262, rot: 3, tape: -4 },
  { file: "photo-tower.webp", alt: "Башня-муравейник над рынком", w: 100, h: 240, right: 40, top: 282, rot: -2.5, tape: 5 },
  { file: "photo-station.webp", alt: "Орбитальная станция над пустошью", w: 220, h: 154, right: 80, top: 540, rot: 4, tape: -2 },
].map((p) => ({ ...p, frame: p.w + 16 }));

const SKINS = [
  { id: "tush", label: "Тушь" },
  { id: "smog", label: "Смог" },
  { id: "acid", label: "Кислота" },
  { id: "classic", label: "Классика" },
];
/** Скин холла — тот же, что у листа (клиентская настройка nadgrad.theme). */
const skinOf = () => effectiveTheme(document.body, setting("theme", "auto"));

let data = { jobs: null, news: null, roster: null };
const view = { jobs: 0, runners: 0 };
let root = null;
let timer = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setting = (k, fb) => { try { return game.settings.get(MODULE_ID, k); } catch { return fb; } };
const isHall = (scene) => !!scene?.getFlag?.(MODULE_ID, "hall");
const hallScene = () => game.scenes?.find((s) => isHall(s)) ?? null;

async function loadData() {
  const get = async (f) => {
    try { return await foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute(`modules/${MODULE_ID}/data/${f}`)); }
    catch (err) { console.warn(`${MODULE_ID} | не прочитан data/${f}`, err); return null; }
  };
  [data.jobs, data.news, data.roster] = await Promise.all([get("jobs.json"), get("news.json"), get("roster.json")]);
}

/** База рискарей из Notion (запасной статус в кампании). */
export const rosterList = () => data.roster?.roster ?? [];

// ---------- дела ----------

const canSee = (doc) => game.user.isGM || doc.testUserPermission(game.user, "LIMITED");
const jobEntries = () => (game.journal?.contents ?? []).filter((j) => j.getFlag(MODULE_ID, "job"));

async function jobFolder() {
  let f = game.folders.find((x) => x.type === "JournalEntry" && x.name === JOB_FOLDER);
  if (!f) f = await Folder.create({ name: JOB_FOLDER, type: "JournalEntry", color: "#E0763A" });
  return f;
}

function jobPageText(job, html) {
  const v = jobView(job);
  const chips = v.unknown ? "неизвестно" : job.obstacles.join(", ");
  return `<p><strong>Заказчик:</strong> ${esc(job.client)} · <strong>Место:</strong> ${esc(job.place)}</p>`
    + `<p><strong>Награда:</strong> ${esc(v.reward)} · <strong>Препятствия:</strong> ${esc(chips)}${job.fixerRank != null ? ` · <strong>Ранг фиксера:</strong> ${job.fixerRank}` : ""}</p>`
    + (html || "");
}

/** Обновить доску из data/jobs.json. Только мастер. */
export async function syncJobs({ quiet = false } = {}) {
  if (!game.user.isGM || !data.jobs?.jobs) return null;
  const world = jobEntries().map((j) => ({ id: j.id, job: j.getFlag(MODULE_ID, "job") }));
  const plan = syncPlan(world, data.jobs.jobs);
  const folder = await jobFolder();
  const byKey = new Map(data.jobs.jobs.map((j) => [j.key, j]));
  const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  if (plan.create.length) {
    await JournalEntry.createDocuments(plan.create.map((job) => ({
      name: job.name,
      folder: folder.id,
      ownership: { default: OBS },
      flags: { [MODULE_ID]: { job } },
      pages: [{ name: job.name, type: "text", text: { content: jobPageText(job, byKey.get(job.key)?.html) } }],
    })));
  }
  for (const u of plan.update) {
    const entry = game.journal.get(u.id);
    if (!entry) continue;
    await entry.update({ ...(u.rename ? { name: u.job.name } : {}), [`flags.${MODULE_ID}.job`]: u.job });
  }
  for (const id of plan.close) await game.journal.get(id)?.setFlag(MODULE_ID, "job.status", "closed");
  await game.settings.set(MODULE_ID, "hallJobsVersion", data.jobs.version ?? "");
  if (!quiet || plan.create.length || plan.update.length || plan.close.length) {
    ui.notifications.info(`Доска дел: новых ${plan.create.length}, обновлено ${plan.update.length}, ушло в архив ${plan.close.length}.`);
  }
  return plan;
}

async function setJobStatus(id, status) {
  const entry = game.journal.get(id);
  if (!entry || !game.user.isGM) return;
  await entry.setFlag(MODULE_ID, "job.status", status);
}

// ---------- рискари ----------

function runnerRows() {
  const roster = rosterList();
  return (game.actors?.contents ?? [])
    .filter((a) => a.type === RUNNER_TYPE)
    .map((a) => {
      const flags = a.flags?.[MODULE_ID];
      const status = campaignStatus(a.name, flags?.campaign, roster);
      let rank = null, dela = 0;
      try { const st = readState(flags); rank = st.rep.rank; dela = Number(st.dela) || 0; } catch { rank = null; }
      return { id: a.id, name: a.name, status, rank, dela, img: a.img && !DEFAULT_IMG.test(a.img) ? a.img : "" };
    });
}

function openActor(id) {
  const a = game.actors.get(id);
  if (!a) return;
  if (!a.testUserPermission(game.user, "LIMITED")) return ui.notifications.warn(`Лист рискаря «${a.name}» тебе не открыт.`);
  a.sheet.render(true);
}

// ---------- слой ----------

function freeArea() {
  const W = window.innerWidth, H = window.innerHeight;
  const area = { left: 0, top: 0, right: W, bottom: H };
  const r = (sel) => { const el = document.querySelector(sel); if (!el || el.offsetParent === null && getComputedStyle(el).position !== "fixed") return null; const b = el.getBoundingClientRect(); return b.width && b.height ? b : null; };
  const left = r("#ui-left") ?? r("#controls");
  if (left && left.right < W * 0.4) area.left = left.right;
  const right = r("#sidebar") ?? r("#ui-right");
  if (right && right.left > W * 0.6) area.right = right.left;
  const hotbar = r("#hotbar");
  if (hotbar && hotbar.top > H * 0.6) area.bottom = hotbar.top;
  const nav = r("#navigation") ?? r("#scene-navigation");
  if (nav && nav.bottom < H * 0.3 && nav.left < W / 2 && nav.right > area.left + 40 && nav.width > W * 0.3) area.top = nav.bottom;
  const pad = 8;
  return { left: area.left + pad, top: area.top + pad, right: area.right - pad, bottom: area.bottom - pad };
}

function mount() {
  if (root?.isConnected) return root;
  root = document.createElement("div");
  root.id = "ng-hall";
  root.setAttribute("aria-label", "Холл кампании");
  const ui = document.getElementById("interface");
  const board = document.getElementById("board");
  const zi = parseInt(ui ? getComputedStyle(ui).zIndex : "", 10);
  const zb = parseInt(board ? getComputedStyle(board).zIndex : "", 10);
  root.style.zIndex = String(Number.isFinite(zi) ? zi : (Number.isFinite(zb) ? zb : 0) + 1);
  if (ui?.parentElement) ui.parentElement.insertBefore(root, ui);
  else document.body.appendChild(root);
  root.addEventListener("click", onClick);
  root.addEventListener("wheel", onWheel, { passive: false });
  return root;
}

function unmount() {
  root?.remove();
  root = null;
}

function jobsContext() {
  const all = boardJobs(jobEntries().filter(canSee).map((j) => ({ id: j.id, job: j.getFlag(MODULE_ID, "job") })));
  const jp = page(all, view.jobs, JOBS_PAGE);
  view.jobs = jp.offset;
  return { isGM: game.user.isGM, jobs: { ...jp, items: jp.items.map((x) => jobView(x.job, { id: x.id })) } };
}
function stripContext() {
  const r = ring(runnerViews(runnerRows(), "active"), view.runners, RUNNERS_PAGE);
  view.runners = r.offset;
  return { runners: r };
}
const tpl = (name, ctx) => foundry.applications.handlebars.renderTemplate(`${TPL}/${name}`, ctx);

async function render() {
  if (!isHall(canvas?.scene)) return unmount();
  const el = mount();
  const skin = skinOf();
  for (const s of SKINS) el.classList.toggle(`skin-${s.id}`, s.id === skin);
  const news = newsViews(setting("hallNews", []));
  const ctx = {
    art: ART,
    layout: fitStage(freeArea(), STAGE),
    isGM: game.user.isGM,
    skins: SKINS.map((x) => ({ ...x, on: x.id === skin })),
    zaslon: zaslonOf(setting("hallZaslon", "closed")),
    photos: PHOTOS,
    boardHtml: await tpl("hall-board.hbs", jobsContext()),
    stripHtml: await tpl("hall-strip.hbs", stripContext()),
    news,
    newsLoop: [...news, ...news],
    tickerSeconds: Math.max(30, Math.round(news.reduce((n, x) => n + x.text.length, 0) / 7)),
  };
  el.innerHTML = await tpl("hall.hbs", ctx);
}

/** Перерисовать только доску или только ленту — без мигания карты и фото. */
async function renderPart(which) {
  const old = root?.querySelector(which === "board" ? ".ng-hall-board" : ".ng-hall-strip");
  if (!old) return render();
  const html = which === "board" ? await tpl("hall-board.hbs", jobsContext()) : await tpl("hall-strip.hbs", stripContext());
  const box = document.createElement("div");
  box.innerHTML = html.trim();
  old.replaceWith(box.firstElementChild);
}

/** Перерисовка с задержкой: пачка обновлений документов — одна отрисовка. */
export function refresh() {
  clearTimeout(timer);
  timer = setTimeout(() => render().catch((err) => console.error(`${MODULE_ID} | холл`, err)), 60);
}

function relayout() {
  const stage = root?.querySelector(".ng-hall-stage");
  if (!stage) return;
  const l = fitStage(freeArea(), STAGE);
  stage.style.transform = `scale(${l.scale})`;
  stage.style.left = `${l.left}px`;
  stage.style.top = `${l.top}px`;
}

// Колесо над доской — листать дела по одному (автор, 2026-11-13). Остальное колесо — холлу не нужно,
// но и Foundry его не получает: на холле полотно не зумится.
let wheelAcc = 0;
let wheelBusy = false;
async function onWheel(event) {
  if (!event.target.closest(".ng-hall-stage")) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.target.closest(".ng-hall-board")) return;
  wheelAcc += event.deltaY;
  if (wheelBusy || Math.abs(wheelAcc) < 40) return;
  const dir = Math.sign(wheelAcc);
  wheelAcc = 0;
  const n = jobEntries().filter((j) => canSee(j) && readJob(j.getFlag(MODULE_ID, "job")).status !== "closed").length;
  const next = Math.min(Math.max(0, view.jobs + dir), Math.max(0, n - JOBS_PAGE));
  if (next === view.jobs) return;
  view.jobs = next;
  wheelBusy = true;
  try { await renderPart("board"); } finally { wheelBusy = false; }
}

async function onClick(event) {
  const btn = event.target.closest("[data-hall]");
  if (!btn) return;
  event.preventDefault();
  const id = btn.dataset.id;
  switch (btn.dataset.hall) {
    case "job": return game.journal.get(id)?.sheet.render(true);
    case "close": {
      const name = game.journal.get(id)?.name ?? "";
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Закрыть дело" },
        content: `<p>Убрать «${esc(name)}» из доступных? Запись журнала останется, вернуть можно в настройках холла.</p>`,
      });
      if (ok) await setJobStatus(id, "closed");
      return;
    }
    case "jobs-prev": case "jobs-next": {
      const n = jobEntries().filter((j) => canSee(j) && readJob(j.getFlag(MODULE_ID, "job")).status !== "closed").length;
      view.jobs = turn(view.jobs, btn.dataset.hall === "jobs-next" ? 1 : -1, JOBS_PAGE, n);
      return renderPart("board");
    }
    case "runners-prev": case "runners-next": {
      view.runners += btn.dataset.hall === "runners-next" ? 1 : -1;
      return renderPart("strip");
    }
    case "skin": return game.settings.set(MODULE_ID, "theme", btn.dataset.id);
    case "runner": return openActor(id);
    case "gallery": return new (galleryClass())().render(true);
    case "admin": return new (adminClass())().render(true);
  }
}

// ---------- галерея ----------

let Gallery = null;
function galleryClass() {
  if (Gallery) return Gallery;
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  Gallery = class NadgradHallGallery extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "ng-hall-gallery",
      classes: ["ng-hall-win"],
      window: { title: "Рискари", icon: "fa-solid fa-users", resizable: true },
      position: { width: 1000, height: 720 },
      actions: {
        ngFilter: function (event, target) { this._filter = target.dataset.filter; this.render(); },
        ngOpen: function (event, target) { openActor(target.dataset.id); },
      },
    };
    static PARTS = { body: { template: `${TPL}/hall-gallery.hbs`, scrollable: [".ng-hall-gallery-grid"] } };
    _filter = "active";
    async _prepareContext() {
      const rows = runnerRows();
      const c = countBy(rows);
      const label = Object.fromEntries(CAMPAIGN.map((x) => [x.id, x.label]));
      return {
        filters: [
          { id: "active", label: "Действующие", count: c.active },
          { id: "waiting", label: "Ждут", count: c.waiting },
          { id: "dead", label: "Погибшие", count: c.dead },
          { id: "all", label: "Все", count: c.all },
        ].map((f) => ({ ...f, on: f.id === this._filter })),
        runners: runnerViews(rows, this._filter).map((r) => ({ ...r, statusLabel: label[r.status] ?? "" })),
      };
    }
  };
  return Gallery;
}

// ---------- окно мастера ----------

let Admin = null;
function adminClass() {
  if (Admin) return Admin;
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  Admin = class NadgradHallAdmin extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "ng-hall-admin",
      classes: ["ng-hall-win"],
      window: { title: "Холл кампании", icon: "fa-solid fa-map" },
      position: { width: 560, height: "auto" },
      actions: {
        ngCreate: async function () { await createHall(); this.render(); },
        ngView: function () { hallScene()?.view(); },
        ngActivate: async function () { await hallScene()?.activate(); this.render(); },
        ngZaslon: async function (event, target) { await game.settings.set(MODULE_ID, "hallZaslon", target.dataset.id); this.render(); },
        ngNewsSave: async function () {
          const text = this.element.querySelector("textarea[name=news]")?.value ?? "";
          await game.settings.set(MODULE_ID, "hallNews", text.split("\n").map((s) => s.trim()).filter(Boolean));
          ui.notifications.info("Новости холла сохранены.");
        },
        ngNewsReset: async function () {
          await game.settings.set(MODULE_ID, "hallNews", (data.news?.news ?? []).map((n) => n.text));
          this.render();
        },
        ngSync: async function () { await syncJobs(); this.render(); },
        ngReopen: async function (event, target) { await setJobStatus(target.dataset.id, "open"); this.render(); },
      },
    };
    static PARTS = { body: { template: `${TPL}/hall-admin.hbs` } };
    async _prepareContext() {
      const s = hallScene();
      const z = setting("hallZaslon", "closed");
      const entries = jobEntries().map((j) => ({ id: j.id, name: j.name, job: readJob(j.getFlag(MODULE_ID, "job")) }));
      return {
        scene: s ? { name: s.name, active: s.active } : null,
        zaslon: ZASLON.map((x) => ({ id: x.id, label: x.id === "none" ? "Не показывать" : x.label.replace("Заслон: ", ""), on: x.id === z })),
        newsText: (setting("hallNews", []) ?? []).join("\n"),
        newsDataVersion: data.news?.version ?? "—",
        jobsOpen: entries.filter((e) => e.job.status !== "closed").length,
        jobsClosed: entries.filter((e) => e.job.status === "closed").length,
        jobsDataVersion: data.jobs?.version ?? "—",
        jobsSynced: setting("hallJobsVersion", "") === (data.jobs?.version ?? ""),
        closed: entries.filter((e) => e.job.status === "closed").map((e) => ({ id: e.id, name: e.name })),
      };
    }
  };
  return Admin;
}

/** Сцена-холл: карта фоном (на случай, если слой выключен), без сетки и тумана; сразу стартовая. */
export async function createHall() {
  if (!game.user.isGM) return null;
  let scene = hallScene();
  if (!scene) {
    scene = await Scene.create({
      name: "Холл",
      navName: "Холл",
      navigation: true,
      width: 1920, height: 1080, padding: 0,
      backgroundColor: "#14120F",
      background: { src: `${ART}/map.webp` },
      grid: { type: CONST.GRID_TYPES.GRIDLESS },
      tokenVision: false,
      fog: { exploration: false },
      flags: { [MODULE_ID]: { hall: true } },
    });
  }
  await syncJobs({ quiet: true });
  if (!(setting("hallNews", []) ?? []).length && data.news?.news) {
    await game.settings.set(MODULE_ID, "hallNews", data.news.news.map((n) => n.text));
  }
  await scene.activate();
  ui.notifications.info("Холл кампании готов и стал стартовой сценой.");
  return scene;
}

// ---------- регистрация ----------

export function registerHall() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "hallNews", { scope: "world", config: false, type: Array, default: [], onChange: refresh });
    game.settings.register(MODULE_ID, "hallZaslon", { scope: "world", config: false, type: String, default: "closed", onChange: refresh });
    game.settings.register(MODULE_ID, "hallJobsVersion", { scope: "world", config: false, type: String, default: "" });
    game.settings.register(MODULE_ID, "hallOffered", { scope: "world", config: false, type: Boolean, default: false });
    game.settings.registerMenu(MODULE_ID, "hallMenu", {
      name: "Холл кампании",
      label: "Открыть холл",
      hint: "Стартовая сцена с картой, доской дел, рискарями и новостями. Здесь — создать сцену, Заслон, новости, обновить доску из таблицы Notion.",
      icon: "fa-solid fa-map",
      type: adminClass(),
      restricted: true,
    });
  });

  Hooks.once("ready", async () => {
    if (game.system?.id !== "CBRPNK") return;
    await loadData();
    if (game.user.isGM) {
      const known = setting("hallJobsVersion", "");
      if (hallScene() && data.jobs?.version && known !== data.jobs.version) await syncJobs({ quiet: false });
      if (!hallScene() && !setting("hallOffered", false)) {
        await game.settings.set(MODULE_ID, "hallOffered", true);
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Надград: холл кампании" },
          content: "<p>Создать сцену-холл — карта Надграда, доска дел, рискари, новости — и сделать её стартовой?</p><p>Потом это есть в настройках модуля: «Холл кампании».</p>",
        });
        if (ok) await createHall();
      }
    }
    refresh();
  });

  Hooks.on("canvasReady", refresh);
  Hooks.on("updateScene", (scene, change) => { if (scene.id === canvas?.scene?.id || foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) refresh(); });
  for (const h of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry", "createActor", "updateActor", "deleteActor"]) {
    Hooks.on(h, () => { if (root) refresh(); });
  }
  Hooks.on("collapseSidebar", () => setTimeout(relayout, 250));
  Hooks.on("renderSceneNavigation", () => setTimeout(relayout, 50));
  window.addEventListener("resize", () => relayout());
}
