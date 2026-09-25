// 作品一覧ページ（dist/index.html）を work.json の配列から組み立てる。scripts/build.mjs が呼ぶ。
export const SITE_URL = "https://play.nagai-shouten.com/";
const SITE_TITLE = "play ─ ナガイ商店.com のインタラクティブ作品集";
const SITE_DESCRIPTION = "触ると動き、音が鳴るインタラクティブ作品をブラウザで。AI が自律で作る小品と、対話で作り込んだ作品を並べています。";
const REPOSITORY_URL = "https://github.com/takunagai/play";

const SECTIONS = [
  {
    origin: "autopilot",
    id: "autopilot",
    heading: "AI 自律制作",
    lead: "AI のチームが週 2 本のペースで自律制作する小品。",
    emptyMessage: "最初の作品を制作中です。公開までもう少しお待ちください。",
  },
  {
    origin: "dialogue",
    id: "dialogue",
    heading: "対話制作",
    lead: "人と AI が対話を重ねて作り込んだ作品。",
    emptyMessage: "まだ作品がありません。",
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(isoDate) {
  return isoDate.replaceAll("-", ".");
}

function renderCard(work) {
  const href = `works/${encodeURIComponent(work.slug)}/`;
  return `        <li>
          <a class="card" href="${href}">
            <img class="card__thumb" src="${href}${escapeHtml(work.thumbnail)}" alt="" width="1200" height="630" loading="lazy" decoding="async" />
            <div class="card__body">
              <h3 class="card__title">${escapeHtml(work.title)}</h3>
              <time class="card__date" datetime="${escapeHtml(work.date)}">${escapeHtml(formatDate(work.date))}</time>
              <p class="card__summary">${escapeHtml(work.summary)}</p>
              <ul class="card__tags" aria-label="タグ">
                <li>${escapeHtml(work.emotion)}</li>
                <li>${escapeHtml(work.verb)}</li>
              </ul>
            </div>
          </a>
        </li>`;
}

function renderSection(section, works) {
  const items = works
    .filter((work) => work.origin === section.origin)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const body =
    items.length > 0
      ? `      <ul class="grid">\n${items.map(renderCard).join("\n")}\n      </ul>`
      : `      <p class="empty">${escapeHtml(section.emptyMessage)}</p>`;
  return `    <section class="section" aria-labelledby="${section.id}-heading">
      <div class="section__head">
        <h2 id="${section.id}-heading" class="section__title">${escapeHtml(section.heading)}</h2>
        <p class="section__lead">${escapeHtml(section.lead)}</p>
      </div>
${body}
    </section>`;
}

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #07070d;
  --surface: #11111b;
  --surface-hover: #181826;
  --border: rgba(255, 255, 255, 0.08);
  --text: #ecebf5;
  --muted: #9d9bb3;
  --accent: #b69cff;
  --accent-2: #5fe3ff;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(60rem 30rem at 85% -10%, rgba(124, 77, 255, 0.22), transparent 70%),
    radial-gradient(50rem 28rem at -10% 10%, rgba(0, 191, 165, 0.14), transparent 70%),
    var(--bg);
  background-repeat: no-repeat;
  color: var(--text);
  font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif;
  line-height: 1.7;
}
a { color: inherit; }
.wrap { width: min(1120px, 100% - 32px); margin-inline: auto; }
.header { padding: 72px 0 40px; }
.header__title {
  display: inline-block;
  margin: 0;
  font-size: clamp(3.5rem, 12vw, 6rem);
  font-weight: bold;
  line-height: 1;
  letter-spacing: -0.04em;
  background: linear-gradient(100deg, var(--accent-2), var(--accent) 45%, #ff7ad9);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.header__lead { margin: 20px 0 0; max-width: 36em; color: var(--muted); }
.header__note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 0;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.8125rem;
}
.header__note::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-2);
  box-shadow: 0 0 8px var(--accent-2);
}
.section { padding: 32px 0 24px; }
.section__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin-bottom: 20px; }
.section__title { margin: 0; font-size: 1.375rem; font-weight: bold; }
.section__lead { margin: 0; color: var(--muted); font-size: 0.875rem; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  text-decoration: none;
  transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}
.card:hover { transform: translateY(-3px); background: var(--surface-hover); border-color: rgba(182, 156, 255, 0.35); }
.card:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
.card__thumb { display: block; width: 100%; height: auto; aspect-ratio: 1200 / 630; object-fit: cover; background: #000; }
.card__body { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; padding: 16px 18px 18px; }
.card__title { margin: 0; font-size: 1.125rem; font-weight: bold; line-height: 1.4; }
.card__date { color: var(--muted); font-size: 0.8125rem; font-variant-numeric: tabular-nums; line-height: 1.4; padding-top: 3px; }
.card__summary { grid-column: 1 / -1; margin: 4px 0 0; color: var(--muted); font-size: 0.875rem; }
.card__tags { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
.card__tags li {
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(182, 156, 255, 0.12);
  color: #d6c9ff;
  font-size: 0.75rem;
}
.empty {
  margin: 0;
  padding: 28px 20px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--muted);
  font-size: 0.875rem;
  text-align: center;
}
.footer { margin-top: 48px; padding: 28px 0 40px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8125rem; }
.footer p { margin: 0 0 6px; }
.footer a { color: var(--text); text-underline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .card { transition: none; }
  .card:hover { transform: none; }
}
`;

function licenseNote(works) {
  const exceptions = works.filter((work) => work.license !== "MIT").sort((x, y) => x.slug.localeCompare(y.slug));
  if (exceptions.length === 0) return "MIT";
  return `${exceptions.map((work) => `${work.title} は ${work.license}`).join("、")}、ほかは MIT`;
}

/** works: 検証済みの work.json の配列 */
export function renderGallery(works) {
  const ogImage = `${SITE_URL}og-image.jpg`;
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(SITE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <link rel="canonical" href="${SITE_URL}" />
    <link rel="icon" type="image/svg+xml" href="favicon.svg" />
    <meta name="theme-color" content="#07070d" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="play" />
    <meta property="og:title" content="${escapeHtml(SITE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta property="og:url" content="${SITE_URL}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:locale" content="ja_JP" />
    <meta name="twitter:card" content="summary_large_image" />
    <style>${STYLE}</style>
  </head>
  <body>
    <header class="header wrap">
      <h1 class="header__title">play</h1>
      <p class="header__lead">触ると動き、音が鳴るインタラクティブ作品集。スマホでも PC でも、ブラウザだけで遊べます。</p>
      <p class="header__note">音が出ます</p>
    </header>
    <main class="wrap">
${SECTIONS.map((section) => renderSection(section, works)).join("\n")}
    </main>
    <footer class="footer wrap">
      <p>制作: ながたく（Taku Nagai） ─ <a href="https://nagai-shouten.com/">ナガイ商店.com</a></p>
      <p>ソース: <a href="${REPOSITORY_URL}">GitHub</a>（${escapeHtml(licenseNote(works))}）</p>
    </footer>
  </body>
</html>
`;
}
