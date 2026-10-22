// Verifies that every schema sent to OpenAI structured outputs converts to a
// strict JSON schema without constructs the API rejects. Run: npx tsx scripts/check-ai-schemas.ts
import { zodTextFormat } from "openai/helpers/zod";
import { SceneSpecSchema } from "../src/lib/schemas/scene";
import { ProjectSpecSchema, FileOperationsResultSchema, EditPlanSchema } from "../src/lib/schemas/project";
import { DeckSpecSchema } from "../src/lib/schemas/deck";

let bad = 0;
for (const [n, s] of [["scene", SceneSpecSchema], ["spec", ProjectSpecSchema], ["ops", FileOperationsResultSchema], ["edit", EditPlanSchema], ["deck", DeckSpecSchema]] as const) {
  const f = zodTextFormat(s, n);
  const txt = JSON.stringify(f.schema);
  const issue = /prefixItems|"const"|"default"/.test(txt);
  if (issue) bad++;
  console.log(n.padEnd(6), String(txt.length).padStart(6), issue ? "UNSUPPORTED CONSTRUCT" : "ok", "strict=" + f.strict);
}
process.exit(bad ? 1 : 0);
