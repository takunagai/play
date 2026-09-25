// dist/ を静的配信する最小のサーバ（verify-work.mjs とローカル確認用）。
// Cloudflare Workers の静的アセット配信（html_handling: auto-trailing-slash）に寄せる:
//   /works/<slug> → 307 で /works/<slug>/ へ、/works/<slug>/ → index.html、無いファイルは 404。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** root を配信するサーバを起動し、{ url, close } を返す。port 0 なら空いている番号を使う */
export function startStaticServer(root, { port = 0, host = "127.0.0.1" } = {}) {
  const rootDir = normalize(root);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const target = normalize(join(rootDir, pathname));
      if (target !== rootDir && !target.startsWith(rootDir + sep)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      let filePath = target;
      if (await isDirectory(target)) {
        if (!pathname.endsWith("/")) {
          response.writeHead(307, { Location: `${url.pathname}/${url.search}` }).end();
          return;
        }
        filePath = join(target, "index.html");
      } else if (!(await isFile(target)) && (await isFile(`${target}.html`))) {
        filePath = `${target}.html`;
      }
      if (!(await isFile(filePath))) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// 直接実行: node scripts/lib/static-server.mjs [dir] [port]
if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = process.argv[2] ?? "dist";
  const port = Number(process.argv[3] ?? 4173);
  const { url } = await startStaticServer(directory, { port });
  console.log(`serving ${directory} at ${url}/`);
}
