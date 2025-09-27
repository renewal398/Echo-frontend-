"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { getOrCreateClientId } from "@/lib/client-id"
import { getSocket, disconnectSocket } from "@/lib/socket"
import { WebRTCManager, type MediaFile, type Participant } from "@/lib/webrtc"
import { Upload, Download, ImageIcon, Video, Users, VideoIcon, VideoOff, Mic, MicOff, Copy } from "lucide-react"

interface Message {
  id: string
  text: string
  timestamp: Date
  sender: string
  type?: "text" | "file"
  file?: MediaFile
}

export default function RoomPage() {
  const params = useParams()
  const searchParams = useSearchParams()

  const getRoomId = () => {
    const paramRoomId = params.id as string
    const queryRoomId = searchParams.get("room")

    // If no room ID in URL, generate one and update URL
    if (!paramRoomId && !queryRoomId) {
      const newRoomId = crypto.randomUUID()
      window.history.replaceState({}, "", `/room/${newRoomId}`)
      return newRoomId
    }

    return paramRoomId || queryRoomId || crypto.randomUUID()
  }

  const roomId = getRoomId()
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [clientId, setClientId] = useState<string>("")
  const [webrtcManager, setWebrtcManager] = useState<WebRTCManager | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isVideoEnabled, setIsVideoEnabled] = useState(false)
  const [isAudioEnabled, setIsAudioEnabled] = useState(false)
  const [showShareableLink, setShowShareableLink] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const id = getOrCreateClientId()
    setClientId(id)
  }, [])

  useEffect(() => {
    if (!clientId) return

    const socket = getSocket()

    console.log(`[v0] Attempting to join room: ${roomId} with clientId: ${clientId}`)

    const manager = new WebRTCManager(
      socket,
      (file: MediaFile) => {
        const message: Message = {
          id: crypto.randomUUID(),
          text: `Shared file: ${file.name}`,
          timestamp: file.timestamp,
          sender: file.sender === clientId ? "You" : `User ${file.sender.slice(0, 8)}`,
          type: "file",
          file,
        }
        setMessages((prev) => [...prev, message])
      },
      (updatedParticipants: Participant[]) => {
        console.log("[v0] Participants updated:", updatedParticipants.length)
        setParticipants(updatedParticipants)
      },
    )

    manager.setClientId(clientId)
    setWebrtcManager(manager)

    socket.emit("join-room", { roomId, clientId, displayName: `User ${clientId.slice(0, 8)}` })

    socket.on("connect", () => {
      setIsConnected(true)
      console.log("[v0] Connected to server")
      // Re-emit join-room on reconnection to ensure proper room joining
      socket.emit("join-room", { roomId, clientId, displayName: `User ${clientId.slice(0, 8)}` })
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
      console.log("[v0] Disconnected from server")
    })

    socket.on("receive-message", (data) => {
      console.log("[v0] Received message:", data)
      const message: Message = {
        id: crypto.randomUUID(),
        text: data.message,
        timestamp: new Date(data.timestamp || Date.now()),
        sender: data.clientId === clientId ? "You" : `User ${data.clientId.slice(0, 8)}`,
      }
      setMessages((prev) => [...prev, message])
    })

    return () => {
      socket.emit("leave-room", { roomId, clientId })
      console.log(`[v0] Leaving room: ${roomId} with clientId: ${clientId}`)
      manager.cleanup()
      disconnectSocket()
    }
  }, [roomId, clientId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  const sendMessage = () => {
    if (newMessage.trim()) {
      const socket = getSocket()

      socket.emit("send-message", {
        roomId,
        clientId,
        message: newMessage.trim(),
        timestamp: new Date().toISOString(),
      })

      setNewMessage("")
    }
  }

  const toggleVideo = async () => {
    if (!webrtcManager) return

    if (!isVideoEnabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })

        if (stream) {
          setLocalStream(stream)
          setIsVideoEnabled(true)
          setIsAudioEnabled(true)

          await webrtcManager.startLocalVideo()
        }
      } catch (error) {
        console.error("[v0] Error accessing camera:", error)
        alert("Camera access denied. Please allow camera access and try again.")
      }
    } else {
      webrtcManager.stopLocalVideo()
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop())
      }
      setLocalStream(null)
      setIsVideoEnabled(false)
      setIsAudioEnabled(false)
    }
  }

  const toggleAudio = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks()
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsAudioEnabled(!isAudioEnabled)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !webrtcManager) return

    try {
      console.log("[v0] Attempting to send file. Total channels:", webrtcManager.getParticipants().length)

      await webrtcManager.sendFile(file, clientId)

      const message: Message = {
        id: crypto.randomUUID(),
        text: `Shared file: ${file.name}`,
        timestamp: new Date(),
        sender: "You",
        type: "file",
        file: {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          size: file.size,
          data: await file.arrayBuffer(),
          timestamp: new Date(),
          sender: clientId,
        },
      }
      setMessages((prev) => [...prev, message])
    } catch (error) {
      console.error("[v0] Error sending file:", error)
      alert(
        `Failed to send file: ${error instanceof Error ? error.message : "Unknown error"}. Make sure other users are connected to the room.`,
      )
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const downloadFile = (file: MediaFile) => {
    const blob = new Blob([file.data], { type: file.type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const renderFilePreview = (file: MediaFile) => {
    if (file.type.startsWith("image/")) {
      const blob = new Blob([file.data], { type: file.type })
      const url = URL.createObjectURL(blob)
      return (
        <div className="mt-2">
          <img src={url || "/placeholder.svg"} alt={file.name} className="max-w-xs max-h-48 rounded border" />
        </div>
      )
    } else if (file.type.startsWith("video/")) {
      const blob = new Blob([file.data], { type: file.type })
      const url = URL.createObjectURL(blob)
      return (
        <div className="mt-2">
          <video controls className="max-w-xs max-h-48 rounded border">
            <source src={url} type={file.type} />
          </video>
        </div>
      )
    } else if (file.type.startsWith("audio/")) {
      const blob = new Blob([file.data], { type: file.type })
      const url = URL.createObjectURL(blob)
      return (
        <div className="mt-2">
          <audio controls className="w-full max-w-xs">
            <source src={url} type={file.type} />
          </audio>
        </div>
      )
    }
    return null
  }

  const copyRoomLink = () => {
    const link = `${window.location.origin}/room/${roomId}`
    navigator.clipboard.writeText(link)
    setShowShareableLink(true)
    setTimeout(() => setShowShareableLink(false), 2000)
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-[#4B2E2E] text-white p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Echo - Room: {roomId.slice(0, 8)}...</h1>
            <div className="flex items-center gap-4 mt-1">
              <p className="text-sm text-gray-200">{isConnected ? "Connected" : "Connecting..."}</p>
              <div className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                <span className="text-sm">{participants.length + 1} participants</span>
              </div>
              <Button
                onClick={copyRoomLink}
                variant="outline"
                size="sm"
                className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent text-xs"
                title="Copy room link"
              >
                <Copy className="w-3 h-3 mr-1" />
                {showShareableLink ? "Copied!" : "Share"}
              </Button>
            </div>
            {process.env.NODE_ENV === "development" && clientId && (
              <p className="text-xs text-gray-300">Client: {clientId.slice(0, 8)}...</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={toggleVideo}
              variant="outline"
              size="sm"
              className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent"
              title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {isVideoEnabled ? <VideoIcon className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </Button>
            <Button
              onClick={toggleAudio}
              variant="outline"
              size="sm"
              className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent"
              disabled={!isVideoEnabled}
              title={isAudioEnabled ? "Mute" : "Unmute"}
            >
              {isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </Button>
            <Button
              variant="outline"
              className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent"
              onClick={() => (window.location.href = "/")}
            >
              Leave Room
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-120px)]">
          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-lg text-black flex items-center gap-2">
                  Video
                  <div className="flex gap-1 ml-auto">
                    {participants.map((participant) => (
                      <Badge key={participant.clientId} variant="secondary" className="text-xs">
                        {participant.displayName}
                      </Badge>
                    ))}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[calc(100%-80px)]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  <div className="bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-200 relative">
                    {localStream ? (
                      <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="text-center text-gray-500">
                        <div className="w-16 h-16 bg-gray-300 rounded-full mx-auto mb-2"></div>
                        <p className="text-sm">Your Video</p>
                        <p className="text-xs">(Camera not connected)</p>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                      You
                    </div>
                  </div>

                  {participants.length > 0 ? (
                    participants.slice(0, 3).map((participant) => (
                      <div
                        key={participant.clientId}
                        className="bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-200 relative"
                      >
                        {participant.stream ? (
                          <video
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover rounded-lg"
                            ref={(video) => {
                              if (video && participant.stream) {
                                video.srcObject = participant.stream
                              }
                            }}
                          />
                        ) : (
                          <div className="text-center text-gray-500">
                            <div className="w-16 h-16 bg-gray-300 rounded-full mx-auto mb-2"></div>
                            <p className="text-sm">{participant.displayName}</p>
                            <p className="text-xs">(No video)</p>
                          </div>
                        )}
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                          {participant.displayName}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-200">
                      <div className="text-center text-gray-500">
                        <div className="w-16 h-16 bg-gray-300 rounded-full mx-auto mb-2"></div>
                        <p className="text-sm">Waiting for participant...</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="h-full flex flex-col">
              <CardHeader>
                <CardTitle className="text-lg text-black">Chat</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0">
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-3">
                    {messages.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-8">No messages yet. Start the conversation!</p>
                    ) : (
                      messages.map((message) => (
                        <div key={message.id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-black">{message.sender}</span>
                            <span className="text-xs text-gray-500">{message.timestamp.toLocaleTimeString()}</span>
                            {message.type === "file" && (
                              <div className="flex items-center gap-1">
                                {message.file?.type.startsWith("image/") ? (
                                  <ImageIcon className="w-3 h-3" />
                                ) : message.file?.type.startsWith("video/") ? (
                                  <Video className="w-3 h-3" />
                                ) : (
                                  <Upload className="w-3 h-3" />
                                )}
                              </div>
                            )}
                          </div>
                          <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                            <p>{message.text}</p>
                            {message.file && (
                              <div>
                                {renderFilePreview(message.file)}
                                <Button
                                  onClick={() => downloadFile(message.file!)}
                                  variant="outline"
                                  size="sm"
                                  className="mt-2 text-xs"
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  Download ({(message.file.size / 1024).toFixed(1)}KB)
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                <div className="p-4 border-t border-gray-200">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                  />

                  <div className="flex gap-2 mb-2">
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="outline"
                      size="sm"
                      className="text-xs bg-transparent border-gray-200"
                    >
                      <Upload className="w-3 h-3 mr-1" />
                      Upload File
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                      className="flex-1 border-gray-200"
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!newMessage.trim()}
                      className="bg-[#4B2E2E] hover:bg-[#3A2323] text-white"
                    >
                      Send
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
