// Счётчики (часы) Надграда в Foundry: тип актёра «Счётчик», его окно, токен на сцене,
// заполнение двойным кликом и кнопками в меню токена, кнопка «Новый счётчик» в панели токенов.
import { MODULE_ID } from "./logic.mjs";
import {
  CLOCK_TYPE, CLOCK_SIZES, CLOCK_THEMES, CLOCK_FOLDER,
  normClock, clockSrc, clockStep, clockSegClick, clockUpdateExtras, clockView,
} from "./clock-logic.mjs";
import { effectiveTheme } from "./dom.mjs";

const isClock = (actor) => actor?.type === CLOCK_TYPE;
/** Поля счётчика простым объектом (system у Foundry — модель данных, её не разворачиваем). */
const plainSystem = (actor) => {
  const s = actor?.system ?? {};
  return { size: s.size, value: s.value, theme: s.theme, note: s.note };
};
const themeSetting = () => {
  try { return game.settings.get(MODULE_ID, "theme"); } catch { return "auto"; }
};
/** Тема нового счётчика — та, что сейчас видна у создающего. */
const defaultTheme = () => effectiveTheme(document.body, themeSetting());

/** Окно счётчика. Base — ActorSheetV2 с HandlebarsApplicationMixin (на стенде — заглушка). */
export function makeClockSheet(Base) {
  return class NadgradClockSheet extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["nadgrad", "ng-clock-sheet"],
      position: { width: 320, height: "auto" },
      window: { resizable: false, icon: "fa-solid fa-clock" },
      form: { submitOnChange: true, closeOnSubmit: false },
      actions: {
        ngClockSeg: { handler: NadgradClockSheet.#onSeg, buttons: [0, 2] },
        ngClockStep: NadgradClockSheet.#onStep,
        ngClockSize: NadgradClockSheet.#onSize,
        ngClockTheme: NadgradClockSheet.#onTheme,
      },
    };

    static PARTS = { main: { template: `modules/${MODULE_ID}/templates/clock.hbs` } };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.actor = this.actor;
      context.clock = clockView(this.actor.system);
      context.ngEditable = this.isEditable;
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const { theme } = normClock(this.actor.system);
      this.element.classList.toggle("ng-clock-tush", theme === "tush");
      this.element.classList.toggle("ng-clock-smog", theme === "smog");
    }

    #set(value) {
      if (!this.isEditable || value === normClock(this.actor.system).value) return;
      return this.actor.update({ "system.value": value });
    }

    /** ЛКМ по сектору — заполнить до него (повторно по последнему — снять), ПКМ — снять один. */
    static #onSeg(event, target) {
      return this.#set(clockSegClick(this.actor.system, Number(target.dataset.n), event.button));
    }

    static #onStep(event, target) {
      return this.#set(clockStep(this.actor.system, Number(target.dataset.delta)));
    }

    static #onSize(event, target) {
      if (!this.isEditable) return;
      return this.actor.update({ "system.size": Number(target.dataset.size) });
    }

    static #onTheme(event, target) {
      if (!this.isEditable) return;
      return this.actor.update({ "system.theme": target.dataset.theme });
    }
  };
}

/** ±1 сектор с доски или из меню токена. */
export function stepClock(actor, delta) {
  if (!isClock(actor) || !actor.isOwner) return;
  const value = clockStep(actor.system, delta);
  if (value === normClock(actor.system).value) return;
  return actor.update({ "system.value": value });
}

/** Картинка и имя всех привязанных токенов этого счётчика — на всех сценах. */
async function syncTokens(actor) {
  const src = clockSrc(actor.system);
  for (const scene of game.scenes ?? []) {
    const updates = scene.tokens
      .filter((t) => t.actorId === actor.id && t.actorLink && (t.texture?.src !== src || t.name !== actor.name))
      .map((t) => ({ _id: t.id, "texture.src": src, name: actor.name }));
    if (!updates.length) continue;
    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      console.warn(`${MODULE_ID} | не удалось обновить токены счётчика «${actor.name}» на сцене «${scene.name}»`, err);
    }
  }
}

// ---- подпись под токеном в шрифте и цветах темы ----
const NAMEPLATE = {
  tush: { fontFamily: "Oswald", fontWeight: "500", fill: "#1C1814", stroke: "#ECE7DA", strokeThickness: 6, letterSpacing: 1 },
  smog: { fontFamily: "Oswald", fontWeight: "500", fill: "#D0D4C9", stroke: "#100C0A", strokeThickness: 6, letterSpacing: 1 },
};
function styleNameplate(token, force = false) {
  const plate = token?.nameplate;
  if (!plate || !isClock(token.actor)) return;
  const { theme } = normClock(token.actor.system);
  if (!force && plate._ngTheme === theme) return;
  try {
    const style = plate.style.clone();
    Object.assign(style, NAMEPLATE[theme]);
    plate.style = style;
    plate._ngTheme = theme;
  } catch (err) {
    console.warn(`${MODULE_ID} | подпись счётчика`, err);
  }
}

/** Папка «Счётчики» в актёрах — создаётся при первом счётчике. */
async function clockFolder() {
  const found = game.folders.find((f) => f.type === "Actor" && f.name === CLOCK_FOLDER);
  if (found) return found;
  try { return await Folder.create({ name: CLOCK_FOLDER, type: "Actor" }); } catch { return null; }
}

/** «Новый счётчик»: название, размер, оформление → актёр в папке «Счётчики» и токен в центре экрана. */
export async function createClockDialog() {
  const theme = defaultTheme();
  const sizes = CLOCK_SIZES.map((n) => `<option value="${n}" ${n === 8 ? "selected" : ""}>${n}</option>`).join("");
  const themes = CLOCK_THEMES.map((t) => `<option value="${t.id}" ${t.id === theme ? "selected" : ""}>${t.label}</option>`).join("");
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Новый счётчик", icon: "fa-solid fa-clock" },
    classes: ["nadgrad", "ng-clock-dialog", `ng-clock-${theme}`],
    content: `
      <div class="form-group"><label>Название</label><input type="text" name="ngName" placeholder="Облава" autofocus></div>
      <div class="form-group"><label>Секторов</label><select name="ngSize">${sizes}</select></div>
      <div class="form-group"><label>Оформление</label><select name="ngTheme">${themes}</select></div>`,
    ok: {
      label: "Создать",
      icon: "fa-solid fa-clock",
      callback: (event, button) => {
        const el = button.form.elements;
        return { name: el.ngName.value.trim(), size: Number(el.ngSize.value), theme: el.ngTheme.value };
      },
    },
    rejectClose: false,
  });
  if (!data) return;
  const folder = await clockFolder();
  const actor = await Actor.create({
    name: data.name || "Счётчик",
    type: CLOCK_TYPE,
    folder: folder?.id ?? null,
    system: { size: data.size, value: 0, theme: data.theme },
  });
  if (!actor || !canvas?.scene) return actor;
  try {
    const span = (actor.prototypeToken.width ?? 2) * canvas.grid.size;
    const { x, y } = canvas.stage.pivot; // центр того, что сейчас видно
    const td = await actor.getTokenDocument({ x: Math.round(x - span / 2), y: Math.round(y - span / 2) });
    await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);
  } catch (err) {
    console.warn(`${MODULE_ID} | счётчик создан, но токен не выложен — перетащите его из папки «${CLOCK_FOLDER}»`, err);
  }
  return actor;
}

/** Подключение всего, что связано со счётчиками. Вызывается один раз из main.mjs. */
export function registerClocks() {
  Hooks.once("init", async () => {
    const f = foundry.data.fields;
    class ClockData extends foundry.abstract.TypeDataModel {
      static defineSchema() {
        return {
          size: new f.NumberField({ required: true, integer: true, initial: 8, choices: CLOCK_SIZES }),
          value: new f.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
          theme: new f.StringField({ required: true, initial: "tush", choices: CLOCK_THEMES.map((t) => t.id) }),
          note: new f.StringField({ required: false, initial: "" }),
        };
      }
    }
    CONFIG.Actor.dataModels[CLOCK_TYPE] = ClockData;
    if (CONFIG.Actor.typeIcons) CONFIG.Actor.typeIcons[CLOCK_TYPE] = "fa-solid fa-clock";

    const { HandlebarsApplicationMixin } = foundry.applications.api;
    const Sheet = makeClockSheet(HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2));
    foundry.documents.collections.Actors.registerSheet(MODULE_ID, Sheet, {
      types: [CLOCK_TYPE], makeDefault: true, label: "Надград — счётчик",
    });
    await foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/clock.hbs`]);
  });

  // Двойной клик по токену счётчика: ЛКМ +1, ПКМ −1 (вместо окна персонажа / настроек токена).
  Hooks.once("setup", () => {
    const proto = CONFIG.Token.objectClass.prototype;
    for (const [method, delta] of [["_onClickLeft2", 1], ["_onClickRight2", -1]]) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function (event, ...rest) {
        if (isClock(this.actor) && this.actor.isOwner) return stepClock(this.actor, delta);
        return original.call(this, event, ...rest);
      };
    }
  });

  Hooks.on("preCreateActor", (actor, data) => {
    if (!isClock(actor)) return;
    const theme = data.system?.theme ?? defaultTheme();
    const s = normClock({ ...plainSystem(actor), theme });
    const src = clockSrc(s);
    const D = CONST.TOKEN_DISPLAY_MODES;
    actor.updateSource({
      img: src,
      "system.theme": s.theme,
      "system.value": s.value,
      prototypeToken: {
        name: actor.name,
        texture: { src },
        width: 2, height: 2,
        actorLink: true,
        lockRotation: true,
        displayName: D.ALWAYS,
        displayBars: D.NONE,
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        sight: { enabled: false },
        ring: { enabled: false },
      },
    });
  });

  Hooks.on("preUpdateActor", (actor, changes) => {
    if (!isClock(actor)) return;
    const flat = foundry.utils.expandObject(foundry.utils.deepClone(changes));
    const extras = clockUpdateExtras({ img: actor.img, system: plainSystem(actor) }, flat);
    if (extras) foundry.utils.mergeObject(changes, foundry.utils.expandObject(extras));
  });

  // Токены на сценах обновляет тот, кто менял счётчик.
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (!isClock(actor) || userId !== game.user.id) return;
    if (!("system" in changes) && !("name" in changes) && !("img" in changes)) return;
    syncTokens(actor);
  });

  Hooks.on("refreshToken", (token) => styleNameplate(token));
  Hooks.once("ready", async () => {
    // шрифт на холсте появляется только после загрузки — тогда перекрашиваем подписи
    try { await document.fonts.load('500 24px "Oswald"'); } catch {}
    for (const t of canvas?.tokens?.placeables ?? []) styleNameplate(t, true);
  });
  Hooks.on("canvasReady", () => {
    for (const t of canvas.tokens?.placeables ?? []) styleNameplate(t, true);
  });

  // Меню токена (ПКМ): −, +, открыть окно счётчика.
  Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud.document?.actor ?? hud.object?.actor;
    if (!isClock(actor)) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".ng-clock-hud")) return;
    const box = document.createElement("div");
    box.className = "ng-clock-hud";
    const btn = (cls, icon, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `control-icon ${cls}`;
      b.title = title;
      b.innerHTML = `<i class="${icon}"></i>`;
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      return b;
    };
    if (actor.isOwner) {
      box.append(
        btn("ng-clock-plus", "fa-solid fa-plus", "Заполнить сектор", () => stepClock(actor, 1)),
        btn("ng-clock-minus", "fa-solid fa-minus", "Снять сектор", () => stepClock(actor, -1)),
      );
    }
    box.append(btn("ng-clock-open", "fa-solid fa-clock", "Открыть счётчик", () => actor.sheet.render(true)));
    (root.querySelector(".col.left") ?? root).prepend(box);
  });

  // Кнопка «Новый счётчик» в панели токенов — тем, кто может создавать актёров.
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.can?.("ACTOR_CREATE")) return;
    const tool = {
      name: "nadgradClock",
      title: "Новый счётчик",
      icon: "fa-solid fa-clock",
      button: true,
      order: 50,
      visible: true,
      onChange: () => createClockDialog(),
    };
    const tokens = Array.isArray(controls) ? controls.find((c) => c.name === "token" || c.name === "tokens") : controls.tokens;
    if (!tokens) return;
    if (Array.isArray(tokens.tools)) tokens.tools.push({ ...tool, onClick: tool.onChange });
    else tokens.tools.nadgradClock = tool;
  });
}
