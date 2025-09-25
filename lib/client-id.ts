// Utility functions for persistent client ID management
export function getOrCreateClientId(): string {
  if (typeof window === "undefined") return "" // SSR safety

  const existingClientId = localStorage.getItem("webrtc-client-id")

  if (existingClientId) {
    return existingClientId
  }

  const newClientId = crypto.randomUUID()
  localStorage.setItem("webrtc-client-id", newClientId)
  return newClientId
}

export function getClientId(): string | null {
  if (typeof window === "undefined") return null // SSR safety
  return localStorage.getItem("webrtc-client-id")
}
