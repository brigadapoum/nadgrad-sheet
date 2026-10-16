// Лист рискаря Надграда: наследник листа системы CBR+PNK 1.1+ (ApplicationV2).
// Родной лист не трогаем — добавляем к нему полосу вкладок и экраны «Статус», «Отношения», «Проекты», «Передышка».
import {
  MODULE_ID, buildStatusContext, readState, repMax, tensionAdd, clampInt,
  LOAD_LEVELS, loadStep, loadIndex, gearLoad, isExtraLoad, blockStep, splitAugFields,
  readRelations, relContext, readProjects, projContext, splitListFields, projSize, newId, REL_LIMIT,
  readWhy, WHY_MAX,
} from "./logic.mjs";
import { readForces, openForces } from "./forces.mjs";
import { CLOCK_TYPE, CLOCK_FOLDER } from "./clock-logic.mjs";
import {
  tidyHeader, applyThemeClass, effectiveTheme, loadButton,
  noSubmitButtons, enterBlurs, dicePlus, augDecorate, whyLine,
} from "./dom.mjs";

const themeSetting = () => {
  try { return game.settings.get(MODULE_ID, "theme"); } catch { return "auto"; }
};

const TABS = [
  { id: "sheet", label: "Лист" },
  { id: "status", label: "Статус" },
  { id: "relations", label: "Отношения" },
  { id: "projects", label: "Проекты" },
  { id: "breather", label: "Передышка" },
];
const PART_OF_TAB = { sheet: "form", status: "status", relations: "relations", projects: "projects", breather: "breather" };

export function makeSheetClass(Runner) {
  return class NadgradRunner extends Runner {
    static DEFAULT_OPTIONS = {
      classes: ["runner-actor", "nadgrad"],
      position: { width: 470, height: 760 },
      // своя обработка формы: поля аугментаций (ngAug.*) уходят в предметы, остальное — в актёра
      form: { handler: NadgradRunner.#onSubmit, submitOnChange: true, closeOnSubmit: false },
      actions: {
        ngTab: NadgradRunner.#onTab,
        ngStep: NadgradRunner.#onStep,
        ngRepCell: { handler: NadgradRunner.#onRepCell, buttons: [0, 2] },
        ngRepRank: NadgradRunner.#onRepRank,
        ngTensionCell: { handler: NadgradRunner.#onTensionCell, buttons: [0, 2] },
        ngTensionLevel: { handler: NadgradRunner.#onTensionLevel, buttons: [0, 2] },
        ngTensionZero: NadgradRunner.#onTensionZero,
        ngTensionAdd: NadgradRunner.#onTensionAdd,
        ngLife: NadgradRunner.#onLife,
        ngNotes: NadgradRunner.#onNotes,
        ngTheme: NadgradRunner.#onTheme,
        ngLoad: { handler: NadgradRunner.#onLoad, buttons: [0, 2] },
        // отметка снаряжения: своя версия — загрузка считается по отмеченным предметам
        gearSelect: NadgradRunner.#onGearSelect,
        // счётчик «Доп. нагрузки»: как в 1.05, каждое деление — +1 к загрузке
        gearChangeStack: { handler: NadgradRunner.#onGearStack, buttons: [0, 2] },
        // отношения
        ngRelAdd: NadgradRunner.#onRelAdd,
        ngRelStep: NadgradRunner.#onRelStep,
        ngRelDel: NadgradRunner.#onRelDel,
        ngForces: () => openForces(),
        // проекты
        ngProjNew: NadgradRunner.#onProjNew,
        ngProjSize: NadgradRunner.#onProjSize,
        ngProjCancel: NadgradRunner.#onProjCancel,
        ngProjCreate: NadgradRunner.#onProjCreate,
        ngProjClock: { handler: NadgradRunner.#onProjClock, buttons: [0, 2] },
        ngProjStep: NadgradRunner.#onProjStep,
        ngProjDel: NadgradRunner.#onProjDel,
        ngProjTable: NadgradRunner.#onProjTable,
      },
    };

    // порядок частей = порядок на экране: вкладки, родной лист, «Статус»
    static PARTS = {
      ngTabs: { template: `modules/${MODULE_ID}/templates/tabs.hbs` },
      ...Runner.PARTS,
      status: { template: `modules/${MODULE_ID}/templates/status.hbs` },
      relations: { template: `modules/${MODULE_ID}/templates/relations.hbs` },
      projects: { template: `modules/${MODULE_ID}/templates/projects.hbs` },
      breather: { template: `modules/${MODULE_ID}/templates/breather.hbs` },
    };

    /** Открытая вкладка живёт в экземпляре листа и переживает перерисовки. */
    _ngTab = "sheet";

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.ng = buildStatusContext(this.actor);
      const flags = this.actor.flags?.[MODULE_ID];
      const theme = this.element ? effectiveTheme(this.element, themeSetting()) : (themeSetting() === "smog" ? "smog" : "tush");
      context.ng.rel = relContext(readRelations(flags), readForces());
      context.ng.proj = projContext(readProjects(flags), theme, this._ngProjDraft);
      context.ng.isGM = !!game.user?.isGM;
      context.ngTabs = TABS.map((t) => ({ ...t, active: t.id === this._ngTab }));
      context.ngEditable = this.isEditable;
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#decorate();
      this.#applyTab();
      this.#healLoad();
    }

    /** Пока идёт своя отметка снаряжения, счётчик не чиним — он вот-вот запишется. */
    _ngGearBusy = false;

    /** Счётчик загрузки разошёлся с отметками (переход 1.05 → 1.2 и т. п.) — записать верное число. */
    #healLoad() {
      if (this._ngGearBusy || !this.isEditable) return;
      const real = gearLoad(this.actor.items);
      const stored = Number(this.actor.system?.GEAR?.LOAD?.value);
      if (stored === real) return;
      return this.actor.update({ "system.GEAR.LOAD.value": real });
    }

    /** Отметить / снять снаряжение. Как в системе, но загрузка — по отмеченным предметам, а не ±. */
    static async #onGearSelect(event, target) {
      if (!this.isEditable) return;
      const id = target.closest("[data-item-id]")?.getAttribute("data-item-id");
      const item = this.actor.items.get(id);
      if (!item) return;
      const isUse = !item.system.isUse;
      const others = Array.from(this.actor.items).filter((i) => i.id !== item.id);
      const total = gearLoad(others) + (isUse ? gearLoad([{ type: "gear", system: { ...item.system, isUse: true } }]) : 0);
      this._ngGearBusy = true;
      try {
        await item.update({ "system.isUse": isUse });
        await this.actor.update({ "system.GEAR.LOAD.value": total });
      } finally {
        this._ngGearBusy = false;
      }
      const max = Number(this.actor.system?.GEAR?.LOAD?.max) || 0;
      if (isUse && total > max) await this.#overGeared();
    }

    /** Счётчик у снаряжения (ЛКМ +1, ПКМ −1). У «Доп. нагрузки» деления идут в загрузку. */
    static async #onGearStack(event, target) {
      if (!this.isEditable) return;
      const id = target.closest("[data-item-id]")?.getAttribute("data-item-id");
      const item = this.actor.items.get(id);
      if (!item) return;
      const max = Math.max(0, Number(item.system.max) || 0);
      const stack = clampInt((Number(item.system.stack) || 0) + (event.button === 2 ? -1 : 1), 0, max);
      if (stack === Number(item.system.stack)) return;
      if (!isExtraLoad(item)) return item.update({ "system.stack": stack });
      const others = Array.from(this.actor.items).filter((i) => i.id !== item.id);
      const total = gearLoad(others) + stack;
      this._ngGearBusy = true;
      try {
        await item.update({ "system.stack": stack });
        await this.actor.update({ "system.GEAR.LOAD.value": total });
      } finally {
        this._ngGearBusy = false;
      }
      const cap = Number(this.actor.system?.GEAR?.LOAD?.max) || 0;
      if (event.button !== 2 && total > cap) await this.#overGeared();
    }

    /** Отправка формы листа: аугментации — в свои предметы, остальное — в актёра (как у системы). */
    static async #onSubmit(event, form, formData) {
      event?.preventDefault?.();
      const data = { ...(formData?.object ?? {}) };
      const augs = splitAugFields(data);
      const relF = splitListFields(data, "ngRel");
      const projF = splitListFields(data, "ngProj");
      const flags = this.actor.flags?.[MODULE_ID];
      if (Object.keys(relF).length) {
        const rels = readRelations(flags);
        const next = rels.map((r) => (relF[r.id] && "note" in relF[r.id] ? { ...r, note: String(relF[r.id].note ?? "") } : r));
        if (next.some((r, i) => r.note !== rels[i].note)) data[`flags.${MODULE_ID}.relations`] = next;
      }
      if (Object.keys(projF).length) {
        const projs = readProjects(flags);
        const next = projs.map((p) => {
          const f = projF[p.id];
          if (!f) return p;
          const name = "name" in f && String(f.name).trim() ? String(f.name).trim() : p.name;
          const note = "note" in f ? String(f.note ?? "") : p.note;
          return { ...p, name, note };
        });
        if (next.some((p, i) => p.name !== projs[i].name || p.note !== projs[i].note)) data[`flags.${MODULE_ID}.projects`] = next;
      }
      for (const [id, upd] of Object.entries(augs)) {
        const item = this.actor.items.get(id);
        if (!item) continue;
        if (upd.name === item.name) delete upd.name;
        if (upd["system.desc"] === (item.system?.desc ?? "")) delete upd["system.desc"];
        if (Object.keys(upd).length) await item.update(upd);
      }
      if (Object.keys(data).length) await this.actor.update(data);
    }

    /** Карточка «перегружен» в чат — та же, что у системы. */
    async #overGeared() {
      const content = await foundry.applications.handlebars.renderTemplate("systems/CBRPNK/parts/roll-card.hbs", {
        class: "alert",
        img: this.actor.img,
        name: this.actor.name,
        desc: game.i18n.localize("GEAR.overGEARED.desc"),
        approach: game.i18n.localize("GEAR.overGEARED.name"),
      });
      return ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: this.actor }), content });
    }

    /** Правки родного листа: тема, полоса над портретом, кнопка загрузки. */
    #decorate() {
      const root = this.element;
      const theme = themeSetting();
      applyThemeClass(root, theme);
      tidyHeader(root, { active: effectiveTheme(root, theme) });
      whyLine(root, { value: readWhy(this.actor), editable: this.isEditable, max: WHY_MAX });
      augDecorate(root, { items: this.actor.items, editable: this.isEditable });
      dicePlus(root);
      noSubmitButtons(root);
      enterBlurs(root);
      this.#wireDraft();
      const index = loadIndex(this.actor.system?.GEAR?.LOAD?.selected);
      loadButton(root, {
        index,
        label: game.i18n.localize(LOAD_LEVELS[index].key),
        levels: LOAD_LEVELS,
      });
    }

    // ---------- отношения ----------

    #rels() { return readRelations(this.actor.flags?.[MODULE_ID]); }
    #setRels(list) { return this.#set("relations", list); }

    static #onRelAdd() {
      const id = this.element.querySelector("select.ng-rel-pick")?.value;
      if (!id) return ui.notifications.warn("Выбери силу из списка.");
      const force = readForces().find((f) => f.id === id);
      if (!force) return;
      const rels = this.#rels();
      if (rels.some((r) => r.id === id)) return ui.notifications.warn(`«${force.name}» уже есть в отношениях — меняй кнопками − / +.`);
      return this.#setRels([...rels, { id, name: force.name, v: 0, note: "" }]);
    }

    static #onRelStep(event, target) {
      const rels = this.#rels();
      const r = rels.find((x) => x.id === target.dataset.id);
      if (!r) return;
      r.v = clampInt(r.v + (Number(target.dataset.delta) || 0), -REL_LIMIT, REL_LIMIT);
      return this.#setRels(rels);
    }

    /** Удаление — в два клика: первый взводит («точно?»), второй удаляет. */
    _ngArm = null;
    #armed(key, target) {
      if (this._ngArm === key) { this._ngArm = null; return true; }
      this._ngArm = key;
      target.textContent = "точно?";
      target.classList.add("armed");
      setTimeout(() => { if (this._ngArm === key) { this._ngArm = null; target.textContent = "×"; target.classList.remove("armed"); } }, 3000);
      return false;
    }

    static #onRelDel(event, target) {
      const id = target.dataset.id;
      if (!this.#armed(`rel:${id}`, target)) return;
      return this.#setRels(this.#rels().filter((r) => r.id !== id));
    }

    // ---------- проекты ----------

    /** Черновик нового проекта живёт в листе, пока его не завели или не отменили. */
    _ngProjDraft = null;

    #projs() { return readProjects(this.actor.flags?.[MODULE_ID]); }
    #setProjs(list) { return this.#set("projects", list); }

    /** Поля черновика не в форме актёра: значения держим в экземпляре, Enter в названии — «Завести». */
    #wireDraft() {
      const box = this.element.querySelector(".ng-newpj");
      if (!box || !this._ngProjDraft) return;
      const name = box.querySelector(".ng-pj-draft-name");
      const note = box.querySelector(".ng-pj-draft-note");
      for (const [el, key] of [[name, "name"], [note, "note"]]) {
        if (!el) continue;
        el.addEventListener("input", (e) => { e.stopPropagation(); if (this._ngProjDraft) this._ngProjDraft[key] = el.value; });
        el.addEventListener("change", (e) => e.stopPropagation()); // не отправлять форму актёра
        el.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault(); e.stopPropagation();
          NadgradRunner.#onProjCreate.call(this);
        });
      }
      if (!name.value) name.focus?.();
    }

    #captureDraft() {
      const box = this.element.querySelector(".ng-newpj");
      if (!box || !this._ngProjDraft) return;
      this._ngProjDraft.name = box.querySelector(".ng-pj-draft-name")?.value ?? this._ngProjDraft.name;
      this._ngProjDraft.note = box.querySelector(".ng-pj-draft-note")?.value ?? this._ngProjDraft.note;
    }

    static #onProjNew() {
      this._ngProjDraft = { name: "", size: 8, note: "" };
      return this.render();
    }

    static #onProjSize(event, target) {
      this.#captureDraft();
      if (this._ngProjDraft) this._ngProjDraft.size = projSize(target.dataset.size);
      return this.render();
    }

    static #onProjCancel() {
      this._ngProjDraft = null;
      return this.render();
    }

    static async #onProjCreate() {
      this.#captureDraft();
      const d = this._ngProjDraft;
      if (!d) return;
      const name = String(d.name ?? "").trim();
      if (!name) {
        this.element.querySelector(".ng-pj-draft-name")?.focus?.();
        return ui.notifications.warn("Назови проект.");
      }
      const p = { id: newId(), name, size: projSize(d.size), value: 0, note: String(d.note ?? "").trim() };
      this._ngProjDraft = null;
      await this.#setProjs([...this.#projs(), p]);
      return this.render();
    }

    #stepProj(id, delta) {
      const list = this.#projs();
      const p = list.find((x) => x.id === id);
      if (!p) return;
      const v = clampInt(p.value + delta, 0, p.size);
      if (v === p.value) return;
      const wasFull = p.value >= p.size;
      p.value = v;
      if (v >= p.size && !wasFull) ui.notifications.info(`Проект готов: ${p.name}`);
      return this.#setProjs(list);
    }

    static #onProjClock(event, target) { return this.#stepProj(target.dataset.id, event.button === 2 ? -1 : 1); }
    static #onProjStep(event, target) { return this.#stepProj(target.dataset.id, Number(target.dataset.delta) || 0); }

    static #onProjDel(event, target) {
      const id = target.dataset.id;
      if (!this.#armed(`proj:${id}`, target)) return;
      return this.#setProjs(this.#projs().filter((p) => p.id !== id));
    }

    /** «На стол»: копия часов проекта — обычный счётчик на сцене (с проектом не связан). */
    static async #onProjTable(event, target) {
      const p = this.#projs().find((x) => x.id === target.dataset.id);
      if (!p) return;
      if (!game.user?.can?.("ACTOR_CREATE")) return ui.notifications.warn("Выложить на стол может мастер (или игрок с правом создавать актёров).");
      if (!canvas?.scene) return ui.notifications.warn("Нет открытой сцены.");
      const theme = effectiveTheme(this.element, themeSetting());
      let folder = game.folders.find((f) => f.type === "Actor" && f.name === CLOCK_FOLDER);
      if (!folder) { try { folder = await Folder.create({ name: CLOCK_FOLDER, type: "Actor" }); } catch { folder = null; } }
      const actor = await Actor.create({
        name: `${p.name} (${this.actor.name})`,
        type: CLOCK_TYPE,
        folder: folder?.id ?? null,
        system: { size: p.size, value: p.value, theme, note: p.note },
      });
      if (!actor) return;
      const span = (actor.prototypeToken.width ?? 2) * canvas.grid.size;
      const { x, y } = canvas.stage.pivot;
      const td = await actor.getTokenDocument({ x: Math.round(x - span / 2), y: Math.round(y - span / 2) });
      await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);
      ui.notifications.info(`Часы «${p.name}» на столе. Это копия: дальше они крутятся отдельно от проекта.`);
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
      this.element.querySelector(".window-content")?.scrollTo?.({ top: 0 });
    }

    /** −/+ у чеков и дел: data-field, data-delta. «Заблокировано» берёт чеки из общего пула и возвращает их. */
    static #onStep(event, target) {
      const field = target.dataset.field;
      const s = this.#flags();
      const delta = Number(target.dataset.delta) || 0;
      if (field === "blocked") {
        const r = blockStep(s, delta);
        if (r.short) ui.notifications.warn("Свободных чеков нет — блокировать нечего.");
        if (r.cheki === s.cheki && r.blocked === s.blocked) return;
        return this.actor.update({ [`flags.${MODULE_ID}.cheki`]: r.cheki, [`flags.${MODULE_ID}.blocked`]: r.blocked });
      }
      const lo = field === "cheki" ? -999999 : 0;
      return this.#set(field, clampInt(s[field] + delta, lo, 999999));
    }

    /** Как на родном листе: ЛКМ — поставить отметку, ПКМ — снять. */
    static #onRepCell(event, target) {
      const s = this.#flags();
      const d = event.button === 2 ? -1 : 1;
      return this.#set("rep.value", clampInt(s.rep.value + d, 0, repMax(s.rep.rank)));
    }

    static #onRepRank(event, target) {
      const s = this.#flags();
      const rank = clampInt(target.dataset.rank, 0, 5);
      return this.#set("rep", { rank, value: Math.min(s.rep.value, repMax(rank)) });
    }

    /** Ромбы напряжения: ЛКМ +1, ПКМ −1 — с переносом 9 → уровень (и обратно). */
    static #onTensionCell(event, target) {
      return this.#applyTension(event.button === 2 ? -1 : 1);
    }

    /** Уровни напряжения вручную: ЛКМ +1 уровень, ПКМ −1 (показатель не трогаем). */
    static #onTensionLevel(event, target) {
      const s = this.#flags();
      const d = event.button === 2 ? -1 : 1;
      return this.#set("tension.level", clampInt(s.tension.level + d, 0, 4));
    }

    /** Кнопка «0»: сбросить уровень напряжения (показатель не трогаем, как и у кнопок 1–4). */
    static #onTensionZero(event, target) {
      return this.#set("tension.level", 0);
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

    /** Тушь / Смог — выбор запоминается для этого браузера; перерисовываются все открытые листы. */
    static async #onTheme(event, target) {
      await game.settings.set(MODULE_ID, "theme", target.dataset.theme);
    }

    /** Загрузка снаряжения: ЛКМ — тяжелее, ПКМ — легче, по кругу. */
    static #onLoad(event, target) {
      const step = loadStep(this.actor.system?.GEAR?.LOAD?.selected, event.button === 2 ? -1 : 1);
      return this.actor.update({
        "system.GEAR.LOAD.selected": step.selected,
        "system.GEAR.LOAD.max": step.max,
        "system.GEAR.LOAD.desc": game.i18n.localize(step.key),
      });
    }

    /** Открыть досье системы (там же старые заметки 1.05) — через родное действие листа. */
    static #onNotes(event, target) {
      const action = this.options.actions.openNotes;
      const handler = typeof action === "function" ? action : action?.handler;
      return handler?.call(this, event, target);
    }
  };
}
