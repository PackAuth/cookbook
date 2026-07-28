/**
 * Recipe 02 — getting to a print release, which is harder than it looks.
 *
 * THE QUESTION: my run is clean. Why is the release still refused?
 *
 * Because a clean run is not an approval, and ONE approval is not enough.
 *
 * The release rail asks, for every regulatory duty the resolved packs impose:
 * did somebody holding the authority for THAT duty sign it off? A UK food pack
 * with the full pack set resolved brings six of them — material suitability,
 * legal claims, translation, supplier evidence, certification marks and the
 * specification — and each is granted through a DIFFERENT approval scope.
 *
 * Requesting them all as `approved_for_print` does not work: that scope accepts
 * `regulatory_label_approval` and `print_technical_approval` and nothing else.
 * This is the single most surprising thing about integrating PackAuth, and it
 * is deliberate — one signature from one person silently discharging every duty
 * is the failure the product exists to prevent.
 */
export const recipe = {
  id: "print-release",
  title: "Getting to a print release",
  question: "My run is clean. Why is the release still refused?",
};

/*
 * Each authority, the role that plausibly holds it, and the approval scope that
 * CARRIES it. The third column is the one that surprises people: an approval is
 * granted in a scope, and a scope accepts only certain authorities. Offering
 * `translation_approval` against `approved_for_print` is refused with a 422
 * naming what would have worked.
 *
 * Written out rather than derived, because a recipe that computes the answer
 * teaches nothing — the point of reading this is to see the shape.
 */
const DUTIES = [
  ["qa_manager", "packaging_material_approval", "approved_for_material_use"],
  ["regulatory_consultant", "legal_claim_approval", "approved_for_claim_use"],
  ["regulatory_consultant", "translation_approval", "approved_for_translation"],
  ["qa_manager", "supplier_evidence_approval", "approved_for_supplier_use"],
  ["certification_body", "certification_mark_approval", "approved_for_certification_mark_use"],
  ["qa_manager", "formula_spec_approval", "approved_for_specification"],
];

export async function run({ pa, log, stamp, previous }) {
  const manifest_id = previous["first-run"].manifest_id;

  // The primary reviewer signs the label itself.
  const reviewer = await pa.createStakeholder({
    body: {
      type: "regulatory_consultant",
      name: `Reviewer ${stamp}`,
      email: `reviewer-${stamp}@example-regulatory.test`,
    },
  });

  /*
   * FIRST, THE FINDINGS. A blocking finding stops the approval rail, not just
   * the release — you cannot approve your way past one, which is the point.
   *
   * Two shapes, and they are not interchangeable. A finding that needs a human
   * judgement is cleared by RECORDING that judgement against a named
   * stakeholder. A finding that needs the artefact to change is not cleared by
   * saying so: the remediation is recorded, the artwork or the evidence is
   * fixed, and the run happens again. `cleared` in the response tells you which
   * one you just had.
   */
  const { data: findings } = await pa.listFindings({ query: { manifest_id, severity: "blocking" } });
  const open = findings.filter((f) => !["resolved", "dispositioned", "waived"].includes(f.status));
  let needRerun = 0;
  for (const f of open) {
    const rem = await pa.remediateFinding({
      finding_id: f.finding_id,
      body: {
        stakeholder_id: reviewer.stakeholder_id,
        action_type: "human_review",
        notes:
          `Reviewed ${f.rule_id} against the declared composition and the destination market's ` +
          `requirements. Confirmed compliant for the scope of this release.`,
      },
    });
    if (!rem.cleared) needRerun++;
  }
  log(`${open.length} blocking finding(s): ${open.length - needRerun} cleared by review, ${needRerun} need a re-run`);
  if (needRerun) {
    // Not a formality. The re-run is what proves the fix worked — a finding
    // still present afterwards was never actually remediated.
    const again = await pa.createRun({ body: { manifest_id } });
    log(`re-run ${again.run_id} — ${JSON.stringify(again.finding_counts)}`);
  }

  const primary = await pa.requestApproval({
    body: { manifest_id, scope: "approved_for_print", jurisdictions: ["UK"] },
  });
  await pa.approveApproval({
    approval_id: primary.approval_id,
    body: { stakeholder_id: reviewer.stakeholder_id, authority_scope: "regulatory_label_approval" },
  });
  log("label approved by the regulatory reviewer");

  // And then every other duty, each by somebody who holds ITS authority.
  for (const [role, authority, scope] of DUTIES) {
    const who = await pa.createStakeholder({
      body: { type: role, name: `${authority} ${stamp}`, email: `${authority}-${stamp}@example.test` },
    });
    // A role's default grant is a template, not a ceiling: a tenant may widen
    // one stakeholder's authority, and the grant is still adjudicated at the
    // action boundary rather than trusted because it was written down.
    await pa.grantAuthority({
      stakeholder_id: who.stakeholder_id,
      body: { authority_scopes: [authority] },
    });
    const req = await pa.requestApproval({ body: { manifest_id, scope, jurisdictions: ["UK"] } });
    await pa.approveApproval({
      approval_id: req.approval_id,
      body: { stakeholder_id: who.stakeholder_id, authority_scope: authority },
    });
    log(`${authority} signed`);
  }

  const release = await pa.createPrintRelease({
    body: {
      manifest_id,
      jurisdictions: ["UK"],
      issued_to: { printer: `Example Print Ltd ${stamp}` },
      quantity_limit: 50000,
    },
  });
  log(`release ${release.release_id}`);

  return { release_id: release.release_id, manifest_id };
}
