export const CREDITS_PER_DOLLAR = 10
export const CREDIT_COST_PER_EDIT = 1

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
