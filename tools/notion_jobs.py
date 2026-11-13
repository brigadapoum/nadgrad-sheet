#!/usr/bin/env python3
"""Доска дел и новости холла из экспорта Notion «Чёрный форум рискарей».

Запуск: python3 tools/notion_jobs.py <папка или zip экспорта> [--version 2026-11-13]
Пишет data/jobs.json (таблица «Доступные заказы») и data/news.json («События и тренды»).
Ключ дела — id страницы Notion из имени файла: по нему модуль узнаёт дело при обновлении.
"""
import csv, io, json, re, sys, zipfile, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKS = ["0", "I", "II", "III", "IV", "V", "VI+"]


def files_of(src):
    p = Path(src)
    if p.is_dir():
        return {f.name: f.read_bytes() for f in p.rglob("*") if f.is_file()}
    with zipfile.ZipFile(p) as z:
        return {Path(n).name: z.read(n) for n in z.namelist() if not n.endswith("/")}


def clean_link(s):
    return re.sub(r"\s*\([^)]*\.md\)", "", s or "").strip()


def page_props(text):
    """Свойства страницы Notion («Ключ: значение») и текст после них."""
    lines = text.splitlines()
    props, body, i = {}, [], 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    while i < len(lines) and re.match(r"^[^:\n]{1,40}: ", lines[i]):
        k, v = lines[i].split(": ", 1)
        props[k.strip()] = v.strip()
        i += 1
    body = "\n".join(lines[i:]).strip()
    return props, body


def md_html(text):
    """Мини-разметка Notion → HTML для страницы журнала: абзацы, **жирный**, *курсив*."""
    import html as H
    out = []
    for para in re.split(r"\n\s*\n", text.strip()):
        t = H.escape(para.strip())
        t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t, flags=re.S)
        t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", t, flags=re.S)
        t = t.replace("\n", "<br>")
        if t:
            out.append(f"<p>{t}</p>")
    return "".join(out)


def obstacles(s):
    s = (s or "").strip()
    if not s or s.lower().startswith("неизв"):
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def main():
    args = sys.argv[1:]
    version = datetime.date.today().isoformat()
    if "--version" in args:
        i = args.index("--version"); version = args[i + 1]; del args[i:i + 2]
    files = files_of(args[0])
    # таблица доступных заказов — csv с колонками Name, Награда, Заказчики, Препятствия, Статус дела, Место
    table = None
    for name, data in files.items():
        if name.endswith(".csv") and not name.endswith("_all.csv"):
            head = data.decode("utf-8-sig").splitlines()[0]
            if "Препятствия" in head and "Статус дела" in head and "Заказчики" in head and "Ранг" not in head:
                table = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
    if table is None:
        sys.exit("Не нашёл таблицу «Доступные заказы» в экспорте")
    pages = {}
    for name, data in files.items():
        m = re.match(r"^(.*) ([0-9a-f]{32})\.md$", name)
        if m:
            pages.setdefault(m.group(1).strip(), []).append((m.group(2), data.decode("utf-8")))
    jobs = []
    for n, row in enumerate(table):
        title = row["Name"].strip()
        key, text, fixer = None, "", None
        for pid, txt in pages.get(title, []):
            props, body = page_props(txt)
            if props.get("Вид записи") == "заказы" or "Препятствия" in props:
                key, text, fixer = pid, body, props.get("Ранг")
                break
        status = {"Играем": "playing", "Доступ": "open"}.get(row["Статус дела"].strip(), "closed")
        jobs.append({
            "key": key or re.sub(r"\W+", "-", title.lower()).strip("-"),
            "name": title,
            "client": clean_link(row["Заказчики"]),
            "place": row["Место"].strip(),
            "reward": row["Награда"].strip(),
            "obstacles": obstacles(row["Препятствия"]),
            "fixerRank": int(fixer) if fixer and fixer.isdigit() else None,
            "status": status,
            "order": n,
            "text": text,
            "html": md_html(text),
        })
    out = {"version": version, "source": "Notion «Доступные заказы»", "jobs": jobs}
    (ROOT / "data" / "jobs.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # новости
    news = []
    for name, data in files.items():
        if name.endswith(".csv") and not name.endswith("_all.csv"):
            head = data.decode("utf-8-sig").splitlines()[0]
            if head.startswith("Name,Статус новости"):
                for r in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
                    t = re.sub(r"\s+", " ", r["Name"]).strip()
                    if t:
                        news.append({"text": t, "age": r["Статус новости"].strip()})
    (ROOT / "data" / "news.json").write_text(json.dumps({"version": version, "news": news}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # рискари: статус в кампании по базе PC (Risk / Waiting / Dead) — запасной вариант, пока мастер не отметил на листе
    roster = []
    for name, data in files.items():
        if name.endswith(".csv") and not name.endswith("_all.csv"):
            head = data.decode("utf-8-sig").splitlines()[0]
            if head.startswith("Name,Статус,Ранг"):
                for r in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
                    st = {"Risk": "active", "Waiting": "waiting", "Dead": "dead"}.get(r["Статус"].strip())
                    if st and r["Name"].strip():
                        rank = r["Ранг"].strip()
                        roster.append({"name": r["Name"].strip(), "status": st, "rank": int(rank) if rank.isdigit() else None})
    (ROOT / "data" / "roster.json").write_text(json.dumps({"version": version, "roster": roster}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"рискарей в базе PC: {len(roster)}")
    print(f"дел: {len(jobs)} (без ключа Notion: {sum(1 for j in jobs if len(j['key']) != 32)}), новостей: {len(news)}")


if __name__ == "__main__":
    main()
