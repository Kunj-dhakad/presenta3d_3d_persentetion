// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackSection } from "@/components/workspace/presenter-settings";

afterEach(cleanup);

function setup(form: Record<string, unknown>) {
  const p = { form, data: {}, set: vi.fn(), save: vi.fn(), saving: false };
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

  it("chooses a style", () => {
    const p = setup({ feedback: true, feedback_style: "stars" });
    fireEvent.click(screen.getByRole("radio", { name: /thumbs/i }));
    expect(p.set).toHaveBeenCalledWith({ feedback_style: "thumbs" });
  });

  it("shows the saved style as chosen", () => {
    setup({ feedback: true, feedback_style: "meter" });
    expect(screen.getByRole("radio", { name: /meter/i }).getAttribute("aria-checked")).toBe("true");
  });
});
