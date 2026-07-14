import { redirect } from "next/navigation";

// The "My Contacts" directory was merged into the single comprehensive Contacts
// page (which scopes to the SDR's own book automatically). Keep this route as a
// permanent redirect so old links / bookmarks still land somewhere sensible.
export default function MyContactsPage() {
  redirect("/crm/contacts");
}
