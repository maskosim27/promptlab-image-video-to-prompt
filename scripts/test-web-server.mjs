import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "./serve.mjs";

const root = await mkdtemp(join(tmpdir(), "promptlab-web-test-"));
const outsideFile = join(dirname(root), `${root.split(/[\\/]/).at(-1)}-outside.txt`);
await Promise.all([
  writeFile(join(root, "web.html"), "<h1>PromptLab local test</h1>"),
  writeFile(outsideFile, "outside the web root")
]);

const server = createServer(root).listen(0, "127.0.0.1");
try {
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /PromptLab local test/);

  const traversal = await fetch(`${baseUrl}/%2e%2e%2f${outsideFile.split(/[\\/]/).at(-1)}`);
  assert.equal(traversal.status, 404);
  assert.doesNotMatch(await traversal.text(), /outside the web root/);
  console.log("Local web server loopback and path-safety checks passed.");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outsideFile, { force: true })
  ]);
}
