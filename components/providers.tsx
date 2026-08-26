"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { ThemeProvider } from "next-themes"

import { Toaster } from "@/components/ui/sonner"

export function AppProviders({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  )
}