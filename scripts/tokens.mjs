// Кольца токенов рискарей (только мастер), с 0.9.0.
// 1) Кольца Надграда (Тушь, Смог) регистрируются во встроенном «динамическом кольце» Foundry —
//    выбираются в настройках ядра «Динамическое кольцо токена». Картинки токенов не меняются.
// 2) Окно «Кольца токенов рискарей»: какое кольцо стоит в мире, вырез объекта под кольцо рискарям игроков.
//    Foundry не обрезает картинку под кольцо — нужен «объект» с прозрачным фоном (ring.subject.texture).
//    Вырез печётся в браузере мастера и загружается в папку мира; перед записью проверяем, что файл открывается.
// 3) Откат 0.8.0: вернуть исходные картинки, которые та версия заменила на незагруженные.
import { MODULE_ID } from "./logic.mjs";
import {
  RINGS, RING_DEFAULT, RING_EFFECTS, ringPath, isNadgradRing, playerRunners, rowContext, restorePlan,
  CUT_OUT, CUT_R, TOKEN_VIEW, ZOOM_MIN, ZOOM_MAX, clampCrop, defaultCrop, zoomBy, drawCutout, cutDir, cutFileName,
  uploadedPath, cutToken, cutPrototype, uncutToken, uncutPrototype,
  SCALE_MIN, SCALE_MAX, clampScale, scaleToken, scalePrototype,
} from "./tokens-logic.mjs";

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
const coreRing = () => { try { return game.settings.get("core", "dynamicTokenRing"); } catch { return ""; } };

function applyTheme(el) {
  const t = get("theme", "auto");
  el.classList.toggle("ng-tush", t === "tush");
  el.classList.toggle("ng-smog", t === "smog");
}

const runners = () => playerRunners(game.actors.contents, game.users.contents);

const FP = () => foundry.applications.apps.FilePicker.implementation;

async function updateTokens(actor, upd) {
  for (const scene of game.scenes) {
    const list = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => ({ _id: t.id, ...upd }));
    if (list.length) await scene.updateEmbeddedDocuments("Token", list);
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Картинка не открылась: ${src}`));
    img.src = src;
  });
}

/** Исходник выреза — основная картинка токена (её модуль не меняет). */
const sourceOf = (actor) => actor.prototypeToken?.texture?.src || actor.img;

async function bakeCutout(img, crop) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = CUT_OUT;
  drawCutout(cv.getContext("2d"), img, CUT_OUT, crop);
  return new Promise((resolve, reject) => {
    try {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("Браузер не сохранил вырез."))), "image/webp", 0.92);
    } catch {
      reject(new Error("Браузер не даёт прочитать эту картинку (она с другого сервера)."));
    }
  });
}

async function ensureDir(dir) {
  try { await FP().browse("data", dir); return; } catch { /* нет такой папки */ }
  try { await FP().createDirectory("data", dir, {}); } catch (e) { throw new Error(`Не удалось создать папку «${dir}»: ${e.message ?? e}`); }
}

/**
 * Испечь вырез, загрузить, убедиться, что он открывается, и только потом записать в кольцо.
 * Основная картинка токена не меняется. Ошибка на любом шаге — ничего не записывается.
 */
export async function applyCutout(actor, img, crop) {
  const blob = await bakeCutout(img, crop);
  const dir = cutDir(game.world.id, get("tokenDir", ""));
  await ensureDir(dir);
  const file = new File([blob], cutFileName(actor.id, Date.now()), { type: "image/webp" });
  let res;
  try { res = await FP().upload("data", dir, file, {}, { notify: false }); } catch (e) { res = null; }
  const path = uploadedPath(res);
  if (!path) throw new Error(`Вырез не загрузился в «${dir}»${res?.message ? `: ${res.message}` : ""}. Токен не тронут.`);
  try { await loadImage(path); } catch { throw new Error(`Вырез загрузился, но не открывается по адресу «${path}». Токен не тронут.`); }
  await actor.update({ ...cutPrototype(path), [`flags.${MODULE_ID}.cut`]: { src: sourceOf(actor), crop: clampCrop(img.width, img.height, crop) } });
  await updateTokens(actor, cutToken(path));
  return path;
}

async function removeCutout(actor) {
  await actor.update(uncutPrototype());
  await updateTokens(actor, uncutToken());
}

const rerenderList = () => { for (const app of foundry.applications.instances.values()) if (app.options?.classes?.includes("ng-tokens-app")) app.render(); };

/** Откат картинок 0.8.0 — у мастера при запуске мира, один раз на актёра (флаг потом снимается). */
async function restoreBroken() {
  const fixed = [];
  for (const actor of game.actors) {
    if (!actor.flags?.[MODULE_ID]?.token) continue;
    const perScene = [];
    for (const scene of game.scenes) {
      const toks = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => ({ id: t.id, texture: { src: t.texture?.src } }));
      const plan = restorePlan(actor, toks);
      if (plan?.tokens.length) perScene.push([scene, plan.tokens]);
    }
    const plan = restorePlan(actor, []);
    if (!plan) continue;
    try {
      for (const [scene, list] of perScene) await scene.updateEmbeddedDocuments("Token", list);
      await actor.update(plan.proto);
      fixed.push(actor.name);
    } catch (e) {
      console.error(`${MODULE_ID} | откат токена ${actor.name}`, e);
    }
  }
  if (fixed.length) ui.notifications.info(`Надград: вернул исходные картинки токенов — ${fixed.join(", ")}.`, { permanent: true });
}

export function makeTokensApp() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  return class TokensApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "nadgrad-tokens",
      classes: ["nadgrad", "ng-tokens-app", "application", "runner-actor"],
      window: { title: "Кольца токенов рискарей", icon: "fa-solid fa-circle-user", resizable: true },
      position: { width: 560, height: 680 },
      actions: { worldRing: TokensApp.#onWorldRing, cut: TokensApp.#onCut, remove: TokensApp.#onRemove, allCut: TokensApp.#onAllCut, scaleAll: TokensApp.#onScaleAll },
    };
    static PARTS = { body: { template: `modules/${MODULE_ID}/templates/tokens.hbs`, scrollable: [""] } };

    _busy = false;

    async _prepareContext() {
      const owners = new Map(game.users.filter((u) => !u.isGM).map((u) => [u.id, u.name]));
      const rows = runners().map((a) => rowContext(a, owners));
      const current = coreRing();
      const labels = CONFIG.Token?.ring?.configLabels ?? {};
      return {
        rows,
        todo: rows.filter((r) => !r.cut).length,
        scale: clampScale(get("tokenScale", 3)) ?? 3,
        scaleMin: SCALE_MIN,
        scaleMax: SCALE_MAX,
        dir: cutDir(game.world.id, get("tokenDir", "")),
        rings: Object.entries(RINGS).map(([id, r]) => ({ id, label: r.label, on: id === current, missing: !(id in labels) })),
        currentLabel: labels[current] ?? current ?? "—",
        isOurs: isNadgradRing(current),
        busy: this._busy,
      };
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      applyTheme(this.element);
    }

    /** Кольцо мира (настройка ядра). Ядро загружает спрайт-лист при запуске — нужна перезагрузка. */
    /** Масштаб на столе — всем рискарям игроков (прототип и токены на всех сценах), без ограничения ползунка ядра. */
    static async #onScaleAll() {
      const input = this.element.querySelector("input.ng-tk-scale");
      const v = clampScale(input?.value);
      if (v === null) return ui.notifications.warn(`Масштаб — число от ${SCALE_MIN} до ${SCALE_MAX}.`);
      await game.settings.set(MODULE_ID, "tokenScale", v);
      let n = 0;
      const failed = [];
      for (const actor of runners()) {
        try {
          await actor.update(scalePrototype(v));
          await updateTokens(actor, scaleToken(v));
          n += 1;
        } catch (e) {
          console.error(e);
          failed.push(actor.name);
        }
      }
      ui.notifications.info(`Масштаб ${v} — у ${n} рискарей (прототип и токены на всех сценах).`);
      if (failed.length) ui.notifications.error(`Не получилось: ${failed.join(", ")}`, { permanent: true });
      this.render();
    }

    static async #onWorldRing(event, target) {
      const id = target.dataset.ring;
      if (!isNadgradRing(id) || coreRing() === id) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Кольцо токенов мира" },
        content: `<p>Поставить «${RINGS[id].label}» кольцом всех токенов с кольцом в мире? Foundry перезагрузится (у всех игроков кольцо сменится после их перезагрузки).</p>`,
      });
      if (!ok) return;
      await game.settings.set("core", "dynamicTokenRing", id);
      foundry.utils.debouncedReload();
    }

    static #onCut(event, target) {
      const actor = game.actors.get(target.dataset.id);
      if (actor) new (cropAppClass())(actor).render({ force: true });
    }

    static async #onRemove(event, target) {
      const actor = game.actors.get(target.dataset.id);
      if (!actor) return;
      await removeCutout(actor);
      this.render();
    }

    /** Всем без выреза: кадр по центру. Ошибка у одного не останавливает остальных. */
    static async #onAllCut() {
      if (this._busy) return;
      const todo = runners().filter((a) => !a.prototypeToken?.ring?.subject?.texture);
      if (!todo.length) return;
      this._busy = true;
      this.render();
      const failed = [];
      let ok = 0;
      for (const actor of todo) {
        try {
          const img = await loadImage(sourceOf(actor));
          await applyCutout(actor, img, defaultCrop(img.width, img.height));
          ok += 1;
        } catch (e) {
          console.error(e);
          failed.push(`${actor.name}: ${e.message}`);
          if (ok === 0 && failed.length === 1) break; // первый же провал — дальше скорее всего то же; не плодим ошибки
        }
      }
      this._busy = false;
      this.render();
      if (ok) ui.notifications.info(`Вырез под кольцо готов: ${ok} из ${todo.length}.`);
      if (failed.length) ui.notifications.error(`Не получилось — ${failed.join("; ")}`, { permanent: true });
    }
  };
}

// ---------- окно кадра ----------

export function makeCropApp() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  return class CropApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: ["nadgrad", "ng-crop-app", "application", "runner-actor"],
      window: { title: "Вырез под кольцо", icon: "fa-solid fa-crop-simple", resizable: false },
      position: { width: 420, height: "auto" },
      actions: { reset: CropApp.#onReset, save: CropApp.#onSave },
    };
    static PARTS = { body: { template: `modules/${MODULE_ID}/templates/token-crop.hbs` } };

    constructor(actor, options = {}) {
      super(options);
      this.actor = actor;
      const f = actor.flags?.[MODULE_ID]?.cut;
      this.crop = f?.src === sourceOf(actor) ? f.crop : null;
      this.img = null;
      this.ring = null;
      this.error = "";
      this.busy = false;
    }

    get title() { return `Вырез под кольцо — ${this.actor.name}`; }

    async _prepareContext() {
      return {
        name: this.actor.name,
        zoomPct: Math.round((this.crop?.zoom ?? 1) * 100),
        zoomMin: ZOOM_MIN * 100,
        zoomMax: ZOOM_MAX * 100,
        error: this.error,
        busy: this.busy,
      };
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      applyTheme(this.element);
      if (!this.img && !this.error) {
        try {
          this.img = await loadImage(sourceOf(this.actor));
          this.crop = this.crop ? clampCrop(this.img.width, this.img.height, this.crop) : defaultCrop(this.img.width, this.img.height);
        } catch (e) {
          this.error = e.message;
          return this.render();
        }
        this.ring = await ringPreview();
      }
      this.#wire();
      this.#draw();
    }

    #canvas() { return this.element.querySelector("canvas.ng-crop-view"); }

    /** Вырез + кольцо мира поверх (если это кольцо Надграда) — как будет на столе. */
    #draw() {
      const cv = this.#canvas();
      if (!cv || !this.img) return;
      const ctx = cv.getContext("2d");
      drawCutout(ctx, this.img, cv.width, this.crop);
      if (this.ring) {
        const r = this.ring;
        ctx.drawImage(r.img, r.x, 0, r.w, r.w, 0, 0, cv.width, cv.width);
        // светлую полосу Foundry красит «цветом кольца» — в предпросмотре рисуем её этим цветом
        if (r.color && r.band) {
          const c = cv.width / 2;
          ctx.beginPath();
          ctx.arc(c, c, c * (r.band.startRadius + r.band.endRadius) / 2, 0, Math.PI * 2);
          ctx.lineWidth = c * (r.band.endRadius - r.band.startRadius) + 1;
          ctx.strokeStyle = r.color;
          ctx.stroke();
        }
      }
      const z = this.element.querySelector("input.ng-crop-zoom");
      if (z) z.value = String(Math.round(this.crop.zoom * 100));
    }

    #wire() {
      const cv = this.#canvas();
      if (!cv || cv.dataset.wired) return;
      cv.dataset.wired = "1";
      let start = null;
      // экранные px → px окна кадра: окно кадра — это круг выреза
      const k = () => TOKEN_VIEW / (cv.getBoundingClientRect().width * CUT_R);
      cv.addEventListener("pointerdown", (e) => {
        if (!this.img) return;
        start = { x: e.clientX, y: e.clientY, crop: { ...this.crop } };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener("pointermove", (e) => {
        if (!start) return;
        const f = k();
        this.crop = clampCrop(this.img.width, this.img.height, {
          zoom: start.crop.zoom, x: start.crop.x + (e.clientX - start.x) * f, y: start.crop.y + (e.clientY - start.y) * f,
        });
        this.#draw();
      });
      const end = () => { start = null; };
      cv.addEventListener("pointerup", end);
      cv.addEventListener("pointercancel", end);
      cv.addEventListener("wheel", (e) => {
        if (!this.img) return;
        e.preventDefault();
        this.crop = zoomBy(this.img.width, this.img.height, this.crop, e.deltaY < 0 ? 1.1 : 1 / 1.1);
        this.#draw();
      }, { passive: false });
      this.element.querySelector("input.ng-crop-zoom")?.addEventListener("input", (e) => {
        if (!this.img) return;
        this.crop = zoomBy(this.img.width, this.img.height, this.crop, Number(e.target.value) / 100 / this.crop.zoom);
        this.#draw();
      });
    }

    static #onReset() {
      if (!this.img) return;
      this.crop = defaultCrop(this.img.width, this.img.height);
      this.#draw();
    }

    static async #onSave() {
      if (!this.img || this.busy) return;
      this.busy = true;
      try {
        await applyCutout(this.actor, this.img, this.crop);
        ui.notifications.info(`«${this.actor.name}»: вырез под кольцо на всех сценах.`);
        rerenderList();
        this.close();
      } catch (e) {
        console.error(e);
        ui.notifications.error(e.message, { permanent: true });
      } finally {
        this.busy = false;
      }
    }
  };
}

/** Кадр кольца мира для предпросмотра (средний размер из спрайт-листа Надграда). */
async function ringPreview() {
  const id = coreRing();
  if (!isNadgradRing(id)) return null;
  try {
    const sheet = await (await fetch(ringPath(MODULE_ID, id))).json();
    const f = sheet.frames["med-ring"].frame;
    const img = await loadImage(`modules/${MODULE_ID}/art/rings/${sheet.meta.image}`);
    return { img, x: f.x, w: f.w, color: sheet.config?.defaultRingColor, band: sheet.config?.defaultColorBand };
  } catch { return null; }
}

let Crop = null;
export const cropAppClass = () => (Crop ??= makeCropApp());

let List = null;
export const tokensAppClass = () => (List ??= makeTokensApp());

export function openTokens() {
  if (!game.user?.isGM) return ui.notifications.warn("Кольца токенов настраивает мастер.");
  return new (tokensAppClass())().render({ force: true });
}

export function registerTokens() {
  // Кольца Надграда — в список «Динамическое кольцо токена» в настройках ядра.
  Hooks.on("initializeDynamicTokenRingConfig", (ringConfig) => {
    const Data = foundry.canvas?.placeables?.tokens?.DynamicRingData ?? foundry.canvas?.tokens?.DynamicRingData;
    if (!Data) return console.warn(`${MODULE_ID} | DynamicRingData не найден — кольца Надграда не подключены`);
    for (const [id, r] of Object.entries(RINGS)) {
      ringConfig.addConfig(id, new Data({ label: r.label, effects: RING_EFFECTS, spritesheet: ringPath(MODULE_ID, id) }));
    }
  });

  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "tokenScale", {
      name: "Масштаб токенов рискарей",
      hint: "Последний масштаб, применённый в окне «Кольца токенов рискарей» (ползунок Foundry доходит только до 3).",
      scope: "world", config: false, type: Number, default: 3,
    });
    game.settings.register(MODULE_ID, "tokenDir", {
      name: "Папка для вырезов под кольцо",
      hint: "Путь в данных Foundry. Пусто — worlds/<мир>/nadgrad-tokens.",
      scope: "world", config: true, type: String, default: "",
    });
    game.settings.registerMenu(MODULE_ID, "tokensMenu", {
      name: "Кольца токенов рискарей",
      label: "Открыть",
      hint: `Кольца Надграда во встроенном «динамическом кольце» Foundry: кольцо мира (по умолчанию — ${RINGS[RING_DEFAULT].label}) и круглый вырез картинки под кольцо для рискарей игроков.`,
      icon: "fa-solid fa-circle-user",
      type: tokensAppClass(),
      restricted: true,
    });
  });

  Hooks.once("ready", () => {
    if (game.user?.isGM) restoreBroken();
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    const tool = {
      name: "nadgradTokens",
      title: "Кольца токенов рискарей",
      icon: "fa-solid fa-circle-user",
      button: true,
      order: 51,
      visible: true,
      onChange: () => openTokens(),
    };
    const tokens = Array.isArray(controls) ? controls.find((c) => c.name === "token" || c.name === "tokens") : controls.tokens;
    if (!tokens) return;
    if (Array.isArray(tokens.tools)) tokens.tools.push({ ...tool, onClick: tool.onChange });
    else tokens.tools.nadgradTokens = tool;
  });
}
