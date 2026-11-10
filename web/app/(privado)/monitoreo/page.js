import { redirect } from "next/navigation";

// El monitoreo de este sistema es por áreas
export default function Monitoreo() {
  redirect("/areas");
}
