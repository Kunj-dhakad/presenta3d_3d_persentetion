"use client";
import { use, useEffect, useState } from "react";
import { PresentView } from "@/components/present/present-view";
import { api, errorMessage } from "@/lib/api-client";

type ProjectResponse = { project: { id: string; name: string; previewUrl: string | null } };

/** The presentation full page, for its owner (the public link is the published site). */
export default function EmbedPresentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<ProjectResponse["project"] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<ProjectResponse>(`/api/projects/${id}`).then((r) => setProject(r.project), (e) => setError(errorMessage(e)));
  }, [id]);
  if (error) return <p className="flex h-dvh items-center justify-center p-6 text-sm text-destructive">{error}</p>;
  if (!project) return <div className="h-dvh bg-black" />;
  return <PresentView projectId={project.id} name={project.name} url={project.previewUrl} />;
}
