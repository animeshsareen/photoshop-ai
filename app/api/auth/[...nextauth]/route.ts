import { handlers } from "@/lib/auth"

export const { GET, POST } = handlers

// Use Node.js runtime to ensure compatibility with NextAuth and Supabase admin
export const runtime = "nodejs"
