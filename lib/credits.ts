export const CREDITS_PER_DOLLAR = 6
export const CREDIT_COST_PER_EDIT = 1
// Number of free credits granted to a brand new user (first sign-in in this browser)
export const DEFAULT_FREE_CREDITS = 2

export function getCredits(): number {
  if (typeof window === "undefined") return 0
  const credits = localStorage.getItem("user_credits")
  return credits ? Number.parseInt(credits, 10) : 0
}

export function setCredits(credits: number): void {
  if (typeof window === "undefined") return
  localStorage.setItem("user_credits", credits.toString())
}

export function deductCredits(amount: number): boolean {
  const currentCredits = getCredits()
  if (currentCredits >= amount) {
    setCredits(currentCredits - amount)
    return true
  }
  return false
}

export function addCredits(amount: number): void {
  const currentCredits = getCredits()
  setCredits(currentCredits + amount)
}

// Initialize credits for a new user if they have none stored locally yet.
// Returns true if initialization happened.
export function ensureInitialCredits(): boolean {
  if (typeof window === "undefined") return false
  const existing = localStorage.getItem("user_credits")
  if (existing === null) {
    setCredits(DEFAULT_FREE_CREDITS)
    // Inform any listeners (e.g., credit display components)
    window.dispatchEvent(new Event("creditsUpdated"))
    return true
  }
  return false
}
