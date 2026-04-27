// lib/utils.ts — Required by shadcn/ui components
// cn() merges Tailwind classes với clsx + tailwind-merge để tránh conflicts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}