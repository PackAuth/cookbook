/**
 * Recipe 04 — reading a refusal.
 *
 * THE QUESTION: I got a 409. What do I do about it?
 *
 * PackAuth refuses in three ways and they need three different responses.
 * Telling them apart from the status code alone is impossible, so every refusal
 * names the thing that stopped it.
 *
 *   409 rail_blocked      a precondition of the action is not met. The body
 *                          carries `failed_check` — the specific rail check —
 *                          and `detail` saying why. Fix that, retry.
 *   422 unprocessable      the request is coherent and not permissible: an
 *                          authority that does not satisfy the approval scope,
 *                          a blocking finding somebody tried to wave through.
 *                          The detail names what WOULD have worked.
 *   403 (engine deny)      the decision engine refused. There is no override
 *                          path in code, deliberately.
 *
 * This recipe provokes two of them on purpose. The shape of a refusal is worth
 * knowing before you meet one at four in the afternoon on a print deadline.
 */
export const recipe = {
  id: "reading-a-refusal",
  title: "Reading a refusal",
  question: "I got a 409. What do I do about it?",
};

export async function run({ pa, log, stamp, previous }) {
  const { manifest_id } = previous["first-run"];
  const seen = {};

  // 422 — the authority does not satisfy the scope.
  const printer = await pa.createStakeholder({
    body: { type: "printer", name: `Press ${stamp}`, email: `press-${stamp}@example.test` },
  });
  const req = await pa.requestApproval({
    body: { manifest_id, scope: "approved_for_claim_use", jurisdictions: ["UK"] },
  });
  try {
    await pa.approveApproval({
      approval_id: req.approval_id,
      body: { stakeholder_id: printer.stakeholder_id, authority_scope: "print_technical_approval" },
    });
    throw new Error("a print authority satisfied a claim approval — the scope check is not doing anything");
  } catch (err) {
    if (!err.code) throw err;
    seen.wrong_authority = err.code;
    log(`${err.code}: ${err.message}`);
  }

  // 409 — a rail precondition. This manifest has a blocking finding open, so
  // the release rail stops at `no_blocking_findings` and says so.
  try {
    await pa.createPrintRelease({
      body: {
        manifest_id,
        jurisdictions: ["UK"],
        issued_to: { printer: `Press ${stamp}` },
        quantity_limit: 1000,
      },
    });
    log("released — this manifest had no blocking finding after all");
    seen.released = true;
  } catch (err) {
    if (!err.code) throw err;
    // `failed_check` lives under `error`, alongside the code. Reaching for it
    // at the top level silently yields undefined and the recipe prints the
    // generic code — which is exactly the confusion this recipe exists to
    // prevent, committed by the recipe.
    seen.rail_blocked = err.body?.error?.failed_check ?? err.code;
    // `failed_check` is the actionable part. "rail_blocked" tells you a rail
    // stopped it; the check name tells you WHICH precondition to go and meet.
    log(`${err.code} at ${seen.rail_blocked} — ${err.body?.error?.detail ?? ""}`.trim());
  }

  return seen;
}
