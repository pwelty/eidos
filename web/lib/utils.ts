import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge Tailwind classes safely (handles conflicts like `px-2 px-4` → `px-4`).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
