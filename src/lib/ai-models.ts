/**
 * The OpenAI text models a presenter may choose in the editor's chat (the
 * model dropdown). The server accepts only these, plus its own OPENAI_MODEL,
 * so a request cannot run on an arbitrary (costlier) model.
 */
export const TEXT_MODELS = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.5", label: "GPT-5.5" },
] as const;

/** A model id as the dropdown shows it: the list's label, else the id in capitals. */
export function modelLabel(id: string): string {
  return TEXT_MODELS.find((m) => m.id === id)?.label ?? id.toUpperCase();
}
