/** @owner Will */
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";

export default function OnboardingPage() {
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-12">
      <h1 className="mb-2 text-3xl font-semibold">Welcome to Gotchu</h1>
      <p className="mb-8 text-muted-foreground">
        Tell us who you are and what you&apos;re usually up for — your agent negotiates from this.
      </p>
      <OnboardingForm />
    </main>
  );
}
