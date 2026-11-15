import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import Handlebars from "handlebars";
import {
  pinnedClocks, LAYOUTS, MAX_SLOTS, layoutOf, readTable, pinOf, thread, boardView, stressView, tableRunners, addableRunners,
  jobScenes, lastScene, sceneName, readBgView, bgCss, bgPan, bgZoom, coverSize, BG_DEFAULT, nextSkin, skinLabel,
} from "../scripts/job-logic.mjs";

const STAGE = { w: 1920, h: 1080 };
const RIGHT_COL = 1420; // правая колонка «Рискари в деле» и «Часы»

test("три раскладки: слоты внутри доски, левее правой колонки, нити — между существующими слотами", () => {
  assert.deepEqual(LAYOUTS.map((l) => l.id), ["six", "four", "nine"]);
  assert.deepEqual(LAYOUTS.map((l) => l.slots.length), [6, 4, 9]);
  assert.equal(MAX_SLOTS, 9);
  for (const l of LAYOUTS) {
    for (const s of l.slots) {
      assert.ok(s.x >= 72 && s.x + s.w + 16 <= RIGHT_COL, `${l.id}: слот по ширине`);
      assert.ok(s.y >= 150 && s.y + s.h + 56 <= 830, `${l.id}: слот по высоте (под шапкой, над часами внизу — полоса часов в полтора раза выше)`);
    }
    for (const [a, b] of l.links) assert.ok(l.slots[a - 1] && l.slots[b - 1] && a !== b, `${l.id}: нить ${a}–${b}`);
  }
  assert.equal(layoutOf("nope").id, "six");
});

test("данные стола: мусор → безопасные значения, слоты не теряются при смене раскладки", () => {
  const t = readTable({ layout: "four", slots: [{ img: " a.webp ", caption: "  Серьга   у байка " }, null, { img: 5 }], runners: ["x", "x", 3, "y"], clocks: "z", side: "none" });
  assert.equal(t.layout, "four");
  assert.equal(t.slots.length, MAX_SLOTS);
  assert.deepEqual(t.slots[0], { img: "a.webp", caption: "Серьга у байка", clock: "" });
  assert.deepEqual(t.slots[2], { img: "", caption: "", clock: "" });
  assert.deepEqual(t.runners, ["x", "y"]);
  assert.deepEqual(t.clocks, []);
  assert.equal(t.side, "none");
  assert.equal(readTable(null).layout, "six");
  assert.equal(readTable({ slots: [{ caption: "x".repeat(200) }] }).slots[0].caption.length, 80);
});

test("часы на фото: только у слотов с фото в текущей раскладке; две горизонтальных в «Шести» — крупно", () => {
  const raw = { layout: "four", clocks: ["c1"], slots: [{ img: "a.webp", clock: "c1" }, { clock: "c2" }, null, null, { img: "e.webp", clock: "c5" }] };
  assert.deepEqual([...pinnedClocks(raw)], ["c1"], "без фото и вне раскладки — не на фото");
  const b = boardView(raw, { isGM: true });
  assert.equal(b.slots[0].clock, "c1");
  assert.equal(b.slots[1].clock, "", "пустой слот — без часов");
  assert.ok(b.slots.every((s) => s.badge >= 72 && s.badge <= 120));
  const six = layoutOf("six").slots;
  assert.ok(six[4].w >= 600 && six[4].h >= 280 && six[5].w >= 460 && six[5].h >= 280, "5 и 6 — вдвое крупнее");
  assert.ok(six[4].x + six[4].w + 16 < six[5].x, "крупные не наезжают друг на друга");
  for (const s of six.slice(0, 4)) assert.ok(s.y + s.h + 56 < six[4].y, "верхний ряд — над крупными");
});

test("нить: от булавки к булавке, длина и угол", () => {
  const a = { x: 0, y: 100, w: 184 }, b = { x: 300, y: 400, w: 184 };
  assert.deepEqual(pinOf(a), { x: 100, y: 100 });
  const t = thread(a, b);
  assert.equal(t.x, 100);
  assert.equal(t.y, 100);
  assert.equal(t.len, Math.round(Math.hypot(300, 300) * 10) / 10);
  assert.equal(t.deg, 45);
});

test("доска: мастер видит все слоты, игрок — только с фото; нить — только между видимыми", () => {
  const raw = { layout: "six", slots: [{ img: "1.webp" }, { img: "2.webp" }, {}, {}, { img: "5.webp", caption: "Мойка" }, {}] };
  const gm = boardView(raw, { isGM: true });
  assert.equal(gm.slots.length, 6);
  assert.equal(gm.threads.length, 5);
  assert.ok(gm.slots.every((s) => s.showCaption), "мастеру — «+ подпись» везде");
  const pl = boardView(raw, { isGM: false });
  assert.deepEqual(pl.slots.map((s) => s.n), [1, 2, 5]);
  assert.deepEqual(pl.threads.map((t) => [t.a, t.b]), [[1, 2], [2, 5]]);
  assert.deepEqual(pl.slots.map((s) => s.showCaption), [false, false, true]);
  assert.equal(pl.pins.length, 3);
  const four = boardView({ ...raw, layout: "four" }, { isGM: false });
  assert.deepEqual(four.slots.map((s) => s.n), [1, 2], "фото из слота 5 спрятано, пока раскладка на 4");
});

test("стресс: клетки при разумном максимуме, иначе число", () => {
  const s = stressView(3, 9);
  assert.equal(s.pips.length, 9);
  assert.equal(s.pips.filter((p) => p.on).length, 3);
  assert.equal(s.text, "3/9");
  assert.deepEqual(stressView(4, 0), { pips: [], text: "4" });
  assert.equal(stressView("x", 20).text, "0/20");
});

test("рискари в деле и кого добавить: только действующие, без уже добавленных, по рангу и делам", () => {
  const rows = [
    { id: "b", name: "Бланк", status: "active", rank: 1, dela: 3 },
    { id: "r", name: "Реймонд", status: "active", rank: 2, dela: 1 },
    { id: "n", name: "Никто", status: "active", rank: 1, dela: 5 },
    { id: "z", name: "Зулейка", status: "waiting", rank: 3, dela: 9 },
    { id: "d", name: "Рентген", status: "dead", rank: 4, dela: 9 },
  ];
  const t = { runners: ["n", "gone", "b"] };
  assert.deepEqual(tableRunners(t, rows).map((r) => r.name), ["Никто", "Бланк"]);
  assert.deepEqual(addableRunners(t, rows).map((r) => r.name), ["Реймонд"]);
  assert.deepEqual(addableRunners({}, rows).map((r) => r.name), ["Реймонд", "Никто", "Бланк"]);
});

test("сцены дела: по порядку, «На дело» — последняя посещённая, имена", () => {
  const list = [
    { id: "s2", name: "Дело: Мойка — 2", sort: 200, table: { job: "j1", at: 50 } },
    { id: "s1", name: "Дело: Мойка", sort: 100, table: { job: "j1", at: 90 } },
    { id: "s3", name: "Дело: Другое", sort: 50, table: { job: "j2", at: 999 } },
  ];
  const mine = jobScenes(list, "j1");
  assert.deepEqual(mine.map((s) => [s.id, s.n]), [["s1", 1], ["s2", 2]]);
  assert.equal(lastScene(mine).id, "s1");
  assert.equal(lastScene([]), null);
  assert.deepEqual(jobScenes(list, ""), []);
  assert.equal(sceneName("МОЙКА"), "Дело: МОЙКА");
  assert.equal(sceneName("МОЙКА", 1), "Дело: МОЙКА — 2");
});

test("шаблон стола: кнопки мастера, игрок без кнопок, пустые слоты, пикеры", () => {
  const C = (f) => Handlebars.compile(readFileSync(new URL(`../templates/${f}`, import.meta.url), "utf8"));
  const tpl = C("job.hbs");
  const raw = { layout: "six", slots: [{ img: "a.webp", caption: "Серьга" }, { img: "b.webp" }] };
  const base = {
    layout: { scale: 1, left: 0, top: 0 }, bg: "bg.webp", logo: "fig.webp", side: "side.webp", corner: "corner.webp",
    job: { linked: true, name: "МОЙКА", meta: "Серьга · [место]", reward: "20 ч · 1 р", chips: [{ label: "0", tone: "low" }] },
    runners: { list: [{ id: "b", name: "Бланк", initial: "Б", rankText: "1", img: "blank.webp", stress: stressView(2, 9) }, { id: "n", name: "Никто", initial: "Н", rankText: "0", stress: stressView(1, 0) }], addable: [], open: false },
    clocks: { list: [{ id: "c", name: "Облава", src: "c.webp", value: 2, size: 6, canStep: true }], choices: [], open: false, show: true },
    scenes: [], hasHall: true, skinLabel: "Смог", bgv: bgCss(BG_DEFAULT),
  };
  const gm = tpl({ ...base, isGM: true, board: boardView(raw, { isGM: true }) });
  assert.equal((gm.match(/data-job="photo-pick"/g) ?? []).length, 6, "2 «Заменить» + 4 «Добавить фото»");
  assert.equal((gm.match(/Добавить фото/g) ?? []).length, 4);
  assert.equal((gm.match(/data-job="caption"/g) ?? []).length, 6);
  assert.ok(/data-job="bg"/.test(gm) && /data-job="bg-frame"/.test(gm) && /data-job="hall"/.test(gm) && /data-job="settings"/.test(gm));
  assert.equal((gm.match(/data-job="skin-next"/g) ?? []).length, 1, "оформление — одна кнопка");
  assert.match(gm, /data-job="hide"/, "мастер может скрыть стол");
  assert.ok(!/Серьга · \[место\]|ng-job-meta/.test(gm), "в шапке нет заказчика и места из записи дела (автор, 2026-11-15)");
  assert.ok(!/наведи — арт/.test(gm), "у блока рискарей нет подсказки");
  assert.equal((gm.match(/data-job="photo-clock"/g) ?? []).length, 2, "кнопка «Часы к фото» на каждом фото");
  const pinned = boardView(raw, { isGM: true });
  pinned.slots[0].clockView = { id: "c", name: "Облава", src: "c.webp", value: 2, size: 6, canStep: true };
  const withPin = tpl({ ...base, isGM: true, board: pinned });
  assert.match(withPin, /ng-job-pin-clock[\s\S]*data-job="clock" data-id="c"[\s\S]*photo-clock-clear/, "часы на фото: клик +1, у мастера — открепить");
  assert.match(gm, /class="ng-job-corner" src="corner.webp"/, "арт справа внизу");
  assert.match(gm, /class="ng-job-clockbar"[\s\S]*Облава/, "часы — внизу по центру");
  assert.ok(gm.indexOf("ng-job-clockbar") > gm.indexOf("ng-job-side-col"), "часы не в правой колонке");
  assert.match(gm, /fa-palette"><\/i> Смог/);
  assert.match(gm, /class="ng-job-bg"[^>]*width: 100%; height: 100%; left: 0%; top: 0%; object-position: 50% 40%/);
  assert.ok(/data-job="runners-pick"/.test(gm) && /data-job="clocks-pick"/.test(gm) && /data-job="runner-remove"/.test(gm));
  assert.ok(/МОЙКА/.test(gm) && /20 ч · 1 р/.test(gm));
  const pl = tpl({ ...base, isGM: false, board: boardView(raw, { isGM: false }) });
  assert.ok(!/photo-pick|photo-clear|data-job="bg"|bg-frame|data-job="hide"|data-job="settings"|runners-pick|clocks-pick|runner-remove|clock-remove|data-job="caption"/.test(pl), "у игрока нет кнопок мастера");
  assert.match(pl, /data-job="skin-next"/, "оформление игрок меняет у себя");
  assert.equal((pl.match(/data-job="photo"/g) ?? []).length, 2);
  assert.ok(/<figcaption class="ng-job-caption">Серьга<\/figcaption>/.test(pl));
  assert.equal((pl.match(/ng-job-thread/g) ?? []).length, 1, "нить 1–2");
  assert.equal((pl.match(/class="ng-job-tape"/g) ?? []).length, 2, "фото на скотче, как в холле");
  assert.ok(!/ng-job-pin/.test(gm), "булавок нет");
  assert.match(pl, /data-art="blank.webp" data-art-name="Бланк"/, "наведение — крупный арт");
  assert.equal((pl.match(/data-art=/g) ?? []).length, 1, "без портрета — без арта");
  assert.match(pl, /<b>1<\/b>/, "стресс без максимума — числом");
  const open = tpl({ ...base, isGM: true, board: boardView(raw, { isGM: true }), runners: { ...base.runners, open: true, addable: [{ id: "r", name: "Реймонд", initial: "Р", rankText: "2" }] } });
  assert.ok(/data-job="runner-add" data-id="r"/.test(open));
  const none = tpl({ ...base, isGM: true, board: boardView(raw, { isGM: true }), runners: { list: [], addable: [], open: true } });
  assert.ok(/Все действующие уже в деле/.test(none) && /В деле пока никого/.test(none));
  const noClocks = tpl({ ...base, isGM: false, board: boardView(raw), clocks: { list: [], choices: [], open: false, show: false } });
  assert.ok(!/ng-job-clockbar/.test(noClocks), "у игрока без часов — полосы нет");
  const sc = tpl({ ...base, isGM: false, board: boardView(raw), scenes: [{ id: "1", n: 1, name: "a", current: true }, { id: "2", n: 2, name: "b" }] });
  assert.equal((sc.match(/data-job="scene"[^>]*disabled/g) ?? []).length, 2, "игрок видит номер сцены, но не переключает");
});

test("окно стола и кнопка «На дело» в холле", () => {
  const C = (f) => Handlebars.compile(readFileSync(new URL(`../templates/${f}`, import.meta.url), "utf8"));
  const admin = C("job-admin.hbs")({ sceneName: "Дело: МОЙКА", jobs: [{ id: "j", name: "МОЙКА", on: true }], layouts: LAYOUTS.map((l) => ({ ...l, count: l.slots.length, on: l.id === "six" })), backdrops: [{ src: "a", label: "A", on: true }], logo: "f", side: "s", scenes: [{ id: "x", n: 1, name: "Дело: МОЙКА", current: true }], filled: 2 });
  assert.ok(/Шесть фото · 6/.test(admin) && /Четыре крупных · 4/.test(admin) && /Девять мелких · 9/.test(admin));
  assert.ok(/data-action="ngNewScene"/.test(admin));
  assert.ok(/Это окно — для сцены дела/.test(C("job-admin.hbs")({ none: true })));
  const board = C("hall-board.hbs");
  const job = { id: "j1", name: "МОЙКА", tone: "low", chips: [], unknown: true, reward: "", meta: "" };
  const items = { jobs: { items: [job] } };
  assert.ok(/data-hall="go" data-id="j1"/.test(board({ ...items, isGM: true })));
  assert.ok(!/data-hall="go"/.test(board({ ...items, isGM: false })));
});

test("кадр задника: CSS без размера картинки, тянуть мышкой, приближение", () => {
  assert.deepEqual(readBgView({ x: 2, y: -1, z: 9 }), { x: 1, y: 0, z: 4 });
  assert.deepEqual(readBgView(null), BG_DEFAULT);
  assert.deepEqual(bgCss({ x: 0.5, y: 0.4, z: 1 }), { w: 100, h: 100, left: 0, top: 0, pos: "50% 40%" });
  const c = bgCss({ x: 0.25, y: 1, z: 2 });
  assert.deepEqual([c.w, c.left, c.top, c.pos], [200, -25, -100, "25% 100%"]);
  // левый край картинки = (W − ширина)·x — и при приближении
  const W = 960, H = 540, nw = 2000, nh = 1000;
  const v = { x: 0.3, y: 0.5, z: 1.5 };
  const size = coverSize(nw, nh, W, H, v.z);
  const css = bgCss(v);
  const box = { w: W * css.w / 100, left: W * css.left / 100 };
  const inner = coverSize(nw, nh, box.w, H * css.h / 100, 1);
  assert.ok(Math.abs(box.left + (box.w - inner.w) * v.x - (W - size.w) * v.x) < 0.01);
  // высокая картинка в широкой рамке: по x запаса нет — стоит, по y едет за мышкой
  const tall = bgPan({ x: 0.5, y: 0.5, z: 1 }, 100, 100, 928, 1232, W, H);
  assert.equal(tall.x, 0.5);
  assert.ok(tall.y < 0.5, "тянем вниз — картинка едет вниз, кадр уходит вверх");
  assert.equal(bgPan({ x: 0, y: 0, z: 1 }, 500, 500, 928, 1232, W, H).y, 0, "упирается в край");
  assert.equal(bgZoom({ x: 0.5, y: 0.5, z: 1 }, 0.2).z, 1);
});

test("оформление по кругу: Тушь → Смог → Кислота → Классика → Тушь", () => {
  assert.deepEqual(["tush", "smog", "acid", "classic", "auto"].map(nextSkin), ["smog", "acid", "classic", "tush", "tush"]);
  assert.equal(skinLabel("acid"), "Кислота");
});

test("окно кадра задника компилируется", () => {
  const C = (f) => Handlebars.compile(readFileSync(new URL(`../templates/${f}`, import.meta.url), "utf8"));
  const html = C("job-frame.hbs")({ src: "bg.webp", css: bgCss(BG_DEFAULT), zoomPct: 100, zoomMin: 100, zoomMax: 400, ghosts: [{ x: 1, y: 2, w: 3, h: 4, rot: 5 }] });
  assert.match(html, /data-action="ngBgSave"/);
  assert.match(html, /class="ng-job-bgcrop-zoom" min="100" max="400"/);
  const adm = C("job-admin.hbs")({ layouts: [], backdrops: [], scenes: [] });
  assert.match(adm, /data-action="ngFrame"/);
  assert.match(adm, /data-action="ngHidden"/);
  assert.match(adm, /data-key="corner"/);
});

test("арты стола на месте", () => {
  for (const f of ["figure.webp", "side.webp", "corner.webp", "backdrops/stilts.webp", "backdrops/round.webp", "backdrops/stairs.webp", "backdrops/floors.webp", "backdrops/arches.webp", "backdrops/tunnel.webp"]) {
    assert.ok(existsSync(new URL(`../art/job/${f}`, import.meta.url)), f);
  }
});
