import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose conditional classes while keeping Tailwind overrides predictable. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
