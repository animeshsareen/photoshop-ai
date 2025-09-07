// Public landing page: always show marketing content even if the user is authenticated.
// (Previously this page redirected authenticated users to /app, which prevented access
//  to the landing content after signing in.)
import LandingContent from "@/components/landing-content"

export default function LandingPage() {
  return <LandingContent />
}

