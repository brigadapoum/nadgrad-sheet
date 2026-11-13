import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import {
  rankLevel, rankTone, formatReward, readJob, jobView, boardJobs, page, ring, turn, syncPlan,
  normName, campaignStatus, runnerViews, countBy, fitStage, zaslonOf, newsViews, JOBS_PAGE, RUNNERS_PAGE,
} from "../scripts/hall-logic.mjs";

const DATA = JSON.parse(readFileSync(new URL("../data/jobs.json", import.meta.url), "utf8"));
const ROSTER = JSON.parse(readFileSync(new URL("../data/roster.json", import.meta.url), "utf8")).roster;
const NEWS = JSON.parse(readFileSync(new URL("../data/news.json", import.meta.url), "utf8")).news;

test("ранги препятствий и цвета плашек", () => {
  assert.deepEqual(["0", "I", "ii", "III", "IV", "V", "VI+", "VI", "x"].map(rankLevel), [0, 1, 2, 3, 4, 5, 6, 6, null]);
  assert.deepEqual([0, 1, 2, 3, 4, 6, null].map(rankTone), ["low", "low", "mid", "mid", "high", "high", "none"]);
});

test("награда: «50 ч., 4 р.» → «50 ч · 4 р»", () => {
  assert.equal(formatReward("50 ч., 4 р."), "50 ч · 4 р");
  assert.equal(formatReward("25+ ч., 2 р."), "25+ ч · 2 р");
  assert.equal(formatReward("18 ч., 1 р. "), "18 ч · 1 р");
});

test("таблица Notion: 11 дел с ключами страниц, «Весна народов» в игре", () => {
  assert.equal(DATA.jobs.length, 11);
  assert.ok(DATA.jobs.every((j) => /^[0-9a-f]{32}$/.test(j.key)));
  assert.equal(DATA.jobs.find((j) => j.name === "ВЕСНА НАРОДОВ").status, "playing");
  assert.deepEqual(DATA.jobs.find((j) => j.name === "МЕЖДУ МОЛОТОМ И НАКОВАЛЬНЕЙ").obstacles, []);
  assert.ok(DATA.jobs.every((j) => j.html.startsWith("<p>")));
});

test("карточка дела: мета, плашки, тон по старшему рангу, «неизвестно»", () => {
  const v = jobView(DATA.jobs.find((j) => j.name === "«АРМЕЙСКАЯ» ОПЕРАЦИЯ"), { id: "x" });
  assert.equal(v.meta, "Делимер · Цепь-1");
  assert.deepEqual(v.chips.map((c) => c.tone), ["mid", "mid", "high"]);
  assert.equal(v.tone, "high");
  assert.equal(v.reward, "27 ч · 2 р");
  const u = jobView(DATA.jobs[0]);
  assert.ok(u.unknown);
  assert.equal(u.tone, "none");
});

test("доска: без закрытых, по порядку из Notion; страницы по 6", () => {
  const list = DATA.jobs.map((job, i) => ({ id: `j${i}`, job: i === 2 ? { ...job, status: "closed" } : job }));
  const b = boardJobs([...list].reverse());
  assert.equal(b.length, 10);
  assert.equal(b[0].job.name, DATA.jobs[0].name);
  const p1 = page(b, 0, JOBS_PAGE);
  assert.deepEqual([p1.from, p1.to, p1.total, p1.canPrev, p1.canNext], [1, 6, 10, false, true]);
  const p2 = page(b, turn(0, 1, JOBS_PAGE, 10), JOBS_PAGE);
  assert.deepEqual([p2.from, p2.to, p2.canNext], [5, 10, false], "последняя страница прижата к концу");
  assert.equal(page(b, 99, JOBS_PAGE).offset, 4);
  assert.equal(turn(4, -1, JOBS_PAGE, 10), 0);
  assert.ok(!page(b.slice(0, 3), 0, JOBS_PAGE).paged);
});

test("синхронизация с Notion: новые, правки, закрытое мастером не открывается, пропавшие — в архив", () => {
  const [a, b, c] = DATA.jobs;
  const world = [
    { id: "wa", job: { ...a, reward: "1 ч., 0 р." } },
    { id: "wb", job: { ...b, status: "closed" } },
    { id: "wz", job: { key: "gone", name: "СТАРОЕ", status: "open" } },
    { id: "wy", job: { key: "old", name: "ДАВНО ЗАКРЫТО", status: "closed" } },
  ];
  const plan = syncPlan(world, [a, b, c]);
  assert.deepEqual(plan.create.map((j) => j.key), [c.key]);
  assert.deepEqual(plan.update.map((u) => u.id), ["wa"], "b не меняется: закрыто мастером и совпадает");
  assert.equal(plan.update[0].job.reward, a.reward);
  assert.deepEqual(plan.close, ["wz"]);
  const again = syncPlan([{ id: "wb", job: { ...b, status: "closed", place: "где-то" } }], [b]);
  assert.equal(again.update[0].job.status, "closed");
});

test("статус в кампании: флаг мастера → база Notion с прозвищами → нет", () => {
  assert.equal(normName("Сима «Эхо Банши»"), "сима эхо банши");
  assert.equal(campaignStatus("Клемм", undefined, ROSTER), "active", "Ржавый = Клемм");
  assert.equal(campaignStatus("Реймонд", undefined, ROSTER), "active", "Коль = Реймонд");
  assert.equal(campaignStatus("Сима", undefined, ROSTER), "active");
  assert.equal(campaignStatus("Рика", undefined, ROSTER), "active");
  assert.equal(campaignStatus("Жёлтая", undefined, ROSTER), "active");
  assert.equal(campaignStatus("Зулейка", undefined, ROSTER), "waiting");
  assert.equal(campaignStatus("Флоренс", undefined, ROSTER), "dead");
  assert.equal(campaignStatus("Зулейка", "active", ROSTER), "active", "мастер важнее базы");
  assert.equal(campaignStatus("Незнакомец", undefined, ROSTER), null);
  const rows = [
    { id: "1", name: "Яблоко", status: "active", rank: 0 },
    { id: "2", name: "Али Кан", status: "active", rank: null },
    { id: "3", name: "Юджи", status: "waiting", rank: 0 },
    { id: "4", name: "Скрытый", status: "off", rank: 1 },
  ];
  assert.deepEqual(runnerViews(rows).map((r) => r.name), ["Яблоко", "Али Кан"], "ранг 0 выше, чем «ранг ?»");
  assert.equal(runnerViews(rows)[1].rankText, "?");
  const st = [
    { name: "Б", status: "active", rank: 2, dela: 3 }, { name: "А", status: "active", rank: 2, dela: 3 },
    { name: "В", status: "active", rank: 3, dela: 1 }, { name: "Г", status: "active", rank: 2, dela: 8 },
  ];
  assert.deepEqual(runnerViews(st).map((r) => r.name), ["В", "Г", "А", "Б"], "ранг, потом дела, потом имя");
  assert.deepEqual(countBy(rows), { active: 2, waiting: 1, dead: 0, all: 3 });
  assert.equal(RUNNERS_PAGE, 10);
});

test("раскладка: сцена 1920×1080 вписывается в свободную середину", () => {
  const l = fitStage({ left: 60, top: 0, right: 1620, bottom: 980 });
  assert.equal(l.scale, Math.min(1560 / 1920, 980 / 1080));
  assert.equal(l.left, Math.round(60 + (1560 - 1920 * l.scale) / 2));
  assert.equal(l.top, Math.round((980 - 1080 * l.scale) / 2));
});

test("Заслон и новости", () => {
  assert.equal(zaslonOf("cracks").tone, "mid");
  assert.equal(zaslonOf("чепуха").id, "closed");
  const n = newsViews(["Слух: клан Малев обещает месть", "  ", { text: "ВНИМАНИЕ! Цепи изолированы" }, "Просто новость"]);
  assert.deepEqual(n, [
    { text: "клан Малев обещает месть", tag: "Слух" },
    { text: "Цепи изолированы", tag: "Внимание" },
    { text: "Просто новость", tag: "" },
  ]);
  assert.equal(NEWS.length, 7);
});

test("лента рискарей крутится по кругу по одному", () => {
  const L = Array.from({ length: 14 }, (_, i) => i);
  assert.deepEqual(ring(L, 0, 10).items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(ring(L, 1, 10).items.slice(0, 2), [1, 2]);
  assert.deepEqual(ring(L, 13, 10).items.slice(0, 3), [13, 0, 1], "после последнего — первый");
  assert.equal(ring(L, -1, 10).offset, 13, "назад с начала — в конец");
  assert.ok(ring(L, 0, 10).cyclic);
  const few = ring([1, 2, 3], 2, 10);
  assert.deepEqual([few.items, few.cyclic, few.offset], [[1, 2, 3], false, 0], "мало — не крутится");
  assert.deepEqual(ring([], 5, 10).items, []);
});

test("шаблон холла: доска, крестики мастера, лента, скины, фото, новости", () => {
  const C = (f) => Handlebars.compile(readFileSync(new URL(`../templates/${f}`, import.meta.url), "utf8"));
  const [hall, boardT, stripT] = ["hall.hbs", "hall-board.hbs", "hall-strip.hbs"].map(C);
  const jobs = page(DATA.jobs.map((job, i) => ({ id: `j${i}`, job })), 0, JOBS_PAGE);
  const runners = ring(runnerViews(Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, name: `Р${i}`, status: "active", rank: i % 4, img: i % 2 ? "x.webp" : "" }))), 0, RUNNERS_PAGE);
  const news = newsViews(NEWS.map((n) => n.text));
  const html = (isGM) => hall({
    art: "a", layout: { scale: 0.5, left: 10, top: 20 }, isGM, zaslon: zaslonOf("closed"),
    skins: [{ id: "tush", label: "Тушь", on: false }, { id: "smog", label: "Смог", on: true }],
    photos: [{ file: "p.webp", alt: "фото", w: 100, h: 50, frame: 116, right: 1, top: 2, rot: 3, tape: 4 }],
    boardHtml: boardT({ isGM, jobs: { ...jobs, items: jobs.items.map((x) => jobView(x.job, { id: x.id })) } }),
    stripHtml: stripT({ runners }), news, newsLoop: [...news, ...news], tickerSeconds: 60,
  });
  const gm = html(true), pl = html(false);
  assert.equal((gm.match(/data-hall="job"/g) || []).length, 6);
  assert.equal((gm.match(/data-hall="close"/g) || []).length, 6);
  assert.equal((pl.match(/data-hall="close"/g) || []).length, 0, "игрок не видит крестиков");
  assert.ok(!/data-hall="admin"/.test(pl));
  assert.equal((gm.match(/data-hall="runner"/g) || []).length, 10);
  assert.match(gm, /1–6 из 11/);
  assert.match(gm, /data-hall="runners-next"/);
  assert.ok(!/Вся галерея|клик — лист/.test(gm), "у ленты нет шапки");
  assert.equal((gm.match(/data-hall="skin"/g) || []).length, 2);
  assert.match(gm, /aria-pressed="true">Смог/);
  assert.match(gm, /\? неизвестно/);
  assert.match(gm, /Заслон: закрыт/);
  assert.equal((gm.match(/class="ng-hall-photo"/g) || []).length, 1);
  assert.match(gm, /transform: scale\(0\.5\); left: 10px; top: 20px/);
  const few = stripT({ runners: ring([{ id: "a", name: "А", initial: "А", rankText: "1" }], 0, 10) });
  assert.ok(!/runners-next/.test(few), "один рискарь — без стрелок");
});

test("шаблоны галереи и окна мастера компилируются", () => {
  for (const f of ["hall-gallery.hbs", "hall-admin.hbs"]) {
    const tpl = Handlebars.compile(readFileSync(new URL(`../templates/${f}`, import.meta.url), "utf8"));
    assert.ok(tpl({ filters: [], runners: [], zaslon: [], closed: [] }).length > 50);
  }
});

test("перевод листа: все ключи раннера из словаря системы на месте", () => {
  const ru = JSON.parse(readFileSync(new URL("../lang/cbrpnk-ru.json", import.meta.url), "utf8"));
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  const keys = new Set(flat(ru));
  for (const k of ["RUNNER.STRESS", "Approach.SMART.name", "Skill.RIGGING.HEAVY", "HARM.level_3", "ACTION.part.title", "GEAR.CYBERDECK.name", "LOAD.HEAVY", "WARN.ROLL"]) {
    assert.ok(keys.has(k), k);
  }
  assert.equal(ru.TYPES.Actor.runner, "Рискарь");
});
