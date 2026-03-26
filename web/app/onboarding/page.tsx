import { Suspense } from "react";
import OnboardingForm from "./onboarding-form";

export const metadata = { title: "Set up your workspace — App" };

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<div className="animate-pulse w-80 h-64 rounded-lg bg-muted" />}>
        <OnboardingForm />
      </Suspense>
    </div>
  );
}
