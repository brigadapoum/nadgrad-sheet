// Правки DOM родного листа после каждой перерисовки (общие для модуля и стенда).

/** Полоса над портретом: убрать CRED, DEBT, бросок по мотиву, «охотника»; поставить переключатель тем. */
export function tidyHeader(root, { active }) {
  const bar = root.querySelector("section.header .options");
  if (bar) {
    for (const el of [...bar.children]) if (!el.classList.contains("ng-theme")) el.remove();
    let sw = bar.querySelector(".ng-theme");
    if (!sw) {
      sw = root.ownerDocument.createElement("div");
      sw.className = "ng-theme";
      sw.innerHTML =
        `<span class="ng-theme-label">Тема</span>` +
        `<button type="button" data-action="ngTheme" data-theme="tush">Тушь</button>` +
        `<button type="button" data-action="ngTheme" data-theme="smog">Смог</button>`;
      bar.append(sw);
    }
    for (const b of sw.querySelectorAll("button")) b.classList.toggle("active", b.dataset.theme === active);
  }
  // красная раскраска «на рискаря охотятся» больше не нужна
  root.querySelector('[data-application-part="form"]')?.classList.remove("hunted");
}

/** Темы: явный выбор вешает класс на окно; «auto» — по теме Foundry. */
export function applyThemeClass(root, theme) {
  root.classList.toggle("ng-tush", theme === "tush");
  root.classList.toggle("ng-smog", theme === "smog");
}

/** Какая тема сейчас видна (для подсветки переключателя). */
export function effectiveTheme(root, theme) {
  if (theme === "tush" || theme === "smog") return theme;
  const body = root.ownerDocument.body;
  const dark = root.classList.contains("theme-dark") ||
    (body.classList.contains("theme-dark") && !root.classList.contains("theme-light"));
  return dark ? "smog" : "tush";
}

/** Кнопка загрузки, как в 1.05: текст уровня, клик — тяжелее, ПКМ — легче. Цифра «x / max» — только показ. */
export function loadButton(root, { index, label, levels }) {
  const gears = root.querySelector("section.gears");
  if (!gears) return;
  const stack = gears.querySelector('h3 button[data-action="gearLoadChange"]');
  if (stack) { stack.removeAttribute("data-action"); stack.classList.add("ng-load-count"); stack.tabIndex = -1; }
  gears.querySelector(":scope > p.desc")?.remove();
  let btn = gears.querySelector(":scope > button.ng-load");
  if (!btn) {
    btn = root.ownerDocument.createElement("button");
    btn.type = "button";
    btn.className = "ng-load";
    btn.dataset.action = "ngLoad";
    btn.title = "Клик — тяжелее, правый клик — легче";
    const h3 = gears.querySelector(":scope > h3");
    h3 ? h3.after(btn) : gears.prepend(btn);
  }
  const dots = levels.map((_, i) => `<i class="ng-dot${i <= index ? " on" : ""}"></i>`).join("");
  btn.innerHTML = `<span class="ng-load-text">${label}</span><span class="ng-dots">${dots}</span>`;
}
