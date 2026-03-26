import { Suspense } from "react";
import SignupForm from "./signup-form";

export const metadata = { title: "Sign up — App" };

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<div className="animate-pulse w-80 h-64 rounded-lg bg-muted" />}>
        <SignupForm />
      </Suspense>
    </div>
  );
}
