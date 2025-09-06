import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import LandingContent from "@/components/landing-content"

export default async function RootPage() {
  const session = await auth()
  if (session?.user) {
    redirect("/app")
  }
  return <LandingContent />
}
