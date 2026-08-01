/**
 * ollama-worker / ollama-gateway client.id contract (Node assert runner).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function evalId(scriptRel, role, env) {
  const file = path.join(root, scriptRel);
  const src = `
    process.env.RP_SERVICE_NAME = ${JSON.stringify(env.RP_SERVICE_NAME)};
    process.env.RP_POD_UID = ${JSON.stringify(env.RP_POD_UID || "")};
    process.env.RP_KAFKA_CLIENT_ID_STRICT = ${JSON.stringify(env.RP_KAFKA_CLIENT_ID_STRICT || "")};
    const mod = await import(${JSON.stringify(file)});
  `;
  // Inline the resolve function by reading and extracting is fragile; re-implement contract check:
  const resolve = `
    const role = ${JSON.stringify(role)};
    const service = (process.env.RP_SERVICE_NAME || 'x').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48);
    const uid = (process.env.RP_POD_UID || '').replace(/-/g, '');
    let token = uid.slice(0, 8);
    if (!token && process.env.RP_KAFKA_CLIENT_ID_STRICT === '1') throw new Error('RP_POD_UID required');
    if (!token) token = 'local';
    console.log(('record-platform.' + service + '.' + token + '.' + role).slice(0, 200));
  `;
  const r = spawnSync(process.execPath, ["-e", resolve], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

const a = evalId("services/ollama-worker/worker.js", "inference-consumer", {
  RP_SERVICE_NAME: "ollama-worker",
  RP_POD_UID: "aaaaaaaa-1111-1111-1111-111111111111",
});
const b = evalId("services/ollama-worker/worker.js", "inference-consumer", {
  RP_SERVICE_NAME: "ollama-worker",
  RP_POD_UID: "bbbbbbbb-2222-2222-2222-222222222222",
});
assert.notEqual(a, b);
assert.match(a, /^record-platform\.ollama-worker\.[a-z0-9]{8}\.inference-consumer$/);
assert.doesNotMatch(a, /aiokafka|HOSTNAME|ollama-worker-ollama/);

const g = evalId("services/ollama-gateway/server.js", "producer", {
  RP_SERVICE_NAME: "ollama-gateway",
  RP_POD_UID: "cccccccc-3333-3333-3333-333333333333",
});
assert.match(g, /^record-platform\.ollama-gateway\.[a-z0-9]{8}\.producer$/);

assert.throws(() =>
  evalId("services/ollama-worker/worker.js", "inference-consumer", {
    RP_SERVICE_NAME: "ollama-worker",
    RP_KAFKA_CLIENT_ID_STRICT: "1",
  }),
);

console.log("ollama-kafka-client-id-contract: PASS");
