/**
 * Recipe 01 — from nothing to a compliance verdict.
 *
 * THE QUESTION: I have a product and some artwork. Does it pass?
 *
 * Seven calls, and the order is not arbitrary. The lifecycle machine refuses an
 * illegal transition rather than coercing it into a legal one, so a manifest
 * cannot run before it has markets, and pack resolution cannot happen before
 * the product is classified. Reading the order here saves discovering it from
 * a sequence of 409s.
 *
 * Runs against the sandbox, which mints its own tenant. No credential needed.
 */
export const recipe = {
  id: "first-run",
  title: "From nothing to a compliance verdict",
  question: "I have a product and some artwork. Does it pass?",
};

export async function run({ pa, log, stamp }) {
  // Every product belongs to a workspace, and the sandbox mint made one. This
  // is where an integration starts: without it you have a workspace you cannot
  // name.
  const { data: workspaces } = await pa.listWorkspaces();
  const workspace_id = workspaces[0].workspace_id;

  const product = await pa.createProduct({
    body: { workspace_id, name: `Cookbook Granola ${stamp}`, brand: "Cookbook" },
  });
  log(`product ${product.product_id}`);

  // CLASSIFICATION IS WHAT MAKES PACK RESOLUTION POSSIBLE. An unclassified
  // product resolves no sector packs, so the run is clean because nothing ran.
  await pa.classifyProduct({
    product_id: product.product_id,
    body: { category: "food.cereal.granola", sector: "food" },
  });

  /*
   * THE SPECIFICATION IS NOT OPTIONAL, and this is the step integrations miss.
   *
   * Several rules cross-check the artwork AGAINST the formula: an allergen on
   * the pack that is not in the spec, and an allergen in the spec that is not
   * emphasised on the pack, are two different findings and both block. With no
   * spec there is nothing to compare, so they block as `insufficient_input`
   * rather than passing — an unrun rule is never a passed rule.
   */
  const spec = await pa.createFormulaSpec({
    body: {
      product_id: product.product_id,
      version: "1.0",
      ingredients: ["oats", "sugar", "sunflower oil", "honey"],
      // `gluten_cereals`, not "oats". Allergens are declared in CANONICAL
      // terms from packauth:dictionary:allergens, and "oats" is an alias of
      // that term rather than a term of its own. The artwork may say "oats" —
      // the comparison resolves the alias — but the spec may not, or the
      // cross-check has nothing stable to match against.
      allergens: ["gluten_cereals"],
      structured_spec: {},
    },
  });
  log(`spec ${spec.spec_id}`);

  // The supplier of the food-contact component. Material rules ask for evidence
  // ABOUT a counterparty, so the counterparty has to exist before the evidence
  // can hang off it.
  const supplier = await pa.createCounterparty({
    body: { type: "packaging_supplier", legal_name: `Cookbook Carton Co ${stamp}`, country: "GB" },
  });

  const packaging = await pa.createPackaging({
    body: {
      product_id: product.product_id,
      format: "carton",
      // Components carry the material and the food-contact flag, because the
      // material rules are about the component that touches the food, not the
      // pack as a whole.
      components: [
        {
          type: "carton",
          material: "paperboard",
          food_contact: true,
          supplier_counterparty_id: supplier.counterparty_id,
        },
      ],
    },
  });

  // Markets decide the pack set and nothing else does.
  const manifest = await pa.createManifest({
    body: {
      workspace_id,
      product_id: product.product_id,
      packaging_id: packaging.packaging_id,
      target_markets: [{ jurisdiction: "UK" }],
    },
  });
  log(`manifest ${manifest.manifest_id}`);

  /*
   * BINDING IS THE STEP EVERYONE MISSES, and it fails in the quietest way.
   *
   * A manifest names a product. It does not thereby know WHICH specification
   * of that product it is about — a product can have several, and approving
   * against the wrong one is the mistake the binding exists to prevent. So
   * `manifest.formula` is only populated once the manifest is explicitly bound
   * to a spec.
   *
   * Skip this and the allergen rules do not fail. They report
   * `insufficient_input` — they could not run, so they refuse to say the pack
   * passed — and `finding_counts.blocking` stays at 0 while three of the most
   * safety-critical rules in the pack set never executed. The release is
   * refused, correctly, and the counts do not obviously explain why.
   */
  await pa.bindManifest({
    manifest_id: manifest.manifest_id,
    body: { spec_id: spec.spec_id, packaging_id: packaging.packaging_id },
  });
  log("bound to the specification — the allergen rules can now read the formula");

  // PackAuth checks CANONICALISED artwork; it does not run OCR. What you send
  // is your own extraction step's output, and the hash is of the file you
  // extracted from — that hash is what a release is later locked to.
  await pa.attachArtwork({
    manifest_id: manifest.manifest_id,
    body: {
      file_hash: `sha256:${"c".repeat(64)}`,
      version: "1",
      extraction_provider: "cookbook",
      extraction_provider_version: "1.0.0",
      extracted: {
        detected_elements: [
          "legal_product_name", "ingredient_list", "net_quantity", "date_marking",
          "business_name_address", "storage_conditions", "nutrition_declaration",
          "allergen_emphasis", "country_of_origin", "lot_code", "barcode",
        ],
        detected_symbols: [],
        detected_claims: [],
        languages_detected: ["en"],
        legal_product_name: "Oat Granola",
        min_x_height_mm: 1.4,
        ingredients_text:
          "Oat Granola. Ingredients: OATS, sugar, sunflower oil, honey. Contains: oats. " +
          "Best before 2030-01-01. Lot L001. Net 400 g. Store in a cool dry place. " +
          "Product of United Kingdom. Made by Cookbook Foods Ltd, 1 Example Way, London.",
        zones: [{ zone_id: "back", text: "Nutrition per 100g. Energy 1800 kJ. Cookbook Foods Ltd, London, UK." }],
      },
    },
  });

  const result = await pa.createRun({ body: { manifest_id: manifest.manifest_id } });
  // `finding_counts`, not `counts`. Writing the wrong field name printed
  // "undefined" and the recipe still passed — which is why the runner returns
  // the values it claims and the next recipe consumes them: a recipe that only
  // logs can be quietly wrong.
  log(`run ${result.run_id} — ${JSON.stringify(result.finding_counts)}`);
  log(`${result.resolved_packs.length} pack(s) resolved, ${result.findings.length} finding(s)`);

  // THE STEP PEOPLE SKIP. A clean run and a run where nothing applicable was
  // implemented produce identical counts. Ask what was NOT checked before you
  // treat a pass as a pass.
  const coverage = await pa.coverageReport({ query: { jurisdiction: "UK" } });
  const uk = coverage.data.find((c) => c.jurisdiction === "UK");
  log(
    `UK — ${uk.duty_classes_enforced.length} duty classes enforced, ` +
      `${uk.duty_classes_not_enforced.length} not enforced`
  );

  return {
    workspace_id,
    supplier_id: supplier.counterparty_id,
    product_id: product.product_id,
    manifest_id: manifest.manifest_id,
    run_id: result.run_id,
    finding_counts: result.finding_counts,
    resolved_packs: result.resolved_packs.length,
  };
}
