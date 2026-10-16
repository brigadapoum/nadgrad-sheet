// Токены рискарей: кадр, рамки, список, папка, шаблоны окон.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { JSDOM } from "jsdom";
import {
  TOKEN_VIEW, FRAMES, frameId, defaultCrop, clampCrop, sourceRect, zoomBy, playerRunners,
  originalSrc, tokenUpdate, prototypeUpdate, rowContext, drawToken, tokenDirFor, tokenFileName,
} from "../scripts/tokens-logic.mjs";

const tpl = (n) => Handlebars.compile(readFileSync(new URL(`../templates/${n}`, import.meta.url), "utf8"));
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("рамка по умолчанию — Тушь, неизвестная тоже становится Тушью", () => {
  assert.equal(frameId(undefined), "tush");
  assert.equal(frameId("smog"), "smog");
  assert.equal(frameId("чепуха"), "tush");
  assert.deepEqual(Object.keys(FRAMES), ["tush", "smog", "none"]);
});

test("кадр: квадратная картинка при зуме 1 целиком в окне, сдвигать некуда", () => {
  const r = sourceRect(400, 400, { zoom: 1, x: 50, y: -30 });
  near(r.sx, 0); near(r.sy, 0); near(r.size, 400);
  assert.deepEqual(clampCrop(400, 400, { zoom: 1, x: 50, y: -30 }), { zoom: 1, x: 0, y: 0 });
});

test("кадр: широкая картинка двигается только по горизонтали, в пределах краёв", () => {
  const c = clampCrop(800, 400, { zoom: 1, x: 9999, y: 50 });
  near(c.x, TOKEN_VIEW / 2); // (800·0.8 − 320)/2 = 160
  assert.equal(c.y, 0);
  const r = sourceRect(800, 400, c);
  near(r.sx, 0); near(r.size, 400); // сдвиг вправо до упора — виден левый край
});

test("кадр по умолчанию у высокого портрета — ближе к верху (лицо)", () => {
  const c = defaultCrop(400, 800);
  assert.ok(c.y > 0);
  const r = sourceRect(400, 800, c);
  assert.ok(r.sy < (800 - 400) / 2, "кадр выше центра");
  assert.ok(r.sy >= 0);
  assert.deepEqual(defaultCrop(800, 400), { zoom: 1, x: 0, y: 0 });
});

test("зум: в пределах 1–4, точка под центром остаётся на месте", () => {
  const c = zoomBy(400, 800, { zoom: 1, x: 0, y: 100 }, 2);
  assert.equal(c.zoom, 2);
  near(c.y, 200);
  assert.equal(zoomBy(400, 400, { zoom: 3.9, x: 0, y: 0 }, 2).zoom, 4);
  assert.equal(zoomBy(400, 400, { zoom: 1, x: 0, y: 0 }, 0.5).zoom, 1);
  const r = sourceRect(400, 400, { zoom: 2, x: 0, y: 0 });
  near(r.size, 200); near(r.sx, 100);
});

test("список: только рискари с владельцем-игроком, не мастером; по алфавиту", () => {
  const users = [{ id: "gm", isGM: true }, { id: "p1", isGM: false }, { id: "p2", isGM: false }];
  const actors = [
    { id: "a", type: "runner", name: "Яблоко", ownership: { p1: 3 } },
    { id: "b", type: "runner", name: "Гонг", ownership: { gm: 3, p2: 3 } },
    { id: "c", type: "runner", name: "Мастерский", ownership: { gm: 3, p1: 2 } },
    { id: "d", type: "nadgrad.clock", name: "Часы", ownership: { p1: 3 } },
  ];
  assert.deepEqual(playerRunners(actors, users).map((a) => a.id), ["b", "a"]);
});

test("исходник: сохранённый оригинал главнее уже испечённой картинки", () => {
  assert.equal(originalSrc({ img: "p.jpg", prototypeToken: { texture: { src: "t.jpg" } } }), "t.jpg");
  assert.equal(originalSrc({ img: "p.jpg", prototypeToken: { texture: { src: "baked.webp" } }, flags: { nadgrad: { token: { src: "t.jpg", out: "baked.webp" } } } }), "t.jpg");
  assert.equal(originalSrc({ img: "p.jpg" }), "p.jpg");
});

test("что пишется в токен и в прототип: картинка, масштаб, вписать, кольцо Foundry выключено", () => {
  assert.deepEqual(tokenUpdate("x.webp", 3), { "texture.src": "x.webp", "texture.scaleX": 3, "texture.scaleY": 3, "texture.fit": "contain", "ring.enabled": false });
  assert.equal(prototypeUpdate("x.webp", 2)["prototypeToken.texture.scaleY"], 2);
  assert.equal(tokenUpdate("x.webp", 0)["texture.scaleX"], 1);
});

test("папка: своя из настроек, иначе рядом с картинками мира, внешние ссылки — в папку мира", () => {
  assert.equal(tokenDirFor("media/home/worlds/neon/art/LOG%201/a.jpg", "w1"), "media/home/worlds/neon/nadgrad-tokens");
  assert.equal(tokenDirFor("worlds/w1/art/a.jpg", "w1", "my/dir/"), "my/dir");
  assert.equal(tokenDirFor("https://assets.sqyre.app/worlds/x/a.jpg", "w1"), "worlds/w1/nadgrad-tokens");
  assert.equal(tokenDirFor("icons/svg/mystery-man.svg", "w1"), "worlds/w1/nadgrad-tokens");
  assert.equal(tokenFileName("abc", 123), "abc-123.webp");
});

test("строка списка: «готово» только если на токене стоит испечённая картинка", () => {
  const owners = new Map([["p1", "Лера"]]);
  const a = { id: "a", name: "Кай", img: "p.jpg", ownership: { p1: 3, gm: 3 }, prototypeToken: { texture: { src: "out.webp" } }, flags: { nadgrad: { token: { out: "out.webp", frame: "smog" } } } };
  assert.deepEqual(rowContext(a, owners), { id: "a", name: "Кай", thumb: "out.webp", owners: "Лера", done: true, frame: "Смог" });
  a.prototypeToken.texture.src = "other.jpg"; // кто-то поменял картинку руками
  assert.equal(rowContext(a, owners).done, false);
});

test("отрисовка: круг с картинкой, у Туши — кольцо и линия, без рамки — только круг", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])),
    set: (t, k, v) => { calls.push([`=${String(k)}`, v]); return true; },
  });
  drawToken(ctx, { width: 400, height: 600 }, 512, "tush", { zoom: 1, x: 0, y: 0 });
  const img = calls.find((c) => c[0] === "drawImage");
  assert.equal(img.length, 10);
  assert.ok(calls.some((c) => c[0] === "=fillStyle" && c[1] === FRAMES.tush.ring));
  assert.ok(calls.some((c) => c[0] === "=strokeStyle" && c[1] === FRAMES.tush.line));
  assert.ok(!calls.some((c) => c[0] === "=shadowColor"), "у Туши нет свечения");
  calls.length = 0;
  drawToken(ctx, { width: 400, height: 400 }, 512, "smog", { zoom: 1, x: 0, y: 0 });
  assert.ok(calls.some((c) => c[0] === "=shadowColor"), "у Смога свечение");
  calls.length = 0;
  drawToken(ctx, { width: 400, height: 400 }, 512, "none", { zoom: 1, x: 0, y: 0 });
  assert.ok(!calls.some((c) => c[0] === "stroke" || c[0] === "fill"));
  const dest = calls.find((c) => c[0] === "drawImage");
  near(dest[8], 512 * 0.96); // без рамки картинка во весь круг (2% поля)
});

test("шаблоны окон собираются", () => {
  const list = new JSDOM(tpl("tokens.hbs")({
    rows: [{ id: "a", name: "Кай", thumb: "t.webp", owners: "Лера", done: true, frame: "Тушь" }, { id: "b", name: "Гонг", thumb: "g.jpg", owners: "osya", done: false }],
    todo: 1,
    frames: [{ id: "tush", label: "Тушь", on: true }, { id: "smog", label: "Смог" }, { id: "none", label: "Без рамки" }],
    scale: 3,
  })).window.document;
  assert.equal(list.querySelectorAll(".ng-tk-row").length, 2);
  assert.ok(list.querySelector(".ng-tk-row.done"));
  assert.equal(list.querySelector(".ng-tk-frames .on").textContent, "Тушь");
  assert.equal(list.querySelector("input.ng-tk-scale").value, "3");
  assert.match(list.querySelector("[data-action='batch']").textContent, /\(1\)/);
  const crop = new JSDOM(tpl("token-crop.hbs")({ name: "Кай", frames: [{ id: "tush", label: "Тушь", on: true }], zoomPct: 100, zoomMin: 100, zoomMax: 400 })).window.document;
  assert.ok(crop.querySelector("canvas.ng-crop-view"));
  assert.ok(crop.querySelector("[data-action='save']"));
  const err = new JSDOM(tpl("token-crop.hbs")({ name: "Кай", frames: [], error: "нет картинки" })).window.document;
  assert.equal(err.querySelector("canvas"), null);
  assert.ok(err.querySelector("[data-action='save']").disabled);
});
