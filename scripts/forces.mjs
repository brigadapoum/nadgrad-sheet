// Окно мастера «Силы мира»: общий список сил с группами и рангами (настройка мира nadgrad.forces).
import { MODULE_ID, FORCE_RANKS, FORCE_GROUPS, normForces, newId } from "./logic.mjs";

export const readForces = () => {
  try { return normForces(game.settings.get(MODULE_ID, "forces")); } catch { return []; }
};

/** Черновик строк окна → то, что сохраняется. Пустые названия отбрасываются. */
export function draftToForces(rows) {
  return normForces(rows.map((r) => ({ id: r.id, name: r.name, group: r.group, rank: r.rank })));
}

export function forcesContext(rows) {
  const groups = [...new Set([...FORCE_GROUPS, ...rows.map((r) => r.group).filter(Boolean)])];
  return {
    rows: rows.map((r) => ({ ...r, ranks: FORCE_RANKS.map((x) => ({ r: x, on: r.rank === x })) })),
    groups,
  };
}

export function makeForcesApp() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  return class ForcesApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "nadgrad-forces",
      tag: "form",
      classes: ["nadgrad", "ng-forces-app", "application", "runner-actor"],
      window: { title: "Силы Надграда — настройка мира", icon: "fa-solid fa-people-group", resizable: true },
      position: { width: 520, height: 620 },
      form: { handler: ForcesApp.#onSave, submitOnChange: false, closeOnSubmit: false },
      actions: { add: ForcesApp.#onAdd, del: ForcesApp.#onDel, rank: ForcesApp.#onRank },
    };
    static PARTS = { body: { template: `modules/${MODULE_ID}/templates/forces.hbs`, scrollable: [""] } };

    /** Черновик правок живёт в окне до «Сохранить». */
    _rows = readForces().map((f) => ({ ...f }));

    async _prepareContext() { return forcesContext(this._rows); }

    _onRender() {
      const theme = (() => { try { return game.settings.get(MODULE_ID, "theme"); } catch { return "auto"; } })();
      this.element.classList.toggle("ng-tush", theme === "tush");
      this.element.classList.toggle("ng-smog", theme === "smog");
    }

    /** Перенести то, что набрано в полях, в черновик (перед перерисовкой и сохранением). */
    #capture() {
      for (const el of this.element.querySelectorAll("[data-row]")) {
        const row = this._rows.find((r) => r.id === el.dataset.row);
        if (!row) continue;
        row.name = el.querySelector(".ng-f-name")?.value ?? row.name;
        row.group = el.querySelector(".ng-f-group")?.value ?? row.group;
      }
    }

    static #onAdd() {
      this.#capture();
      this._rows.push({ id: newId(), name: "", group: this._rows.at(-1)?.group ?? FORCE_GROUPS[0], rank: null });
      this.render().then(() => this.element.querySelector("[data-row]:last-of-type .ng-f-name")?.focus());
    }

    static #onDel(event, target) {
      this.#capture();
      const id = target.closest("[data-row]")?.dataset.row;
      this._rows = this._rows.filter((r) => r.id !== id);
      this.render();
    }

    static #onRank(event, target) {
      this.#capture();
      const row = this._rows.find((r) => r.id === target.closest("[data-row]")?.dataset.row);
      if (!row) return;
      const r = Number(target.dataset.rank);
      row.rank = row.rank === r ? null : r;
      this.render();
    }

    static async #onSave(event) {
      event?.preventDefault?.();
      this.#capture();
      const list = draftToForces(this._rows);
      await game.settings.set(MODULE_ID, "forces", list);
      this._rows = list.map((f) => ({ ...f }));
      ui.notifications.info(`Силы мира сохранены: ${list.length}.`);
      this.render();
    }
  };
}

let App = null;
let instance = null;
export const forcesAppClass = () => (App ??= makeForcesApp());
export function openForces() {
  if (!game.user?.isGM) return ui.notifications.warn("Список сил ведёт мастер.");
  instance ??= new (forcesAppClass())();
  instance._rows = readForces().map((f) => ({ ...f }));
  return instance.render({ force: true });
}
