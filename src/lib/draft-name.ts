/**
 * A name to show until the slides are written: the topic (the last paragraph
 * of the prompt, after any "Use 8 slides. Tone: …" line), cut to a few words.
 */
export function draftNameFrom(prompt: string): string {
  const topic = prompt.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).pop() ?? "";
  const line = topic.split("\n")[0].replace(/\s+/g, " ").trim();
  if (!line) return "Untitled presentation";
  if (line.length <= 60) return line.charAt(0).toUpperCase() + line.slice(1);
  const cut = line.slice(0, 60);
  return line.charAt(0).toUpperCase() + cut.slice(1, Math.max(cut.lastIndexOf(" "), 30)).trimEnd() + "…";
}
