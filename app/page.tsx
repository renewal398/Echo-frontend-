"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const BACKEND_URL = "https://echo-hrfm.onrender.com"

export default function HomePage() {
  const [roomId, setRoomId] = useState("")
  const [generatedRoomId, setGeneratedRoomId] = useState("")
  const [showShareableLink, setShowShareableLink] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const urlRoomId = searchParams.get("room")
    if (urlRoomId) {
      // If there's a room ID in the URL, automatically navigate to that room
      router.push(`/room/${urlRoomId}`)
    }
  }, [searchParams, router])

  const createRoom = () => {
    const newRoomId = crypto.randomUUID()
    setGeneratedRoomId(newRoomId)
    setShowShareableLink(true)

    const newUrl = `${window.location.origin}?room=${newRoomId}`
    window.history.pushState({}, "", `?room=${newRoomId}`)
  }

  const joinRoom = () => {
    if (roomId.trim()) {
      router.push(`/room/${roomId.trim()}`)
    }
  }

  const joinGeneratedRoom = () => {
    if (generatedRoomId) {
      router.push(`/room/${generatedRoomId}`)
    }
  }

  const copyLink = () => {
    const link = `${window.location.origin}?room=${generatedRoomId}`
    navigator.clipboard.writeText(link)
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold text-black">Echo</CardTitle>
          <CardDescription className="text-gray-600">Create or join a private video room</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Create Room Section */}
          <div className="space-y-3">
            <Button onClick={createRoom} className="w-full bg-[#4B2E2E] hover:bg-[#3A2323] text-white">
              Create Room
            </Button>

            {showShareableLink && (
              <div className="p-3 bg-gray-50 rounded-md space-y-2">
                <p className="text-sm text-gray-700 font-medium">Room created!</p>
                <p className="text-xs text-gray-600 break-all">
                  {window.location.origin}?room={generatedRoomId}
                </p>
                <div className="flex gap-2">
                  <Button onClick={copyLink} variant="outline" size="sm" className="text-xs bg-transparent">
                    Copy Link
                  </Button>
                  <Button
                    onClick={joinGeneratedRoom}
                    size="sm"
                    className="text-xs bg-[#4B2E2E] hover:bg-[#3A2323] text-white"
                  >
                    Join Room
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Join Existing Room Section */}
          <div className="space-y-3">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">Or join existing room</span>
              </div>
            </div>

            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Enter room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="border-gray-200"
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              />
              <Button
                onClick={joinRoom}
                variant="outline"
                className="w-full border-gray-200 text-gray-700 hover:bg-gray-50 bg-transparent"
                disabled={!roomId.trim()}
              >
                Join Room
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
