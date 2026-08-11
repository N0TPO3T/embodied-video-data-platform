import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { Miniflare } from "miniflare";

let miniflare;

function getMiniflare() {
  miniflare ??= new Miniflare({
    workers: [
      {
        name: "APP",
        modules: true,
        scriptPath: fileURLToPath(
          new URL("../dist/server/index.js", import.meta.url),
        ),
        modulesRoot: fileURLToPath(
          new URL("../dist/server", import.meta.url),
        ),
        modulesRules: [
          { type: "ESModule", include: ["**/*.js"] },
        ],
        compatibilityDate: "2026-05-15",
        compatibilityFlags: ["nodejs_compat"],
        serviceBindings: { ASSETS: "ASSETS" },
      },
      {
        name: "ASSETS",
        modules: true,
        script:
          "export default { fetch() { return new Response('Not found', { status: 404 }); } }",
      },
    ],
  });
  return miniflare;
}

async function render(path = "/") {
  return getMiniflare().dispatchFetch(`http://localhost${path}`, {
    headers: { accept: "text/html" },
  });
}

async function request(path, init) {
  return getMiniflare().dispatchFetch(`http://localhost${path}`, init);
}

after(async () => {
  await miniflare?.dispose();
});

test("server-renders the embodied data public experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Embodied Data \| 具身视频数据平台<\/title>/i);
  assert.match(html, /让每一段视频/);
  assert.match(html, /成为可用的具身数据/);
  assert.match(html, /登录工作台/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders password login without exposing initial credentials", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /账号登录/);
  assert.match(html, /用户名/);
  assert.match(html, /密码/);
  assert.match(html, /登录数据平台/);
  assert.doesNotMatch(html, /初始密码|演示角色|选择身份/i);
});

test("falls through obsolete identity paths without serving the old API", async () => {
  const requests = [
    ["/api/auth/login", { method: "POST" }],
    ["/api/auth/logout", { method: "POST" }],
    ["/api/auth/session"],
    ["/api/admin/accounts"],
    ["/api/admin/account-audit"],
  ];

  for (const [path, init] of requests) {
    const response = await request(path, init);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
      `${path} must fall through to the public app`,
    );
    assert.equal(response.headers.get("set-cookie"), null);

    const html = await response.text();
    assert.match(html, /<title>Embodied Data \| 具身视频数据平台<\/title>/i);
  }
});
