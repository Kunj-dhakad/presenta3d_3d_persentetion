// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackSection } from "@/components/workspace/presenter-settings";

afterEach(cleanup);

function setup(form: Record<string, unknown>) {
  const p = { form, data: {}, set: vi.fn(), save: vi.fn(), saveNow: vi.fn(async () => {}), saving: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal stand-in for the loaded presenter state
  render(<FeedbackSection p={p as any} />);
  return p;
}

describe("feedback rating style", () => {
  it("offers the four styles, with Stars chosen when the server sends none", () => {
    setup({ feedback: true });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Emoji", "Stars", "Meter", "Thumbs"]);
    expect(screen.getByRole("radio", { name: /stars/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("saves a chosen style at once, with no Save button", () => {
    const p = setup({ feedback: true, feedback_style: "stars" });
    fireEvent.click(screen.getByRole("radio", { name: /thumbs/i }));
    expect(p.saveNow).toHaveBeenCalledWith({ feedback_style: "thumbs" });
    // Choosing the style already chosen saves nothing.
    fireEvent.click(screen.getByRole("radio", { name: /thumbs/i }).closest("div")!.querySelector('[aria-checked="true"]')!);
    expect(p.saveNow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("saves the on/off switch at once", () => {
    const p = setup({ feedback: true, feedback_style: "stars" });
    fireEvent.click(screen.getByRole("switch"));
    expect(p.saveNow).toHaveBeenCalledWith({ feedback: false });
  });

  it("shows the saved style as chosen", () => {
    setup({ feedback: true, feedback_style: "meter" });
    expect(screen.getByRole("radio", { name: /meter/i }).getAttribute("aria-checked")).toBe("true");
  });
});
