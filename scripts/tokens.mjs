// Кольца токенов рискарей (только мастер), с 0.9.0.
// 1) Кольца Надграда (Тушь, Смог) регистрируются во встроенном «динамическом кольце» Foundry —
//    выбираются в настройках ядра «Динамическое кольцо токена». Картинки токенов не меняются.
// 2) Окно «Токены рискарей»: какое кольцо стоит в мире, включить кольцо рискарям игроков.
// 3) Откат 0.8.0: вернуть исходные картинки, которые та версия заменила на незагруженные.
import { MODULE_ID } from "./logic.mjs";
import {
  RINGS, RING_DEFAULT, RING_EFFECTS, ringPath, isNadgradRing, playerRunners, rowContext,
  ringToken, ringPrototype, restorePlan,
} from "./tokens-logic.mjs";

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
const coreRing = () => { try { return game.settings.get("core", "dynamicTokenRing"); } catch { return ""; } };

function applyTheme(el) {
  const t = get("theme", "auto");
  el.classList.toggle("ng-tush", t === "tush");
  el.classList.toggle("ng-smog", t === "smog");
}

const runners = () => playerRunners(game.actors.contents, game.users.contents);

async function setRing(actor, on) {
  await actor.update(ringPrototype(on));
  for (const scene of game.scenes) {
    const list = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => ({ _id: t.id, ...ringToken(on) }));
    if (list.length) await scene.updateEmbeddedDocuments("Token", list);
  }
}

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
      actions: { worldRing: TokensApp.#onWorldRing, toggle: TokensApp.#onToggle, allOn: TokensApp.#onAllOn },
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
        off: rows.filter((r) => !r.ring).length,
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

    static async #onToggle(event, target) {
      const actor = game.actors.get(target.dataset.id);
      if (!actor) return;
      await setRing(actor, !actor.prototypeToken?.ring?.enabled);
      this.render();
    }

    static async #onAllOn() {
      if (this._busy) return;
      this._busy = true;
      this.render();
      let n = 0;
      for (const actor of runners()) {
        if (actor.prototypeToken?.ring?.enabled) continue;
        try { await setRing(actor, true); n += 1; } catch (e) { console.error(e); }
      }
      this._busy = false;
      this.render();
      ui.notifications.info(`Кольцо включено у ${n} рискарей (прототип и токены на всех сценах).`);
    }
  };
}

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
    game.settings.registerMenu(MODULE_ID, "tokensMenu", {
      name: "Кольца токенов рискарей",
      label: "Открыть",
      hint: `Кольца Надграда во встроенном «динамическом кольце» Foundry: выбрать кольцо мира (по умолчанию — ${RINGS[RING_DEFAULT].label}) и включить его рискарям игроков.`,
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
