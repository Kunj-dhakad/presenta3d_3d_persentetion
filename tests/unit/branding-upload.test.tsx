// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const phpPost = vi.fn();
vi.mock("@/lib/php-api", () => ({ phpPost: (...a: unknown[]) => phpPost(...a) }));
vi.mock("@/components/embed/parent-bridge", () => ({ getParentBranding: () => ({ logo: "", name: "Kunj Studio", link: "" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BrandingSection } from "@/components/workspace/design-settings";

type Footer = { enabled: boolean; logoUrl: string; name: string; link: string };

function setup(footer: Footer) {
  const set = vi.fn();
  const d = {
    projectId: "proj1",
    deck: { title: "T", style: "3d", theme: {}, colors: {}, settings: {}, slideCount: 3 },
    settings: { footer, thankYou: { enabled: false, title: "", message: "", buttons: [] }, autoplay: { enabled: false, seconds: 7 }, textScale: 1 },
    colors: {},
    setColors: vi.fn(),
    busy: null,
    error: null,
    save: vi.fn(),
    saveSettings: vi.fn(),
    set,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal stand-in for the loaded design state
  render(<BrandingSection d={d as any} />);
  return { set, d };
}

afterEach(() => {
  cleanup();
  phpPost.mockReset();
});

describe("footer branding logo upload", () => {
  it("uploads the chosen file through the PHP app and puts its https URL in the footer", async () => {
    phpPost.mockResolvedValue({ status: 1, url: "https://cdn.present3d.com/assets/uploads/3d_presentations/logos/1_ab.png" });
    const { set } = setup({ enabled: false, logoUrl: "", name: "", link: "" });
    expect(screen.getByRole("button", { name: /upload logo/i })).toBeTruthy();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(set).toHaveBeenCalledWith("footer", { enabled: true, logoUrl: "https://cdn.present3d.com/assets/uploads/3d_presentations/logos/1_ab.png" }));
    expect(phpPost).toHaveBeenCalledWith("3d-view/settings", { id: "proj1", action: "logo_upload", logo: file }, { timeoutMs: 60_000 });
  });

  it("refuses other file types without uploading", async () => {
    setup({ enabled: true, logoUrl: "", name: "", link: "" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(phpPost).not.toHaveBeenCalled();
  });

  it("shows the current logo with Change and Remove", () => {
    const { set } = setup({ enabled: true, logoUrl: "https://cdn.example.com/l.png", name: "", link: "" });
    expect((screen.getByAltText("Your logo") as HTMLImageElement).src).toBe("https://cdn.example.com/l.png");
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(set).toHaveBeenCalledWith("footer", { logoUrl: "" });
    expect(screen.getByRole("button", { name: /change logo/i })).toBeTruthy();
  });

  it("whitelabel branding keeps a logo already set when the workspace has none", () => {
    const { set } = setup({ enabled: true, logoUrl: "https://cdn.example.com/l.png", name: "", link: "" });
    fireEvent.click(screen.getByRole("button", { name: /use my whitelabel branding/i }));
    expect(set).toHaveBeenCalledWith("footer", { logoUrl: "https://cdn.example.com/l.png", name: "Kunj Studio", link: "" });
  });
});
