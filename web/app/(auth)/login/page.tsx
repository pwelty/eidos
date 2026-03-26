// Wrap inner component in Suspense — useSearchParams() requires it.
// Without this, the page fails static generation with a cryptic error.
import { Suspense } from "react";
import LoginForm from "./login-form";

export const metadata = { title: "Log in — App" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<div className="animate-pulse w-80 h-64 rounded-lg bg-muted" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
