import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { Miniflare } from "miniflare";

const templateRoot = new URL("../", import.meta.url);
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
        d1Databases: { DB: `render-test-${process.pid}` },
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
  assert.doesNotMatch(html, /admin123|演示角色|选择身份/i);
});

test("keeps credential internals out of browser-facing account code", async () => {
  const [accountClient, loginPage, migration] = await Promise.all([
    readFile(
      new URL("../src/auth/client/accountApi.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/features/auth/LoginPage.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0000_account-authentication.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(
    `${accountClient}\n${loginPage}`,
    /passwordHash|passwordSalt|passwordIterations|admin123/,
  );
  assert.match(migration, /CREATE TABLE `accounts`/);
  assert.match(migration, /CREATE TABLE `auth_sessions`/);
  assert.match(migration, /CREATE TABLE `account_audit_logs`/);
  assert.doesNotMatch(
    migration,
    /admin123|tuanzhang1|ceshirenyuan1/,
  );
});

test("removes all temporary starter preview artifacts", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/[[...slug]]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<PlatformApp initialPath=\{initialPath\}/);
  assert.match(layout, /Embodied Data \| 具身视频数据平台/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("../app/page.tsx", import.meta.url)));
  await access(new URL(".openai/hosting.json", templateRoot));
});
