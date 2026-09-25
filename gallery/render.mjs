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
            <div class="card__media">
              <img class="card__thumb" src="${href}${escapeHtml(work.thumbnail)}" alt="" width="1200" height="630" loading="lazy" decoding="async" />
              <span class="card__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg></span>
            </div>
            <div class="card__body">
              <h3 class="card__title">${escapeHtml(work.title)}</h3>
              <time class="card__date" datetime="${escapeHtml(work.date)}">${escapeHtml(formatDate(work.date))}</time>
              <p class="card__summary">${escapeHtml(work.summary)}</p>
              <ul class="card__tags" aria-label="タグ">
                <li class="tag tag--emotion">${escapeHtml(work.emotion)}</li>
                <li class="tag tag--verb">${escapeHtml(work.verb)}</li>
              </ul>
            </div>
          </a>
        </li>`;
}

function renderSection(section, index, works) {
  const items = works
    .filter((work) => work.origin === section.origin)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const body =
    items.length > 0
      ? `      <ul class="grid">\n${items.map(renderCard).join("\n")}\n      </ul>`
      : `      <div class="empty">
        <div class="empty__media" aria-hidden="true"><span class="empty__pulse"></span></div>
        <p class="empty__message">${escapeHtml(section.emptyMessage)}</p>
      </div>`;
  return `    <section class="section" aria-labelledby="${section.id}-heading">
      <div class="section__head">
        <span class="section__index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        <h2 id="${section.id}-heading" class="section__title">${escapeHtml(section.heading)}</h2>
        <p class="section__lead">${escapeHtml(section.lead)}</p>
      </div>
${body}
    </section>`;
}

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #06060b;
  --surface: #0f0f18;
  --surface-hover: #151522;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);
  --text: #eeedf6;
  --muted: #9a98b0;
  --faint: #5f5d75;
  --cyan: #5fe3ff;
  --violet: #b69cff;
  --pink: #ff7ad9;
  --radius: 16px;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  overflow-x: clip;
  background: var(--bg);
  color: var(--text);
  font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif;
  line-height: 1.7;
}
a { color: inherit; }
.wrap { width: min(1120px, 100% - 32px); margin-inline: auto; }

/* ヒーロー: 右奥で鳴り続ける波紋が「音が出る」ことを先に伝える */
.hero {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  padding: clamp(72px, 12vw, 128px) 0 clamp(48px, 7vw, 80px);
  background:
    radial-gradient(48rem 26rem at 78% 30%, rgba(124, 77, 255, 0.2), transparent 70%),
    radial-gradient(36rem 22rem at 0% 0%, rgba(0, 191, 165, 0.12), transparent 70%);
}
.hero::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--border-strong) 20%, var(--border-strong) 80%, transparent);
}
.hero__ripples {
  position: absolute;
  z-index: -1;
  top: 50%;
  left: 78%;
  width: min(760px, 150vw);
  aspect-ratio: 1;
  translate: -50% -50%;
  pointer-events: none;
}
.hero__ripples::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, transparent 0 39px, rgba(255, 255, 255, 0.045) 39px 40px);
  -webkit-mask-image: radial-gradient(circle, #000 30%, transparent 70%);
  mask-image: radial-gradient(circle, #000 30%, transparent 70%);
}
.hero__ripples::after {
  content: "";
  position: absolute;
  inset: 47%;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0 12%, var(--violet) 30%, transparent 70%);
  box-shadow: 0 0 40px 12px rgba(182, 156, 255, 0.35);
  animation: core 3.2s ease-in-out infinite;
}
.hero__ripples span {
  position: absolute;
  inset: 0;
  border: 1.5px solid var(--cyan);
  border-radius: 50%;
  opacity: 0;
  animation: ripple 9.6s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
}
.hero__ripples span:nth-child(2) { border-color: var(--violet); animation-delay: -2.4s; }
.hero__ripples span:nth-child(3) { border-color: var(--pink); animation-delay: -4.8s; }
.hero__ripples span:nth-child(4) { border-color: var(--violet); animation-delay: -7.2s; }
@keyframes ripple {
  0% { transform: scale(0.06); opacity: 0; }
  6% { opacity: 0.85; }
  100% { transform: scale(1); opacity: 0; }
}
@keyframes core {
  0%, 100% { transform: scale(0.85); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
}
.hero__title {
  display: inline-block;
  margin: 0;
  padding: 0 0.12em 0.12em 0;
  font-size: clamp(4.5rem, 19vw, 9rem);
  font-weight: bold;
  line-height: 0.9;
  letter-spacing: -0.055em;
  background: linear-gradient(100deg, var(--cyan), var(--violet) 48%, var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero__lead {
  margin: 24px 0 0;
  max-width: 30em;
  color: #c4c2d6;
  font-size: clamp(0.9375rem, 2.2vw, 1.0625rem);
}
.hero__note {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 24px 0 0;
  padding: 6px 14px 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: rgba(6, 6, 11, 0.6);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 0.8125rem;
  line-height: 1.4;
}
.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.eq i {
  width: 2px;
  height: 100%;
  border-radius: 1px;
  background: var(--cyan);
  transform-origin: bottom;
  animation: eq 1.1s ease-in-out infinite;
}
.eq i:nth-child(2) { animation-delay: -0.35s; background: var(--violet); }
.eq i:nth-child(3) { animation-delay: -0.7s; background: var(--pink); }
.eq i:nth-child(4) { animation-delay: -0.2s; background: var(--violet); }
@keyframes eq {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}

/* 節 */
.section { padding: clamp(48px, 7vw, 72px) 0 0; }
.section__head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 4px 14px;
  margin-bottom: 24px;
}
.section__index {
  color: var(--cyan);
  font-size: 0.8125rem;
  font-weight: bold;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
}
.section__title {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  font-size: clamp(1.375rem, 3vw, 1.625rem);
  font-weight: bold;
  line-height: 1.3;
}
.section__title::after { content: ""; flex: 1; height: 1px; background: var(--border); }
.section__lead { grid-column: 2; margin: 0; color: var(--muted); font-size: 0.875rem; }

/* カード: サムネイルを主役に大きく並べる */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: clamp(20px, 2.4vw, 28px);
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
  border-radius: var(--radius);
  background: var(--surface);
  text-decoration: none;
  transition: transform 0.3s ease, background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
.card:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.card__media { position: relative; overflow: hidden; background: #000; }
.card__thumb {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1200 / 630;
  object-fit: cover;
  transition: transform 0.6s cubic-bezier(0.2, 0.6, 0.35, 1), filter 0.6s ease;
}
.card__play {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(6, 6, 11, 0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  opacity: 0;
  translate: -50% -50%;
  scale: 0.8;
  transition: opacity 0.3s ease, scale 0.3s ease;
}
.card__play svg { width: 24px; height: 24px; margin-left: 3px; fill: #fff; }
.card__body { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; padding: 18px 20px 20px; }
.card__title { margin: 0; font-size: 1.125rem; font-weight: bold; line-height: 1.4; }
.card__date { color: var(--faint); font-size: 0.8125rem; font-variant-numeric: tabular-nums; line-height: 1.4; padding-top: 4px; }
.card__summary { grid-column: 1 / -1; margin: 2px 0 0; color: var(--muted); font-size: 0.875rem; }
.card__tags { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; padding: 0; list-style: none; }
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 0.75rem;
  line-height: 1.5;
}
.tag--emotion { background: rgba(255, 122, 217, 0.1); color: #ffc2ee; }
.tag--emotion::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--pink); }
.tag--verb { border-color: rgba(95, 227, 255, 0.3); color: #b5f2ff; }
@media (hover: hover) {
  .card:hover {
    transform: translateY(-4px);
    background: var(--surface-hover);
    border-color: rgba(182, 156, 255, 0.4);
    box-shadow: 0 24px 60px -24px rgba(124, 77, 255, 0.55);
  }
  .card:hover .card__thumb { transform: scale(1.04); filter: brightness(0.8); }
  .card:hover .card__play { opacity: 1; scale: 1; }
}

/* 空の案内: 波紋が小さく脈打つ「制作中」の帯 */
.empty {
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
}
.empty__media {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: clamp(88px, 22vw, 200px);
  align-self: stretch;
  min-height: 104px;
  border-right: 1px dashed var(--border);
  background: repeating-radial-gradient(circle at 50% 50%, transparent 0 15px, rgba(255, 255, 255, 0.04) 15px 16px);
}
.empty__pulse {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 12px var(--cyan);
}
.empty__pulse::after {
  content: "";
  position: absolute;
  inset: -4px;
  border: 1px solid var(--cyan);
  border-radius: 50%;
  animation: pulse 2.4s ease-out infinite;
}
@keyframes pulse {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(5); opacity: 0; }
}
.empty__message { margin: 0; padding: 20px 24px; color: var(--muted); font-size: 0.875rem; }

/* フッター */
.footer { margin-top: clamp(72px, 10vw, 112px); border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8125rem; }
.footer__inner { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px 32px; padding: 32px 0 48px; }
.footer__mark {
  margin: 0;
  padding: 0 0.12em 0.12em 0;
  font-size: 1.5rem;
  font-weight: bold;
  line-height: 1;
  letter-spacing: -0.05em;
  background: linear-gradient(100deg, var(--cyan), var(--violet) 48%, var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.footer__text p { margin: 0 0 6px; }
.footer__text a { color: var(--text); text-underline-offset: 3px; }
.footer__text a:hover { color: var(--cyan); }

@media (max-width: 600px) {
  .hero__ripples { top: 18%; left: 88%; }
}
@media (prefers-reduced-motion: reduce) {
  .hero__ripples span, .hero__ripples::after, .eq i, .empty__pulse::after { animation: none; }
  .hero__ripples span { opacity: 0.35; }
  .hero__ripples span:nth-child(1) { transform: scale(0.3); }
  .hero__ripples span:nth-child(2) { transform: scale(0.5); }
  .hero__ripples span:nth-child(3) { transform: scale(0.7); }
  .hero__ripples span:nth-child(4) { transform: scale(0.9); }
  .eq i { transform: scaleY(0.6); }
  .card, .card__thumb, .card__play { transition: none; }
  .card:hover { transform: none; }
  .card:hover .card__thumb { transform: none; }
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
    <header class="hero">
      <div class="hero__ripples" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="wrap">
        <h1 class="hero__title">play</h1>
        <p class="hero__lead">触ると動き、音が鳴るインタラクティブ作品集。スマホでも PC でも、ブラウザだけで遊べます。</p>
        <p class="hero__note"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>音が出ます</p>
      </div>
    </header>
    <main class="wrap">
${SECTIONS.map((section, index) => renderSection(section, index, works)).join("\n")}
    </main>
    <footer class="footer">
      <div class="wrap footer__inner">
        <p class="footer__mark" aria-hidden="true">play</p>
        <div class="footer__text">
          <p>制作: ながたく（Taku Nagai） ─ <a href="https://nagai-shouten.com/">ナガイ商店.com</a></p>
          <p>ソース: <a href="${REPOSITORY_URL}">GitHub</a>（${escapeHtml(licenseNote(works))}）</p>
        </div>
      </div>
    </footer>
  </body>
</html>
`;
}
