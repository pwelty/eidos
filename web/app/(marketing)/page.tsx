import Link from "next/link";

export const metadata = { title: "App" };

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">App</h1>
      <p className="text-muted-foreground text-center max-w-md">
        Replace this with your landing page content.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="px-4 py-2 rounded-md border hover:bg-accent transition-colors"
        >
          Sign up
        </Link>
      </div>
    </main>
  );
}
