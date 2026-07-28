/**
 * Recipe 03 — verifying a certificate as the printer.
 *
 * THE QUESTION: someone sent me a release reference. Is it real, and is it for
 * the file I am about to put on a press?
 *
 * This is the only recipe with no credential in it, and that is the point. A
 * printer is not a PackAuth customer. They receive a reference and a file, and
 * they need to answer two questions without an account: is this release live,
 * and does it cover THIS artwork rather than the version before the last
 * correction.
 *
 * The answer is narrow by design — status, scope, artwork hash, issue time.
 * Not the manifest, not the findings, not who approved what. A verification
 * endpoint that returned the compliance history would be a data leak with a
 * helpful name.
 */
export const recipe = {
  id: "verify-certificate",
  title: "Verifying a certificate as the printer",
  question: "Is this release real, and is it for the file I am about to print?",
};

export async function run({ anonymous, log, previous }) {
  const release_id = previous["print-release"].release_id;

  // No token. `anonymous` is a client with no credential at all — if this
  // needed one, the recipe would be wrong about who it is for.
  const cert = await anonymous.verifyRelease({ release_id });
  log(`valid=${cert.valid} status=${cert.status} scope=${JSON.stringify(cert.scope.jurisdictions)}`);

  if (!cert.valid) throw new Error("a release that was just issued did not verify");

  // The hash is the part that matters. A release is issued against a LOCKED
  // artwork version, so a file that does not hash to this one is not the file
  // that was approved — however similar it looks on screen.
  const presented = cert.artwork_file_hash;
  const wrong = `sha256:${"b".repeat(64)}`;
  const mismatch = await anonymous.verifyRelease({
    release_id,
    query: { artwork_hash: wrong },
  });
  log(`a different file: valid=${mismatch.valid} artwork_hash_matches=${mismatch.artwork_hash_matches}`);
  if (mismatch.valid) throw new Error("the wrong artwork hash verified — the check is not doing anything");

  // And the right one, so this proves a distinction rather than only that
  // something refused.
  const right = await anonymous.verifyRelease({ release_id, query: { artwork_hash: presented } });
  if (!right.valid) throw new Error("the correct artwork hash did not verify");
  log(`the file it was issued for: valid=${right.valid}`);

  return { release_id, artwork_file_hash: presented };
}
