import { auth } from "@/lib/auth"

export default auth((req) => {
  // Add any additional middleware logic here if needed
  return null
})

export const config = {
  matcher: [
    "/app/:path*",
    "/api/edit-image/:path*",
    "/api/create-payment-intent/:path*",
  "/api/checkout/:path*",
    // Add other protected routes here
  ],
}
