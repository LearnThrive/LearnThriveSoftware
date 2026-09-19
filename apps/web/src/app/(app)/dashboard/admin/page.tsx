import { redirect } from "next/navigation";

// Administration used to be a second, thinner copy of the dashboard. Now that the Admin's own
// Overview *is* the operational home (plan6 section 50) and everything else has a real route in
// the sidebar, this path just sends people to the Overview rather than duplicating it.
export default function AdminIndexPage() {
  redirect("/dashboard");
}
