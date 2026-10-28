// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useWorkspace, type ChatMessageRow, type LiveJob } from "@/stores/workspace";
import { ChatPanel } from "@/components/workspace/chat-panel";

afterEach(cleanup);
// jsdom does not implement element scrolling.
Element.prototype.scrollTo = function () {};

describe("code editing state", () => {
  it("tracks dirty files through edit, create, rename and delete", () => {
    const s = useWorkspace.getState();
    s.reset("p1");
    s.loadFiles([
      { path: "index.html", content: "<h1>x</h1>" },
      { path: "main.js", content: "1" },
    ]);
    expect(useWorkspace.getState().activePath).toBe("index.html");
    expect(s.isDirty()).toBe(false);
    s.editFile("main.js", "2");
    s.createFile("src/new.js", "");
    s.renameFile("index.html", "home.html");
    expect(s.dirtyPaths().sort()).toEqual(["home.html", "index.html", "main.js", "src/new.js"]);
    expect(useWorkspace.getState().openTabs).toContain("home.html");
    s.deleteFile("src/new.js");
    expect(useWorkspace.getState().files["src/new.js"]).toBeUndefined();
    s.closeTab("home.html");
    expect(useWorkspace.getState().openTabs).not.toContain("home.html");
  });

  it("keeps the last successful preview when a build fails", () => {
    const s = useWorkspace.getState();
    s.reset("p2");
    s.setBuildFromServer({ buildId: "b1", status: "succeeded", errors: [], warnings: [], durationMs: 5, previewUrl: "/preview/b1/index.html" }, null);
    s.setBuildFromServer({ buildId: "b2", status: "failed", errors: [{ severity: "error", file: "a.js", line: 1, column: 0, message: "boom", source: "esbuild" }], warnings: [], durationMs: 5, previewUrl: null }, null);
    const b = useWorkspace.getState().build;
    expect(b.status).toBe("failed");
    expect(b.previewUrl).toBe("/preview/b1/index.html");
    expect(b.stale).toBe(true);
  });

  it("applies streamed job events to live progress", () => {
    const s = useWorkspace.getState();
    s.reset("p3");
    s.startJob("j1");
    s.applyJobEvent({ t: 1, type: "stage", stage: "understand", state: "done", detail: "3 files planned" });
    s.applyJobEvent({ t: 2, type: "file", path: "a.js", kind: "created", added: 3, removed: 0 });
    s.applyJobEvent({ t: 3, type: "status", status: "failed", message: "quota" });
    const j = useWorkspace.getState().job!;
    expect(j.stages.understand).toEqual({ state: "done", detail: "3 files planned" });
    expect(j.files).toHaveLength(1);
    expect(j.error).toBe("quota");
  });
});

describe("chat panel", () => {
  const job: LiveJob = {
    jobId: "j",
    status: "running",
    stages: { understand: { state: "done", detail: "4 files planned" }, generate: { state: "start" } },
    understanding: "Build a solar system",
    tasks: { "gen-ui": { id: "gen-ui", role: "threeD", description: "Write main.js", status: "running", dependsOn: [], writes: ["main.js"], error: null, outputRefs: [], chars: 2400 } },
    files: [],
    logs: [],
    chars: 0,
    builds: [],
    error: null,
    progress: 0.3,
  };
  const msg: ChatMessageRow = {
    id: "m1",
    role: "assistant",
    content: "Done.",
    createdAt: new Date().toISOString(),
    meta: { changedFiles: [{ path: "main.js", kind: "modified", added: 4, removed: 1 }], preVersionId: "v1", postVersionId: "v2", buildStatus: "succeeded" },
  };

  it("shows real pipeline progress, changed files and review/revert actions", () => {
    const onReview = vi.fn();
    const onRevert = vi.fn();
    const onCancel = vi.fn();
    render(<ChatPanel messages={[msg]} job={job} ai={{ configured: true, provider: "openai", model: "m" }} busy onSend={() => {}} onCancel={onCancel} onReview={onReview} onRevert={onRevert} />);
    expect(screen.getByText("Build a solar system")).toBeTruthy();
    expect(screen.getByText(/2.4k chars received/)).toBeTruthy();
    expect(screen.getByText("Build passed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(onReview).toHaveBeenCalledWith(msg);
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("explains when AI is not configured but still lets the server decide (status may be stale)", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} job={null} ai={{ configured: false, provider: "openai", model: null }} busy={false} onSend={onSend} onCancel={() => {}} onReview={() => {}} onRevert={() => {}} />);
    expect(screen.getByText(/AI generation is not configured/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "build me a site" } });
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith("build me a site");
  });

  it("sends trimmed prompts with Enter", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} job={null} ai={{ configured: true, provider: "openai", model: "m" }} busy={false} onSend={onSend} onCancel={() => {}} onReview={() => {}} onRevert={() => {}} />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "  build a game  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("build a game");
  });
});
