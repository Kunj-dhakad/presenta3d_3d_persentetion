import type { Metadata } from "next";
import { ProjectsDashboard } from "@/components/projects/projects-dashboard";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectsDashboard />;
}
