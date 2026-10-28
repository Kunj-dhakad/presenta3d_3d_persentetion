import { redirect } from "next/navigation";

/** This app only runs inside the PHP app's iframe; its entry page is the new-presentation chat. */
export default function Home() {
  redirect("/embed/new");
}
