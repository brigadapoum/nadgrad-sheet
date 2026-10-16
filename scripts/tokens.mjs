// Токены рискарей на столе (только мастер): кадр в круге + рамка Надграда, одна картинка на токен.
// Картинка печётся в браузере мастера (canvas → webp), загружается в папку мира и ставится
// в прототип токена и во все токены этого рискаря на всех сценах. Лист персонажа не трогается.
import { MODULE_ID } from "./logic.mjs";
import {
  TOKEN_OUT, TOKEN_VIEW, ZOOM_MIN, ZOOM_MAX, FRAMES, frameId, defaultCrop, clampCrop, zoomBy,
  playerRunners, originalSrc, tokenUpdate, prototypeUpdate, rowContext, drawToken, tokenFileName, tokenDirFor,
} from "./tokens-logic.mjs";

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
const FP = () => foundry.applications.apps.FilePicker.implementation;

function applyTheme(el) {
  const t = get("theme", "auto");
  el.classList.toggle("ng-tush", t === "tush");
  el.classList.toggle("ng-smog", t === "smog");
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Картинка не загрузилась: ${src}`));
    img.src = src;
  });
}

async function bake(img, frame, crop) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = TOKEN_OUT;
  drawToken(cv.getContext("2d"), img, TOKEN_OUT, frame, crop);
  return new Promise((resolve, reject) => {
    try {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("Браузер не сохранил картинку."))), "image/webp", 0.92);
    } catch (e) {
      // SecurityError: картинка с другого сервера без разрешения на чтение
      reject(new Error("Браузер не даёт прочитать эту картинку (она с другого сервера). Загрузи её в мир и поставь на токен, потом повтори."));
    }
  });
}

async function ensureDir(dir) {
  try { await FP().browse("data", dir); return; } catch { /* папки нет */ }
  await FP().createDirectory("data", dir, {});
}

/** Испечь, загрузить и раздать токену рискаря. Возвращает путь готовой картинки. */
export async function applyToken(actor, img, { frame, crop }) {
  const src = originalSrc(actor);
  const blob = await bake(img, frame, crop);
  const dir = tokenDirFor(src, game.world.id, get("tokenDir", ""));
  await ensureDir(dir);
  const file = new File([blob], tokenFileName(actor.id, Date.now()), { type: "image/webp" });
  const res = await FP().upload("data", dir, file, {}, { notify: false });
  const out = res?.path;
  if (!out) throw new Error(`Не удалось загрузить картинку в «${dir}». Проверь папку в настройках модуля.`);
  const scale = get("tokenScale", 3);
  await actor.update({
    ...prototypeUpdate(out, scale),
    [`flags.${MODULE_ID}.token`]: { src, out, frame: frameId(frame), crop: clampCrop(img.width, img.height, crop) },
  });
  await updateSceneTokens(actor, out, scale);
  return out;
}

async function updateSceneTokens(actor, src, scale) {
  const upd = tokenUpdate(src, scale);
  for (const scene of game.scenes) {
    const list = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => ({ _id: t.id, ...upd }));
    if (list.length) await scene.updateEmbeddedDocuments("Token", list);
  }
}

const runners = () => playerRunners(game.actors.contents, game.users.contents);
const rerenderList = () => { for (const app of foundry.applications.instances.values()) if (app.options?.classes?.includes("ng-tokens-app")) app.render(); };

// ---------- окно кадра ----------

export function makeCropApp() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  return class CropApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: ["nadgrad", "ng-crop-app", "application", "runner-actor"],
      window: { title: "Кадр токена", icon: "fa-solid fa-crop-simple", resizable: false },
      position: { width: 420, height: "auto" },
      actions: { frame: CropApp.#onFrame, reset: CropApp.#onReset, save: CropApp.#onSave },
    };
    static PARTS = { body: { template: `modules/${MODULE_ID}/templates/token-crop.hbs` } };

    constructor(actor, options = {}) {
      super(options);
      this.actor = actor;
      const f = actor.flags?.[MODULE_ID]?.token;
      this.frame = frameId(f?.frame ?? get("tokenFrame", "tush"));
      this.crop = f?.crop ?? null;
      this.img = null;
      this.error = "";
      this.busy = false;
    }

    get title() { return `Кадр токена — ${this.actor.name}`; }

    async _prepareContext() {
      return {
        name: this.actor.name,
        frames: Object.entries(FRAMES).map(([id, f]) => ({ id, label: f.label, on: id === this.frame })),
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
          this.img = await loadImage(originalSrc(this.actor));
          this.crop = this.crop ? clampCrop(this.img.width, this.img.height, this.crop) : defaultCrop(this.img.width, this.img.height);
        } catch (e) {
          this.error = e.message;
          return this.render();
        }
      }
      this.#wire();
      this.#draw();
    }

    #canvas() { return this.element.querySelector("canvas.ng-crop-view"); }

    #draw() {
      const cv = this.#canvas();
      if (!cv || !this.img) return;
      drawToken(cv.getContext("2d"), this.img, cv.width, this.frame, this.crop);
      const z = this.element.querySelector("input.ng-crop-zoom");
      if (z) z.value = String(Math.round(this.crop.zoom * 100));
    }

    #wire() {
      const cv = this.#canvas();
      if (!cv || cv.dataset.wired) return;
      cv.dataset.wired = "1";
      let start = null;
      // экранные px → px окна кадра: окно кадра занимает внутренний круг рамки
      const k = () => TOKEN_VIEW / (cv.getBoundingClientRect().width * 0.96 * FRAMES[this.frame].inner);
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
        const target = Number(e.target.value) / 100;
        this.crop = zoomBy(this.img.width, this.img.height, this.crop, target / this.crop.zoom);
        this.#draw();
      });
    }

    static #onFrame(event, target) {
      this.frame = frameId(target.dataset.frame);
      this.render();
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
        await applyToken(this.actor, this.img, { frame: this.frame, crop: this.crop });
        ui.notifications.info(`Токен «${this.actor.name}» обновлён на всех сценах.`);
        rerenderList();
        this.close();
      } catch (e) {
        console.error(e);
        ui.notifications.error(e.message);
      } finally {
        this.busy = false;
      }
    }
  };
}

// ---------- список рискарей ----------

export function makeTokensApp() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  return class TokensApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "nadgrad-tokens",
      classes: ["nadgrad", "ng-tokens-app", "application", "runner-actor"],
      window: { title: "Токены рискарей", icon: "fa-solid fa-circle-user", resizable: true },
      position: { width: 560, height: 680 },
      actions: { crop: TokensApp.#onCrop, defFrame: TokensApp.#onDefFrame, batch: TokensApp.#onBatch, rescale: TokensApp.#onRescale },
    };
    static PARTS = { body: { template: `modules/${MODULE_ID}/templates/tokens.hbs`, scrollable: [""] } };

    _busy = false;

    async _prepareContext() {
      const owners = new Map(game.users.filter((u) => !u.isGM).map((u) => [u.id, u.name]));
      const rows = runners().map((a) => rowContext(a, owners));
      const def = frameId(get("tokenFrame", "tush"));
      return {
        rows,
        todo: rows.filter((r) => !r.done).length,
        frames: Object.entries(FRAMES).map(([id, f]) => ({ id, label: f.label, on: id === def })),
        scale: get("tokenScale", 3),
        busy: this._busy,
      };
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      applyTheme(this.element);
      this.element.querySelector("input.ng-tk-scale")?.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        if (!(v > 0)) return;
        await game.settings.set(MODULE_ID, "tokenScale", v);
      });
    }

    static #onCrop(event, target) {
      const actor = game.actors.get(target.dataset.id);
      if (actor) new (cropAppClass())(actor).render({ force: true });
    }

    static async #onDefFrame(event, target) {
      await game.settings.set(MODULE_ID, "tokenFrame", frameId(target.dataset.frame));
      this.render();
    }

    /** Все, кого ещё не обрабатывали: кадр по центру, рамка по умолчанию. */
    static async #onBatch() {
      if (this._busy) return;
      const todo = runners().filter((a) => !rowContext(a, new Map()).done);
      if (!todo.length) return;
      this._busy = true;
      this.render();
      const frame = frameId(get("tokenFrame", "tush"));
      const failed = [];
      let ok = 0;
      for (const actor of todo) {
        try {
          const img = await loadImage(originalSrc(actor));
          await applyToken(actor, img, { frame, crop: defaultCrop(img.width, img.height) });
          ok += 1;
        } catch (e) {
          console.error(e);
          failed.push(`${actor.name}: ${e.message}`);
        }
      }
      this._busy = false;
      this.render();
      ui.notifications.info(`Токены готовы: ${ok} из ${todo.length}.`);
      if (failed.length) ui.notifications.error(`Не получилось: ${failed.join("; ")}`, { permanent: true });
    }

    /** Новый масштаб — всем обработанным, без перепечатки картинок. */
    static async #onRescale() {
      const scale = get("tokenScale", 3);
      let n = 0;
      for (const actor of runners()) {
        const f = actor.flags?.[MODULE_ID]?.token;
        if (!f?.out || f.out !== actor.prototypeToken?.texture?.src) continue;
        await actor.update(prototypeUpdate(f.out, scale));
        await updateSceneTokens(actor, f.out, scale);
        n += 1;
      }
      ui.notifications.info(`Масштаб ${scale} — у ${n} токенов.`);
    }
  };
}

let Crop = null;
let List = null;
export const cropAppClass = () => (Crop ??= makeCropApp());
export const tokensAppClass = () => (List ??= makeTokensApp());

export function openTokens() {
  if (!game.user?.isGM) return ui.notifications.warn("Токены рискарей настраивает мастер.");
  return new (tokensAppClass())().render({ force: true });
}

export function registerTokens() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "tokenFrame", {
      name: "Рамка токенов рискарей",
      hint: "Рамка по умолчанию для окна «Токены рискарей». У каждого токена можно выбрать свою в окне кадра.",
      scope: "world", config: true, type: String,
      choices: Object.fromEntries(Object.entries(FRAMES).map(([id, f]) => [id, f.label])),
      default: "tush",
      onChange: rerenderList,
    });
    game.settings.register(MODULE_ID, "tokenScale", {
      name: "Масштаб токенов рискарей на столе",
      hint: "Масштаб картинки токена (texture scale). Одинаковый у всех обработанных — поэтому они занимают одно место.",
      scope: "world", config: true, type: Number, default: 3,
      onChange: rerenderList,
    });
    game.settings.register(MODULE_ID, "tokenDir", {
      name: "Папка для готовых токенов",
      hint: "Пусто — рядом с картинками мира: …/worlds/<мир>/nadgrad-tokens.",
      scope: "world", config: true, type: String, default: "", filePicker: "folder",
    });
    game.settings.registerMenu(MODULE_ID, "tokensMenu", {
      name: "Токены рискарей",
      label: "Открыть",
      hint: "Кадр в круге и рамка Надграда для токенов рискарей игроков.",
      icon: "fa-solid fa-circle-user",
      type: tokensAppClass(),
      restricted: true,
    });
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    const tool = {
      name: "nadgradTokens",
      title: "Токены рискарей",
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
