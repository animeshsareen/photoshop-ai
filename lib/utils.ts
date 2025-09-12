import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getForwardedIp(h: Headers): string | null {
  const xf = h.get("x-forwarded-for") || ""
  if (xf) {
    const first = xf.split(",")[0]?.trim()
    if (first) return first
  }
  return h.get("x-real-ip") || null
}
