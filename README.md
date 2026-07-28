> **This repository is generated.**
> The source of truth is the PackAuth API registry. This client is assembled
> from it and pushed here, so it cannot fall behind the API it covers. Open
> issues here; send changes to the source repository, because an edit made in
> this one is overwritten by the next publish.

# PackAuth cookbook

Recipes that answer the questions an integration actually hits, in the order it
hits them. Every one of them **runs** — this is not a page of snippets.

```bash
npm run cookbook                    # all of them
npm run cookbook -- --only print-release
```

They run against `sandbox.packauth.com`, which mints its own tenant, so there is
no credential to obtain and nothing you can damage.

| Recipe | The question |
|---|---|
| `first-run` | I have a product and some artwork. Does it pass? |
| `supplier-evidence` | The run says my material is not evidenced. What does it want? |
| `print-release` | My run is clean. Why is the release still refused? |
| `verify-certificate` | Is this release real, and is it for the file I am about to print? |
| `reading-a-refusal` | I got a 409. What do I do about it? |

## Why they execute

Documentation that is not run is documentation that is wrong, and the only
question is when. The way you normally find out is a customer reporting it,
which puts the cost on the person you were trying to help.

So these are modules, not snippets, and CI runs them. Writing them found five
things a reader would otherwise have found the hard way:

- **A manifest must be BOUND to its specification.** Naming the product is not
  enough — a product can have several specs, and approving against the wrong one
  is what binding prevents. Skip it and three allergen rules report
  `insufficient_input` while `finding_counts.blocking` sits at 0.
- **Filed evidence is not validated evidence.** Uploading a document says it
  exists, not that anybody reviewed it. The rules read validated evidence.
- **One approval does not discharge every duty.** A UK food pack brings six
  authorities, each granted through a *different* approval scope.
- **Ask which documents are required rather than guessing.** `getCounterparty`
  returns `required_evidence`; the first draft of recipe 02 hardcoded a list and
  got it wrong in both directions.
- **A certificate verified against the wrong artwork hash returned
  `valid: true`.** That one was a defect in the API, not in the recipe, and it
  is fixed — `valid` now answers the question the caller asked.
