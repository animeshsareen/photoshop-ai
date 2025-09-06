import { Suspense } from "react"
import SuccessClient from "./success-client"

// The page is a Server Component. We wrap the client logic (search params usage) in Suspense
// to satisfy Next.js requirement for useSearchParams.
export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-2xl font-semibold">Payment Successful</h1>
            <p>Applying credits...</p>
          </div>
        </div>
      }
    >
      <SuccessClient />
    </Suspense>
  )
}
