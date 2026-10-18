// Передышка на листе рискаря: броски, окна «было → станет», запись в журнал и в чат.
// Чистая логика — scripts/downtime-logic.mjs; здесь — Foundry (кубы, чат, окна, обновления актёра).
import { MODULE_ID, readState, readProjects, clampInt, newId } from "./logic.mjs";
import {
  ACTIONS, actionById, CLINICS, DOC_RANK_DEFAULT, HEAL_CLOCK, poolOf, readDowntime, budget, newDowntime,
  outcome, applyPlan, heal3Plan, buyPlan, buyEntry, newEntry, entryLine, downtimeContext, lastContext, TIERS, valueText,
} from "./downtime-logic.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const loc = (k, fb) => { try { const v = game.i18n.localize(k); return v && v !== k ? v : fb; } catch { return fb; } };
const CLOCK_TYPE = `${MODULE_ID}.clock`;

// ---------- снимок актёра ----------

function harmOf(actor) {
  const h = actor.system?.HARM ?? {};
  return {
    medium: { first: String(h.medium?.first?.name ?? "").trim(), second: String(h.medium?.second?.name ?? "").trim() },
    hard: String(h.hard?.name ?? "").trim(),
  };
}

function clocksFor(user) {
  return (game.actors?.contents ?? [])
    .filter((a) => a.type === CLOCK_TYPE && (a.isOwner || a.testUserPermission?.(user, "OWNER")))
    .map((a) => ({ id: a.id, name: a.name, size: Number(a.system?.size) || 8, value: Number(a.system?.value) || 0 }));
}

export function snapshot(actor) {
  const flags = actor.flags?.[MODULE_ID];
  const s = readState(flags);
  return {
    cheki: s.cheki,
    tension: s.tension,
    rank: s.rep.rank,
    stress: { value: Number(actor.system?.stress?.value) || 0, max: Number(actor.system?.stress?.max) || 0 },
    projects: readProjects(flags),
    heal: readDowntime(flags).heal,
    harm: harmOf(actor),
    clocks: clocksFor(game.user),
  };
}

// ---------- черновик карточки ----------

function draftOf(sheet) {
  sheet._ngDt ??= { open: null, note: "", approach: "", skill: "", target: "", doc: DOC_RANK_DEFAULT, repeat: false, contraband: false, cheki: 0, clinic: "c1", price: null, priceNote: "" };
  return sheet._ngDt;
}

function approaches(actor, current) {
  const ap = actor.system?.approach ?? {};
  return Object.keys(ap).map((id) => ({ id, label: loc(`Approach.${id}.name`, id), dice: Number(ap[id]?.dice) || 0, on: id === current }));
}
function skills(actor, current) {
  const sk = actor.system?.skills ?? {};
  return Object.keys(sk).map((id) => ({ id, label: loc(`Skill.${id}.name`, id), dice: Number(sk[id]?.dice) || 0, on: id === current }));
}

/** Подход и навык по умолчанию — те, что выбраны на листе (или первые по списку). */
function ensureSkill(sheet) {
  const d = draftOf(sheet);
  const sys = sheet.actor.system ?? {};
  if (!d.approach || !sys.approach?.[d.approach]) d.approach = (sys.approach?.[sys.roll?.approach] && sys.roll.approach) || Object.keys(sys.approach ?? {})[0] || "";
  if (!d.skill || !sys.skills?.[d.skill]) d.skill = (sys.skills?.[sys.roll?.skill] && sys.roll.skill) || Object.keys(sys.skills ?? {})[0] || "";
  return d;
}

/** Пул для броска открытой карточки: { count, lowest, text, n } или { error }. */
export function poolFor(sheet, kind) {
  const a = actionById(kind);
  const d = ensureSkill(sheet);
  const actor = sheet.actor;
  if (a.roll === "skill") {
    const ap = actor.system?.approach?.[d.approach];
    const sk = actor.system?.skills?.[d.skill];
    if (!ap) return { error: "Выбери подход." };
    if (!sk) return { error: "Выбери навык." };
    const n = Math.min(6, (Number(ap.dice) || 0) + (Number(sk.dice) || 0));
    return { ...poolOf(n), n, text: `${loc(`Approach.${d.approach}.name`, d.approach)} + ${loc(`Skill.${d.skill}.name`, d.skill)}` };
  }
  if (a.roll === "rank") {
    const s = readState(actor.flags?.[MODULE_ID]);
    const n = Math.min(6, s.rep.rank + (d.repeat ? 1 : 0));
    return { ...poolOf(n), n, text: `ранг рискаря ${s.rep.rank}${d.repeat ? " + d6 (повторно)" : ""}` };
  }
  if (a.roll === "doc") {
    const r = clampInt(d.doc ?? DOC_RANK_DEFAULT, 0, 6);
    return { ...poolOf(r), n: r, text: `ранг дока ${r}` };
  }
  return { error: "Это действие без броска." };
}

const poolLabel = (p) => (p.error ? p.error : p.lowest ? `Пул 2d6, берётся худший — ${p.text}` : `Пул ${p.count}d6 — ${p.text}`);

/** Контекст открытой карточки. */
export function cardContext(sheet, snap) {
  const d = draftOf(sheet);
  const a = actionById(d.open);
  if (!a) return null;
  const actor = sheet.actor;
  ensureSkill(sheet);
  const ctx = {
    draft: d, ask: a.ask ?? null, roll: !!a.roll,
    isSkill: a.roll === "skill", isRank: a.roll === "rank", isDoc: a.roll === "doc",
    isProject: a.id === "project", isClock: a.id === "negclock", isRecord: a.id === "record", isHeal3: a.id === "heal3",
    rank: snap.rank,
  };
  if (ctx.isSkill) { ctx.approaches = approaches(actor, d.approach); ctx.skills = skills(actor, d.skill); }
  if (ctx.isProject) {
    if (!snap.projects.some((p) => p.id === d.target)) d.target = snap.projects[0]?.id ?? "";
    ctx.projects = snap.projects.map((p) => ({ ...p, on: p.id === d.target }));
  }
  if (ctx.isClock) {
    if (!snap.clocks.some((c) => c.id === d.target)) d.target = snap.clocks[0]?.id ?? "";
    ctx.clocks = snap.clocks.map((c) => ({ ...c, on: c.id === d.target }));
  }
  if (ctx.isDoc) {
    const harms = ["first", "second"].filter((s) => snap.harm.medium[s]).map((slot) => ({ slot, name: snap.harm.medium[slot], heal: snap.heal[slot] }));
    if (!harms.some((h) => h.slot === d.target)) d.target = harms[0]?.slot ?? "";
    ctx.harms = harms.map((h) => ({ ...h, on: h.slot === d.target }));
  }
  if (ctx.isHeal3) {
    ctx.hard = snap.harm.hard;
    ctx.clinics = CLINICS.map((c) => ({ ...c, on: c.id === d.clinic }));
    ctx.price = d.price;
    ctx.priceNote = d.priceNote;
  }
  if (ctx.roll) ctx.poolText = poolLabel(poolFor(sheet, a.id));
  const dt = readDowntime(actor.flags?.[MODULE_ID]);
  const last = [...dt.log].reverse().find((e) => e.kind === a.id && e.dice?.length);
  ctx.last = last && last.id === sheet._ngDtLast ? lastContext(last) : last && last.status === "pending" ? lastContext(last) : null;
  return ctx;
}

/** Всё для шаблона вкладки. */
export function breatherContext(sheet) {
  const snap = snapshot(sheet.actor);
  const dt = readDowntime(sheet.actor.flags?.[MODULE_ID]);
  const names = Object.fromEntries([...snap.projects.map((p) => [p.id, p.name]), ...snap.clocks.map((c) => [c.id, c.name])]);
  const ctx = downtimeContext(dt, { open: draftOf(sheet).open, names });
  ctx.card = cardContext(sheet, snap);
  ctx.res = { cheki: snap.cheki, tension: snap.tension, stress: snap.stress.max ? `${snap.stress.value}/${snap.stress.max}` : String(snap.stress.value), rank: snap.rank };
  return ctx;
}

/** Поля карточки не в форме актёра: значения — в черновик, форма не отправляется. */
export function wireBreather(sheet) {
  const box = sheet.element?.querySelector?.(".ng-breather");
  if (!box || box.dataset.ngWired) return;
  box.dataset.ngWired = "1";
  const save = (el) => {
    const d = draftOf(sheet);
    const key = el.dataset.dt;
    if (el.type === "checkbox") d[key] = el.checked;
    else if (el.type === "number") d[key] = Number(el.value) || 0;
    else d[key] = el.value;
    if (key === "clinic") { d.price = null; d.priceNote = ""; }
    if (key === "repeat" || key === "doc" || key === "approach" || key === "skill") {
      const hint = box.querySelector(".ng-dt-act.open .ng-tool .ng-hint");
      const a = actionById(d.open);
      if (hint && a?.roll) hint.textContent = poolLabel(poolFor(sheet, a.id));
    }
  };
  for (const ev of ["input", "change"]) {
    box.addEventListener(ev, (e) => {
      const el = e.target?.closest?.("[data-dt]");
      if (!el) return;
      e.stopPropagation();
      save(el);
    });
  }
}

// ---------- окна ----------

function linesHtml(lines) {
  return `<div class="ng-dt-dlg">${lines.map((l) => `<div class="ng-dt-dlg-row"><span>${esc(l.label)}</span><b>${esc(l.from)}</b><i>→</i><b class="to">${esc(l.to)}</b></div>`).join("")}</div>`;
}

/** Окно «было → станет». extra — галочка с дополнительным изменением. → { ok, extra } */
export async function confirmChange(title, { intro = "", lines = [], extra = null, ok = "Применить", note = "" } = {}) {
  const D = foundry.applications.api.DialogV2;
  const content = `${intro ? `<p>${intro}</p>` : ""}${linesHtml(lines)}${extra ? `<label class="ng-dt-dlg-extra"><input type="checkbox" name="extra" ${extra.checked ? "checked" : ""}> <span>${esc(extra.label)}${extra.from ? ` (${esc(extra.from)} → ${esc(extra.to)})` : ""}</span></label>` : ""}${note ? `<p class="ng-dt-dlg-note">${note}</p>` : ""}`;
  const res = await D.wait({
    window: { title },
    classes: ["nadgrad", "ng-dt-dialog"],
    content,
    rejectClose: false,
    buttons: [
      { action: "ok", label: ok, default: true, callback: (event, button) => ({ ok: true, extra: !!button.form?.elements?.extra?.checked }) },
      { action: "no", label: "Не сейчас" },
    ],
  });
  return res && typeof res === "object" ? res : { ok: false, extra: false };
}

async function chat(actor, html, roll = null) {
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: html,
    ...(roll ? { rolls: [roll] } : {}),
  });
}

const chatLine = (cls, title, text) => `<div class="ng-dt-chat ${cls}"><b>${esc(title)}</b><span>${text}</span></div>`;
const TIER_CLASS = ["bad", "consequence", "good", "critical"];
const SIDES = ["one", "two", "three", "four", "five", "six"];

async function rollCard(actor, entry, roll, kindLabel) {
  const o = outcome(entry);
  const dices = entry.dice.map((d) => `<i class="fa-solid fa-dice-${SIDES[d - 1]}"></i>`).join("");
  const dt = readDowntime(actor.flags?.[MODULE_ID]);
  const b = budget(dt);
  const desc = `${entry.note ? `<p>«${esc(entry.note)}»</p>` : ""}<p>Исход по таблице: <b>${esc(o.text)}</b></p>`;
  let content;
  try {
    content = await foundry.applications.handlebars.renderTemplate("systems/CBRPNK/parts/roll-card.hbs", {
      actorType: "runner", class: TIER_CLASS[o.tier], img: actor.img, name: actor.name,
      title: kindLabel, action: TIERS[o.tier].title, dices, desc,
      approach: `Передышка · действие ${b.used} / ${b.total} · ${esc(entry.poolText)}`,
    });
  } catch {
    content = chatLine("roll", `${actor.name} — ${kindLabel}`, `${dices} ${TIERS[o.tier].title} · ${esc(o.text)}`);
  }
  return chat(actor, content, roll);
}

async function evalRoll(formula) {
  const roll = new Roll(formula);
  await roll.evaluate();
  return roll;
}
const diceOf = (roll) => (roll.dice?.[0]?.results ?? roll.terms?.[0]?.results ?? []).map((r) => r.result);

// ---------- запись ----------

function dtOf(sheet) { return readDowntime(sheet.actor.flags?.[MODULE_ID]); }
const dtStore = (dt) => ({ bought: dt.bought, log: dt.log, heal: dt.heal, archive: dt.archive });
async function saveDt(sheet, dt, extra = {}) {
  return sheet.actor.update({ ...extra, [`flags.${MODULE_ID}.downtime`]: dtStore(dt) });
}

async function applyEntry(sheet, id) {
  const actor = sheet.actor;
  const dt = dtOf(sheet);
  const entry = dt.log.find((e) => e.id === id);
  if (!entry || entry.status !== "pending") return false;
  const snap = snapshot(actor);
  const plan = applyPlan(entry, snap);
  if (!plan) return false;
  if (plan.warn) { ui.notifications.warn(plan.warn); return false; }
  const a = actionById(entry.kind);
  const o = outcome(entry);
  const res = await confirmChange(`Применить: ${a.label.toLowerCase()}`, {
    intro: `Бросок: <b>${valueText(o.value)}</b>${entry.bonus ? ` (+${entry.bonus} за чеки)` : ""} · ${TIERS[o.tier].title.toLowerCase()} → <b>${esc(o.text)}</b>.`,
    lines: plan.lines, extra: plan.extra, note: "В чат уйдёт строка «Применено».",
  });
  if (!res.ok) return false;
  const upd = { ...plan.actor };
  if (plan.extra && res.extra) upd[plan.extra.key] = plan.extra.value;
  const fresh = dtOf(sheet);
  const e = fresh.log.find((x) => x.id === id);
  if (!e || e.status !== "pending") return false;
  e.status = "applied";
  if (plan.heal) Object.assign(fresh.heal, plan.heal);
  await saveDt(sheet, fresh, upd);
  if (plan.clock) {
    const c = game.actors.get(plan.clock.id);
    try { await c?.update({ "system.value": plan.clock.value }); } catch (err) { ui.notifications.warn("Счётчик не обновился — его может менять только мастер."); }
  }
  if (plan.done) ui.notifications.info("Проект готов!");
  const extraText = plan.extra && res.extra ? `; ${esc(plan.extra.label)}` : "";
  await chat(actor, chatLine("applied", "Применено", `${esc(actor.name)}: ${plan.lines.map((l) => `${esc(l.label)} ${esc(l.from)} → ${esc(l.to)}`).join("; ")}${extraText}`));
  return true;
}

async function declineEntry(sheet, id, { ask = true } = {}) {
  const D = foundry.applications.api.DialogV2;
  if (ask) {
    const ok = await D.confirm({ window: { title: "Отказаться от результата" }, content: "<p>Результат не применится, в журнале останется зачёркнутым. Действие всё равно потрачено.</p>", rejectClose: false });
    if (!ok) return false;
  }
  const dt = dtOf(sheet);
  const e = dt.log.find((x) => x.id === id);
  if (!e || e.status !== "pending") return false;
  e.status = "declined";
  await saveDt(sheet, dt);
  return true;
}

/** Перед новым броском: прошлый бросок не применён — применить / оставить / отказаться. → false = отмена. */
async function settlePrevious(sheet) {
  const dt = dtOf(sheet);
  const prev = [...dt.log].reverse().find((e) => e.dice?.length);
  if (!prev || prev.status !== "pending") return true;
  const a = actionById(prev.kind);
  const o = outcome(prev);
  const D = foundry.applications.api.DialogV2;
  const choice = await D.wait({
    window: { title: "Прошлый бросок не применён" },
    classes: ["nadgrad", "ng-dt-dialog"],
    content: `<p>${esc(a?.label ?? "")}: <b>${valueText(o.value)} → ${esc(o.text)}</b> — ещё не применён.</p>`,
    rejectClose: false,
    buttons: [
      { action: "apply", label: "Применить его", default: true },
      { action: "keep", label: "Оставить в журнале" },
      { action: "decline", label: "Отказаться" },
      { action: "cancel", label: "Отмена" },
    ],
  });
  if (!choice || choice === "cancel") return false;
  if (choice === "apply") return applyEntry(sheet, prev.id); // не применил (закрыл окно) — новый бросок не делаем
  if (choice === "decline") await declineEntry(sheet, prev.id, { ask: false });
  return true;
}

// ---------- действия листа (this = лист) ----------

export const DT_ACTIONS = {
  ngDtOpen(event, target) {
    const d = draftOf(this);
    const kind = target.dataset.kind;
    d.open = d.open === kind ? null : kind;
    d.note = ""; d.target = ""; d.price = null; d.priceNote = "";
    this._ngDtLast = null;
    return this.render();
  },

  async ngDtBuy(event, target) {
    const kind = target.dataset.kind;
    const snap = snapshot(this.actor);
    const plan = buyPlan(kind, snap);
    if (!plan) return;
    const dt = dtOf(this);
    const b = budget(dt);
    const title = kind === "flash" ? "Флешбек: проверка передышки на деле" : "Купить действие передышки";
    const what = kind === "cheki" ? "5 чеков" : kind === "tension" ? "+2 напряжения" : "5 чеков и +2 напряжения";
    const res = await confirmChange(title, {
      intro: `+1 действие передышки за ${what}.`,
      lines: [...plan.lines, { label: "Действия", from: String(b.left), to: String(b.left + 1) }],
      ok: "Купить",
      note: plan.short ? "<b>Чеков не хватает</b> — уйдёшь в минус." : "",
    });
    if (!res.ok) return;
    const fresh = dtOf(this);
    fresh.bought += 1;
    fresh.log.push(buyEntry({ id: newId(), note: kind === "flash" ? `флешбек · ${what}` : what, at: Date.now() }));
    await saveDt(this, fresh, plan.actor);
    await chat(this.actor, chatLine("buy", "Покупка", `${esc(this.actor.name)}: +1 действие передышки · ${what}`));
  },

  async ngDtRoll() {
    const d = draftOf(this);
    const a = actionById(d.open);
    if (!a?.roll) return;
    const pool = poolFor(this, a.id);
    if (pool.error) return ui.notifications.warn(pool.error);
    if (a.id === "project" && !d.target) return ui.notifications.warn("Выбери проект — или заведи его во вкладке «Проекты».");
    if (a.id === "heal2" && !d.target) return ui.notifications.warn("На листе нет повреждений 2 уровня.");
    if (!a.free && budget(dtOf(this)).left <= 0) return ui.notifications.warn("Действия передышки кончились — купи ещё (5 чеков или +2 напряжения).");
    if (!(await settlePrevious(this))) return;
    if (!a.free && budget(dtOf(this)).left <= 0) return ui.notifications.warn("Действия передышки кончились — купи ещё (5 чеков или +2 напряжения).");
    const roll = await evalRoll(`${pool.count}d6`);
    const snap = snapshot(this.actor);
    const entry = newEntry({
      id: newId(), kind: a.id, dice: diceOf(roll), lowest: pool.lowest, pool: pool.n, poolText: poolLabel(pool),
      note: String(d.note ?? "").trim(), target: d.target || null, rank: snap.rank, contraband: !!d.contraband, at: Date.now(),
    });
    const dt = dtOf(this);
    dt.log.push(entry);
    this._ngDtLast = entry.id;
    await saveDt(this, dt);
    await rollCard(this.actor, entry, roll, a.label);
  },

  async ngDtBonus(event, target) {
    const dt = dtOf(this);
    const e = dt.log.find((x) => x.id === target.dataset.id);
    if (!e || e.status !== "pending") return;
    const before = outcome(e);
    if (before.value >= 7) return;
    const plan = buyPlan("bonus", snapshot(this.actor));
    const after = outcome({ ...e, bonus: e.bonus + 1 });
    const res = await confirmChange("+1 к результату", {
      intro: `Результат ${valueText(before.value)} → ${valueText(after.value)}: «${esc(before.text)}» → «${esc(after.text)}».`,
      lines: plan.lines, ok: "Купить",
      note: plan.short ? "<b>Чеков не хватает</b> — уйдёшь в минус." : "",
    });
    if (!res.ok) return;
    const fresh = dtOf(this);
    const f = fresh.log.find((x) => x.id === e.id);
    if (!f || f.status !== "pending") return;
    f.bonus += 1;
    await saveDt(this, fresh, plan.actor);
    await chat(this.actor, chatLine("buy", "Покупка", `${esc(this.actor.name)}: +1 к результату (${valueText(before.value)} → ${valueText(after.value)}) · 5 чеков`));
  },

  async ngDtQuality(event, target) {
    const dt = dtOf(this);
    const e = dt.log.find((x) => x.id === target.dataset.id);
    if (!e || e.status !== "pending") return;
    const cost = e.kind === "resource" ? 6 : 5;
    const plan = buyPlan("quality", snapshot(this.actor), { qualityCost: cost });
    const before = outcome(e);
    const res = await confirmChange("+1 ранг качества", {
      intro: `Ранг качества ${before.quality} → ${before.quality + 1}.`,
      lines: plan.lines, ok: "Купить",
      note: plan.short ? "<b>Чеков не хватает</b> — уйдёшь в минус." : "",
    });
    if (!res.ok) return;
    const fresh = dtOf(this);
    const f = fresh.log.find((x) => x.id === e.id);
    if (!f || f.status !== "pending") return;
    f.qualityBought = (f.qualityBought ?? 0) + 1;
    await saveDt(this, fresh, plan.actor);
    await chat(this.actor, chatLine("buy", "Покупка", `${esc(this.actor.name)}: +1 ранг качества (${before.quality} → ${before.quality + 1}) · ${cost} чеков`));
  },

  ngDtApply(event, target) { return applyEntry(this, target.dataset.id); },
  ngDtDecline(event, target) { return declineEntry(this, target.dataset.id); },

  async ngDtRecord() {
    const d = draftOf(this);
    const note = String(d.note ?? "").trim();
    if (!note) return ui.notifications.warn("Напиши, что сделал.");
    if (budget(dtOf(this)).left <= 0) return ui.notifications.warn("Действия передышки кончились — купи ещё (5 чеков или +2 напряжения).");
    const snap = snapshot(this.actor);
    const cost = Math.max(0, Math.trunc(Number(d.cheki) || 0));
    const b = budget(dtOf(this));
    const lines = [{ label: "Действия", from: String(b.left), to: String(b.left - 1) }];
    if (cost) lines.push({ label: "Чеки", from: String(snap.cheki), to: String(snap.cheki - cost) });
    const res = await confirmChange("Записать действие передышки", { intro: `«${esc(note)}»`, lines, ok: "Записать" });
    if (!res.ok) return;
    const fresh = dtOf(this);
    fresh.log.push(newEntry({ id: newId(), kind: "record", note: cost ? `${note} · −${cost} чеков` : note, at: Date.now() }));
    await saveDt(this, fresh, cost ? { [`flags.${MODULE_ID}.cheki`]: snap.cheki - cost } : {});
    d.note = ""; d.cheki = 0;
    await chat(this.actor, chatLine("record", "Передышка", `${esc(this.actor.name)}: ${esc(note)}${cost ? ` · −${cost} чеков` : ""}`));
  },

  async ngDtPrice() {
    const d = draftOf(this);
    const c = CLINICS.find((x) => x.id === d.clinic) ?? CLINICS[0];
    if (!snapshot(this.actor).harm.hard) return ui.notifications.warn("На листе нет повреждения 3 уровня.");
    const roll = await evalRoll(c.formula);
    d.price = roll.total;
    d.priceNote = c.note ?? "";
    await chat(this.actor, chatLine("roll", "Экстренная помощь", `${esc(this.actor.name)}: ${esc(c.label)} — ${roll.total} чеков${c.note ? ` ${esc(c.note)}` : ""}`), roll);
    return this.render();
  },

  async ngDtHeal3() {
    const d = draftOf(this);
    if (!d.price && d.price !== 0) return;
    const c = CLINICS.find((x) => x.id === d.clinic) ?? CLINICS[0];
    const snap = snapshot(this.actor);
    const plan = heal3Plan(snap, d.price);
    if (plan.warn) return ui.notifications.warn(plan.warn);
    const res = await confirmChange("Лечение 3 уровня", {
      intro: `${esc(c.label)}: экстренная помощь по прайсу. Действие не тратится.`,
      lines: plan.lines,
      note: plan.short ? "<b>Чеков не хватает</b> — уйдёшь в минус." : "",
    });
    if (!res.ok) return;
    const fresh = dtOf(this);
    Object.assign(fresh.heal, plan.heal);
    fresh.log.push(newEntry({ id: newId(), kind: "heal3", note: `${c.label} · −${d.price} чеков · «${snap.harm.hard}» → 2 уровень`, at: Date.now() }));
    await saveDt(this, fresh, plan.actor);
    const price = d.price;
    d.price = null; d.priceNote = "";
    await chat(this.actor, chatLine("applied", "Применено", `${esc(this.actor.name)}: лечение 3 уровня (${esc(c.label)}) · −${price} чеков · «${esc(snap.harm.hard)}» → 2 уровень`));
  },

  async ngDtNew() {
    const dt = dtOf(this);
    const pending = dt.log.filter((e) => e.status === "pending").length;
    const D = foundry.applications.api.DialogV2;
    const ok = await D.confirm({
      window: { title: "Новая передышка" },
      content: `<p>Снова 2 бесплатных действия, журнал этой передышки уйдёт в архив.</p>${pending ? `<p><b>Не применено: ${pending}</b> — эти результаты пропадут.</p>` : ""}`,
      rejectClose: false,
    });
    if (!ok) return;
    await this.actor.update({ [`flags.${MODULE_ID}.downtime`]: newDowntime(dt, Date.now()) });
    const d = draftOf(this);
    d.open = null;
    this._ngDtLast = null;
  },
};

export { ACTIONS, HEAL_CLOCK, entryLine };
