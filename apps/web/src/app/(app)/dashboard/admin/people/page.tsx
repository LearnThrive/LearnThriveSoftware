import { redirect } from "next/navigation";

// People is a tabbed area with a route per tab (plan6 section 39) so each list is linkable;
// the bare /people path lands on Students, the list an admin opens most.
export default function PeopleIndexPage() {
  redirect("/dashboard/admin/people/students");
}
