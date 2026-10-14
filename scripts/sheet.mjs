// Лист рискаря Надграда: наследник листа системы CBR+PNK 1.1+ (ApplicationV2).
// Родной лист не трогаем — добавляем к нему две части: полосу вкладок и экран «Статус».
import {
  MODULE_ID, buildStatusContext, readState, repMax, tensionAdd, cellClick, clampInt,
} from "./logic.mjs";

const TABS = [
  { id: "sheet", label: "Лист" },
  { id: "status", label: "Статус" },
  { id: "relations", label: "Отношения" },
  { id: "projects", label: "Проекты" },
];
const PART_OF_TAB = { sheet: "form", status: "status", relations: "relations", projects: "projects" };

export function makeSheetClass(Runner) {
  return class NadgradRunner extends Runner {
    static DEFAULT_OPTIONS = {
      classes: ["runner-actor", "nadgrad"],
      position: { width: 470, height: 760 },
      actions: {
        ngTab: NadgradRunner.#onTab,
        ngStep: NadgradRunner.#onStep,
        ngRepCell: NadgradRunner.#onRepCell,
        ngRepRank: NadgradRunner.#onRepRank,
        ngTensionCell: NadgradRunner.#onTensionCell,
        ngTensionLevel: NadgradRunner.#onTensionLevel,
        ngTensionStep: { handler: NadgradRunner.#onTensionStep, buttons: [0, 2] },
        ngTensionAdd: NadgradRunner.#onTensionAdd,
        ngLife: NadgradRunner.#onLife,
        ngNotes: NadgradRunner.#onNotes,
      },
    };

    // порядок частей = порядок на экране: вкладки, родной лист, «Статус»
    static PARTS = {
      ngTabs: { template: `modules/${MODULE_ID}/templates/tabs.hbs` },
      ...Runner.PARTS,
      status: { template: `modules/${MODULE_ID}/templates/status.hbs` },
      relations: { template: `modules/${MODULE_ID}/templates/relations.hbs` },
      projects: { template: `modules/${MODULE_ID}/templates/projects.hbs` },
    };

    /** Открытая вкладка живёт в экземпляре листа и переживает перерисовки. */
    _ngTab = "sheet";

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.ng = buildStatusContext(this.actor);
      context.ngTabs = TABS.map((t) => ({ ...t, active: t.id === this._ngTab }));
      context.ngEditable = this.isEditable;
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#applyTab();
    }

    #applyTab() {
      for (const [tab, partId] of Object.entries(PART_OF_TAB)) {
        const el = this.element.querySelector(`[data-application-part="${partId}"]`);
        el?.classList.toggle("ng-hidden", tab !== this._ngTab);
      }
      for (const b of this.element.querySelectorAll("[data-action='ngTab']")) {
        b.classList.toggle("active", b.dataset.tab === this._ngTab);
      }
    }

    #flags() { return readState(this.actor.flags?.[MODULE_ID]); }
    #set(path, value) { return this.actor.update({ [`flags.${MODULE_ID}.${path}`]: value }); }

    static #onTab(event, target) {
      this._ngTab = target.dataset.tab;
      this.#applyTab();
      this.element.querySelector(".window-content")?.scrollTo({ top: 0 });
    }

    /** −/+ у чеков и дел: data-field, data-delta */
    static #onStep(event, target) {
      const field = target.dataset.field;
      const s = this.#flags();
      const delta = Number(target.dataset.delta) || 0;
      const lo = field === "cheki" ? -999999 : 0;
      return this.#set(field, clampInt(s[field] + delta, lo, 999999));
    }

    static #onRepCell(event, target) {
      const s = this.#flags();
      return this.#set("rep.value", cellClick(s.rep.value, Number(target.dataset.n)));
    }

    static #onRepRank(event, target) {
      const s = this.#flags();
      const rank = clampInt(target.dataset.rank, 1, 5);
      return this.#set("rep", { rank, value: Math.min(s.rep.value, repMax(rank)) });
    }

    static #onTensionCell(event, target) {
      const s = this.#flags();
      return this.#set("tension.points", cellClick(s.tension.points, Number(target.dataset.n)));
    }

    static #onTensionLevel(event, target) {
      const s = this.#flags();
      return this.#set("tension.level", cellClick(s.tension.level, Number(target.dataset.n)));
    }

    /** ЛКМ +1, ПКМ −1 — с переносом 9 → уровень */
    static #onTensionStep(event, target) {
      const delta = event.button === 2 ? -1 : 1;
      return this.#applyTension(delta);
    }

    /** «+N»: число из поля рядом, можно отрицательное */
    static #onTensionAdd(event, target) {
      const input = this.element.querySelector("input.ng-tension-add");
      const n = Math.trunc(Number(input?.value));
      if (!n) return;
      if (input) input.value = "";
      return this.#applyTension(n);
    }

    #applyTension(delta) {
      const s = this.#flags();
      const r = tensionAdd(s.tension, delta);
      if (r.overflow) ui.notifications.warn(`Напряжение упёрлось в максимум (4 уровень, 8): лишних очков — ${r.overflow}.`);
      return this.#set("tension", { level: r.level, points: r.points });
    }

    static #onLife(event, target) {
      const s = this.#flags();
      const level = Number(target.dataset.level);
      return this.#set("life.level", s.life.level === level ? null : level);
    }

    /** Открыть досье системы (там же старые заметки 1.05) — через родное действие листа. */
    static #onNotes(event, target) {
      const action = this.options.actions.openNotes;
      const handler = typeof action === "function" ? action : action?.handler;
      return handler?.call(this, event, target);
    }
  };
}
