// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LeadSection } from "@/components/workspace/presenter-settings";

afterEach(cleanup);

const form = { lead_form: true, lead_after_slide: 2, lead_fields: { name: { show: true, required: false }, email: { show: true, required: false }, phone: { show: false, required: false } }, autoresponder_id: null, list_id: "" };

function setup(plan?: Record<string, unknown>) {
  const p = { form, data: { autoresponders: [], plan }, lists: [], listsLoading: false, set: vi.fn(), setLists: vi.fn(), save: vi.fn(), saving: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal stand-in for the loaded presenter state
  render(<LeadSection p={p as any} slideCount={5} />);
}

describe("lead form and the owner's plan", () => {
  it("is locked, with no toggle, when the plan has no lead forms", () => {
    setup({ lead_form: false, autoresponder: false, lead_form_message: "Lead forms are not in your plan. It comes with OTO3 Automation. Upgrade your plan to use them." });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(/It comes with OTO3 Automation/)).toBeTruthy();
  });

  it("shows the toggle when the plan has lead forms", () => {
    setup({ lead_form: true, autoresponder: true });
    expect(screen.getByRole("switch", { name: "Built-in lead form" })).toBeTruthy();
  });

  it("shows the toggle for an older server that sends no plan", () => {
    setup(undefined);
    expect(screen.getByRole("switch", { name: "Built-in lead form" })).toBeTruthy();
  });
});
