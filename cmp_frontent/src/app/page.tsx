/**
 * Root route.
 *
 * There is no meaningful landing page for this product: staff belong in the
 * dashboard, data subjects in their consent list, and everyone else at sign-in.
 * Redirecting server-side avoids a flash of an empty page before the client
 * router works out where to go.
 */
import { redirect } from "next/navigation";

export default function RootPage(): never {
  redirect("/dashboard");
}
