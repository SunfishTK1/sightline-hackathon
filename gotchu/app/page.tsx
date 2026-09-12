/** @owner Claude — root is not a separate landing page, it's the onboarding/account page. */
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/onboarding");
}
