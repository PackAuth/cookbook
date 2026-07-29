#!/usr/bin/env node
/**
 * The cookbook, executed.
 *
 * WHY THE RECIPES RUN INSTEAD OF BEING READ
 *
 * Documentation that is not executed is documentation that is wrong, and the
 * only question is when. Every published integration guide in the world has a
 * snippet that stopped working two releases ago, and the way you find out is a
 * customer reporting it — which means the cost lands on the person you were
 * trying to help.
 *
 * So these are not snippets. Each recipe is a module that runs, in order,
 * against the sandbox, through the published SDK, and this runner is wired into
 * CI. A recipe that stops working fails a build rather than a customer.
 *
 * WHY THE SANDBOX
 *
 * The interesting recipes WRITE — recipe 02 drives a manifest to an issued
 * print release. Doing that against production to prove a documentation example
 * still works would be putting fixture data in a compliance database. The
 * sandbox mints its own tenant, so this needs no stored credential at all and
 * runs on a fork's pull request like any other check.
 *
 *   npm run cookbook              # run them all
 *   npm run cookbook -- --only print-release
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PackAuth } from "./sdk/client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = "https://sandbox.packauth.com";
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

const green = (s) => `[32m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

/** Recipes run in filename order, because recipe 02 needs what 01 produced. */
export function recipeFiles() {
  return readdirSync(join(HERE, "recipes"))
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

async function mintSandboxTenant() {
  const res = await fetch(`${SANDBOX}/v1/sandbox/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Cookbook" }),
  });
  const body = await res.json();
  if (!res.ok || !body.api_key) {
    throw new Error(`could not mint a sandbox tenant: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.api_key;
}

async function main() {
  const token = await mintSandboxTenant();
  /*
   * RETRY WHEN THE DECISION ENGINE WAS NEVER REACHED — and only then.
   *
   * A rail that cannot reach the engine fails closed and refuses. That is
   * correct and must stay correct. But it arrives as a 409 rail_blocked, which
   * is byte-for-byte the shape of a real policy refusal, so a recipe reading it
   * reports "print-release no longer works" when what happened is that an
   * upstream dependency did not answer in time. Twice on this branch, and both
   * times the recipe was fine.
   *
   * The retry lives HERE and deliberately not in the SDK. A customer who gets a
   * refusal is entitled to have it returned to them; a client that quietly
   * re-asks would be deciding on their behalf which refusals are real. This is
   * a test harness choosing to distinguish an outage from a verdict, which is
   * its job, not the client's.
   *
   * One retry. A blip survives it; an outage does not, and the recipe then
   * fails with the reason printed.
   */
  const withEngineRetry = (client) =>
    new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return async (...args) => {
          try {
            return await value.apply(target, args);
          } catch (err) {
            if (err?.body?.error?.reason_code !== "engine_unavailable") throw err;
            await new Promise((r) => setTimeout(r, 3000));
            return value.apply(target, args);
          }
        };
      },
    });

  const pa = withEngineRetry(new PackAuth({ token, baseUrl: SANDBOX }));
  // A second client with NO credential, so a recipe written for somebody
  // outside the tenant — a printer verifying a certificate — cannot quietly
  // lean on one and still claim to need nothing.
  const anonymous = new PackAuth({ baseUrl: SANDBOX });

  // A run-scoped suffix so repeated runs do not collide on a unique name. Not
  // a timestamp inside a recipe: the recipes stay deterministic in shape and
  // only their labels vary.
  const stamp = token.slice(-8);

  const previous = {};
  let failed = 0;

  for (const file of recipeFiles()) {
    const mod = await import(join(HERE, "recipes", file));
    const { recipe } = mod;
    if (only && recipe.id !== only) continue;

    console.log(`\n${recipe.title}`);
    console.log(dim(`  ${recipe.question}`));
    const log = (m) => console.log(dim(`    ${m}`));

    try {
      previous[recipe.id] = await mod.run({ pa, anonymous, log, stamp, previous });
      console.log(`  ${green("ok")}   ${recipe.id}`);
    } catch (err) {
      failed++;
      /*
       * The WHOLE refusal, not just its headline.
       *
       * A rail refusal reads `packauth:rail:approval did not permit this
       * action` — which names the rail and says nothing about which of its
       * checks refused or why. The client already carries the full envelope on
       * `err.body`; this printed only `err.message` and dropped the rest, so a
       * CI failure arrived undiagnosable and the only way to learn anything was
       * to reproduce it. The fields are already there; not printing them was
       * the entire cost.
       */
      const b = err.body?.error ?? {};
      const extra = [
        b.failed_check ? `failed_check=${b.failed_check}` : null,
        b.detail ? `detail=${typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail)}` : null,
        err.status ? `status=${err.status}` : null,
        err.requestId ? `request=${err.requestId}` : null,
      ].filter(Boolean);
      console.log(`  ${red("FAIL")} ${recipe.id} — ${err.message}`);
      if (extra.length) console.log(dim(`         ${extra.join("  ")}`));
      // Keep going. A later recipe that depended on this one will fail too, and
      // seeing which ones survive says more than stopping at the first.
    }
  }

  console.log("");
  if (failed) {
    console.error(
      red(`cookbook FAILED`) +
        ` — ${failed} recipe(s) no longer work. Published documentation that does not run is ` +
        `documentation that is wrong; fix the recipe or fix what it describes.`
    );
    process.exit(1);
  }
  console.log(
    green("cookbook OK") +
      ` — every recipe ran end to end against ${SANDBOX}, through the published client, with no ` +
      `stored credential`
  );
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  main().catch((e) => {
    console.error(red("cookbook FAILED"), e.message);
    process.exit(1);
  });
}
