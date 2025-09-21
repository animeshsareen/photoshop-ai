import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Merge: broaden include pattern to also match *.spec and TSX tests
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // Keep: allow repo without tests to pass CI
    passWithNoTests: true,
    // Merge: enable globals from the second config
    globals: true,
    // Keep: inline Next.js deps for Vitest compatibility
    deps: {
      inline: [/next\//],
    },
  },
})
