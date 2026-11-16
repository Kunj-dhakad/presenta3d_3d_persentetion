/**
 * The OpenAI text models a presenter may choose in the editor's chat (the
 * model dropdown). The server accepts only these, plus its own OPENAI_MODEL,
 * so a request cannot run on an arbitrary (costlier) model.
 */
export const TEXT_MODELS = [
  { id: "gpt-5.2-pro", label: "GPT-5.2 Pro" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.4-pro", label: "GPT-5.4 Pro" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-6-sol", label: "GPT-6 Sol" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
] as const;

/** A model id as the dropdown shows it: the list's label, else the id in capitals. */
export function modelLabel(id: string): string {
  return TEXT_MODELS.find((m) => m.id === id)?.label ?? id.toUpperCase();
}
