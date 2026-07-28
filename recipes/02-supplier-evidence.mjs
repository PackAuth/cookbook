/**
 * Recipe 02 — the evidence a supplier owes you.
 *
 * THE QUESTION: the run says my packaging material is not evidenced. What
 * exactly does it want?
 *
 * A material rule does not ask whether the carton is safe. It asks whether
 * somebody who can be held to it has SAID SO, in a document, that is in date,
 * for the market you are selling into. That is a different question and it is
 * the one a regulator asks too.
 *
 * So evidence is always attached to a counterparty, always typed from a closed
 * registry, and always scoped: a certificate valid in one market is not
 * automatically recognised in another, and the rules refuse to assume it is.
 *
 * `/v1/counterparties/:id/approve` is the gate. It refuses while any required
 * document is missing — which is the useful direction to be refused in, because
 * the refusal names what is outstanding.
 */
export const recipe = {
  id: "supplier-evidence",
  title: "The evidence a supplier owes you",
  question: "The run says my material is not evidenced. What does it want?",
};

async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function run({ pa, log, stamp, previous }) {
  const { supplier_id, product_id, manifest_id } = previous["first-run"];

  // Refused, and the refusal is the specification: it names what is missing.
  try {
    await pa.approveCounterparty({ counterparty_id: supplier_id, body: { markets: ["UK"] } });
    log("supplier approved with no evidence — that should not have worked");
  } catch (err) {
    log(`refused before any evidence: ${err.message}`);
  }

  /*
   * ASK, DO NOT GUESS. `getCounterparty` returns `required_evidence` — the
   * documents THIS counterparty type owes for the risk level it carries. The
   * first draft of this recipe hardcoded a list and got it wrong, filing five
   * documents of which two were not wanted and missing one that was.
   *
   * A hardcoded list is also a list that goes stale: the requirement set is a
   * property of the counterparty registry, and it will change when a rule pack
   * changes. Reading it is both correct today and correct later.
   */
  const { required_evidence } = await pa.getCounterparty({ counterparty_id: supplier_id });
  log(`the API asks for: ${required_evidence.join(", ")}`);

  for (const evidence_type of required_evidence) {
    const filed = await pa.createEvidence({
      body: {
        counterparty_id: supplier_id,
        product_id,
        evidence_type,
        version: "1",
        file_hash: await hash(`${evidence_type}-${stamp}`),
        valid_from: "2026-01-01",
        valid_to: "2099-01-01",
        scope: { markets: ["UK"] },
        // Read by the jurisdiction-match rule. A document recognised in one
        // market is not thereby recognised in another.
        extracted_metadata: { recognised_markets: ["UK"] },
      },
    });

    /*
     * FILED IS NOT VALIDATED, and this is the step that catches people.
     *
     * Creating an evidence record says a document exists. It does not say
     * anybody looked at it. The rules read VALIDATED evidence, so a supplier
     * with every document uploaded and none reviewed is still refused — with
     * the same message as a supplier who uploaded nothing, which is confusing
     * exactly once.
     *
     * That separation is the point rather than an inconvenience: PackAuth is
     * recording who decided the document was sufficient, and "the file was
     * uploaded" is not a decision anybody can be held to.
     */
    await pa.validateEvidence({
      evidence_id: filed.evidence_id,
      body: {
        stakeholder_id: "pending",
        sufficient: true,
        notes: `Reviewed the ${evidence_type} against the declared component and market scope.`,
      },
    });
  }
  log(`${required_evidence.length} documents filed and validated`);

  const approved = await pa.approveCounterparty({
    counterparty_id: supplier_id,
    body: { markets: ["UK"] },
  });
  log(`supplier approved for ${JSON.stringify(approved.approved_scope?.markets ?? [])}`);

  // Evidence changes the answer, so the run happens again. Nothing is inferred
  // from the documents existing — the rules read them.
  const again = await pa.createRun({ body: { manifest_id } });
  log(`re-run ${again.run_id} — ${JSON.stringify(again.finding_counts)}`);

  return { manifest_id, blocking: again.finding_counts.blocking };
}
