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
  const [displayName, setDisplayName] = useState<string>("")
  const [isEditingName, setIsEditingName] = useState(false)
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
    const savedMessages = localStorage.getItem(`messages-${roomId}`)
    if (savedMessages) {
      try {
        const parsedMessages = JSON.parse(savedMessages).map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }))
        setMessages(parsedMessages)
      } catch (error) {
        console.error("[v0] Error loading saved messages:", error)
      }
    }

    const savedDisplayName = localStorage.getItem("displayName")
    if (savedDisplayName) {
      setDisplayName(savedDisplayName)
    }
  }, [roomId])

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`messages-${roomId}`, JSON.stringify(messages))
    }
  }, [messages, roomId])

  useEffect(() => {
    const preventScreenshot = (e: KeyboardEvent) => {
      // Prevent common screenshot shortcuts
      if (
        (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) ||
        (e.metaKey && e.shiftKey && (e.key === "3" || e.key === "4" || e.key === "5")) ||
        e.key === "PrintScreen" ||
        (e.altKey && e.key === "PrintScreen") ||
        (e.ctrlKey && e.key === "p") ||
        (e.metaKey && e.key === "p")
      ) {
        e.preventDefault()
        e.stopPropagation()
        return false
      }
    }

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      return false
    }

    const preventLongPress = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault()
      }
    }

    const preventVisibilityChange = () => {
      if (document.hidden) {
        document.body.style.display = "none"
      } else {
        document.body.style.display = "block"
      }
    }

    document.addEventListener("keydown", preventScreenshot, { capture: true })
    document.addEventListener("contextmenu", preventContextMenu, { capture: true })
    document.addEventListener("touchstart", preventLongPress, { passive: false })
    document.addEventListener("visibilitychange", preventVisibilityChange)

    // Prevent screenshot on mobile devices
    const preventMobileScreenshot = () => {
      if (navigator.userAgent.match(/iPhone|iPad|iPod|Android/i)) {
        document.body.style.webkitUserSelect = "none"
        document.body.style.webkitTouchCallout = "none"
      }
    }
    preventMobileScreenshot()

    return () => {
      document.removeEventListener("keydown", preventScreenshot, { capture: true })
      document.removeEventListener("contextmenu", preventContextMenu, { capture: true })
      document.removeEventListener("touchstart", preventLongPress)
      document.removeEventListener("visibilitychange", preventVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const id = getOrCreateClientId()
    setClientId(id)

    if (!displayName) {
      const defaultName = `User ${id.slice(0, 8)}`
      setDisplayName(defaultName)
      localStorage.setItem("displayName", defaultName)
    }
  }, [displayName])

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
          sender:
            file.sender === clientId
              ? "You"
              : participants.find((p) => p.clientId === file.sender)?.displayName || `User ${file.sender.slice(0, 8)}`,
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

    socket.emit("join-room", { roomId, clientId, displayName })

    socket.on("connect", () => {
      setIsConnected(true)
      console.log("[v0] Connected to server")
      // Re-emit join-room on reconnection to ensure proper room joining
      socket.emit("join-room", { roomId, clientId, displayName })
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
        sender: data.clientId === clientId ? "You" : data.displayName || `User ${data.clientId.slice(0, 8)}`,
      }
      setMessages((prev) => [...prev, message])
    })

    return () => {
      socket.emit("leave-room", { roomId, clientId })
      console.log(`[v0] Leaving room: ${roomId} with clientId: ${clientId}`)
      manager.cleanup()
      disconnectSocket()
    }
  }, [roomId, clientId, displayName, participants])

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
        displayName,
        message: newMessage.trim(),
        timestamp: new Date().toISOString(),
      })

      setNewMessage("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Enter or Cmd+Enter to send message
        e.preventDefault()
        if (isEditingName) {
          handleNameSave()
        } else {
          sendMessage()
        }
      }
      // Regular Enter adds line break (default textarea behavior)
    }
    if (e.key === "Escape" && isEditingName) {
      setIsEditingName(false)
    }
  }

  const handleNameSave = () => {
    if (displayName.trim()) {
      localStorage.setItem("displayName", displayName.trim())
      setIsEditingName(false)
      // Re-join room with new display name
      const socket = getSocket()
      socket.emit("join-room", { roomId, clientId, displayName: displayName.trim() })
    }
  }

  const toggleVideo = async () => {
    if (!webrtcManager) return

    if (!isVideoEnabled) {
      try {
        const stream = await webrtcManager.startLocalVideo()
        if (stream) {
          setLocalStream(stream)
          setIsVideoEnabled(true)
        }
      } catch (error) {
        console.error("[v0] Error accessing camera:", error)
        alert("Camera access denied. Please allow camera access and try again.")
      }
    } else {
      webrtcManager.stopLocalVideo()
      setIsVideoEnabled(false)

      // Update local stream to reflect current state
      const currentStream = webrtcManager.getLocalStream()
      setLocalStream(currentStream)
    }
  }

  const toggleAudio = async () => {
    if (!webrtcManager) return

    if (!isAudioEnabled) {
      try {
        const stream = await webrtcManager.startLocalAudio()
        if (stream) {
          setLocalStream(stream)
          setIsAudioEnabled(true)
        }
      } catch (error) {
        console.error("[v0] Error accessing microphone:", error)
        alert("Microphone access denied. Please allow microphone access and try again.")
      }
    } else {
      webrtcManager.stopLocalAudio()
      setIsAudioEnabled(false)

      // Update local stream to reflect current state
      const currentStream = webrtcManager.getLocalStream()
      setLocalStream(currentStream)
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
    <div className="h-screen bg-white flex flex-col overflow-hidden touch-none">
      <header className="bg-[#4B2E2E] text-white p-2 sm:p-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-semibold truncate">Echo - Room: {roomId.slice(0, 8)}...</h1>
            <div className="flex items-center gap-2 sm:gap-4 mt-1 flex-wrap">
              <p className="text-xs sm:text-sm text-gray-200">{isConnected ? "Connected" : "Connecting..."}</p>
              <div className="flex items-center gap-1">
                <Users className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="text-xs sm:text-sm">{participants.length + 1}</span>
              </div>
              <div className="flex items-center gap-2">
                {isEditingName ? (
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleNameSave()
                      if (e.key === "Escape") setIsEditingName(false)
                    }}
                    onBlur={handleNameSave}
                    className="h-5 sm:h-6 text-xs bg-white text-black px-2 w-20 sm:w-32"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="text-xs text-gray-200 hover:text-white underline truncate max-w-20 sm:max-w-32"
                    title="Click to edit your name"
                  >
                    {displayName}
                  </button>
                )}
              </div>
              <Button
                onClick={copyRoomLink}
                variant="outline"
                size="sm"
                className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent text-xs h-6 sm:h-8 px-2"
                title="Copy room link"
              >
                <Copy className="w-3 h-3 sm:mr-1" />
                <span className="hidden sm:inline">{showShareableLink ? "Copied!" : "Share"}</span>
              </Button>
            </div>
            {process.env.NODE_ENV === "development" && clientId && (
              <p className="text-xs text-gray-300 hidden sm:block">Client: {clientId.slice(0, 8)}...</p>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-2 ml-2">
            <Button
              onClick={toggleVideo}
              variant="outline"
              size="sm"
              className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent h-8 w-8 p-0"
              title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {isVideoEnabled ? <VideoIcon className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </Button>
            <Button
              onClick={toggleAudio}
              variant="outline"
              size="sm"
              className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent h-8 w-8 p-0"
              title={isAudioEnabled ? "Mute" : "Unmute"}
            >
              {isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </Button>
            <Button
              variant="outline"
              className="border-white text-white hover:bg-white hover:text-[#4B2E2E] bg-transparent text-xs h-8 px-2 hidden sm:inline-flex"
              onClick={() => (window.location.href = "/")}
            >
              Leave
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl mx-auto p-2 sm:p-4 overflow-hidden w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-4 h-full">
          <div className="lg:col-span-2 order-2 lg:order-1">
            <Card className="h-full">
              <CardHeader className="flex-shrink-0 p-3 sm:p-6">
                <CardTitle className="text-base sm:text-lg text-black flex items-center gap-2">
                  Video
                  <div className="flex gap-1 ml-auto flex-wrap">
                    {participants.slice(0, 3).map((participant) => (
                      <Badge key={participant.clientId} variant="secondary" className="text-xs">
                        {participant.displayName.slice(0, 8)}
                      </Badge>
                    ))}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-3 sm:p-6 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 h-full">
                  <div className="bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-200 relative min-h-[200px] sm:min-h-[250px]">
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
                        <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-300 rounded-full mx-auto mb-2"></div>
                        <p className="text-sm">Your Video</p>
                        <p className="text-xs">(Camera not connected)</p>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                      {displayName.slice(0, 10)}
                    </div>
                  </div>

                  {participants.length > 0 ? (
                    participants.slice(0, 3).map((participant) => (
                      <div
                        key={participant.clientId}
                        className="bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-200 relative min-h-[200px] sm:min-h-[250px]"
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
                            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-300 rounded-full mx-auto mb-2"></div>
                            <p className="text-sm">{participant.displayName.slice(0, 10)}</p>
                            <p className="text-xs">(No video)</p>
                          </div>
                        )}
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                          {participant.displayName.slice(0, 10)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-200 min-h-[200px] sm:min-h-[250px]">
                      <div className="text-center text-gray-500">
                        <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-300 rounded-full mx-auto mb-2"></div>
                        <p className="text-sm">Waiting for participant...</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 order-1 lg:order-2">
            <Card className="h-full flex flex-col">
              <CardHeader className="flex-shrink-0 p-3 sm:p-6">
                <CardTitle className="text-base sm:text-lg text-black">Chat</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                <ScrollArea className="flex-1 p-3 sm:p-4">
                  <div className="space-y-3">
                    {messages.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-8">No messages yet. Start the conversation!</p>
                    ) : (
                      messages.map((message) => (
                        <div key={message.id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-black truncate">{message.sender}</span>
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
                            <p className="whitespace-pre-wrap break-words">{message.text}</p>
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

                <div className="p-3 sm:p-4 border-t border-gray-200 flex-shrink-0">
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
                      className="text-xs bg-transparent border-gray-200 h-8"
                    >
                      <Upload className="w-3 h-3 mr-1" />
                      <span className="hidden sm:inline">Upload File</span>
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <textarea
                      placeholder="Type a message... (Ctrl+Enter to send)"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm resize-none min-h-[40px] max-h-[120px]"
                      rows={1}
                      style={{
                        height: "auto",
                        minHeight: "40px",
                        maxHeight: "120px",
                        overflowY: newMessage.split("\n").length > 3 ? "scroll" : "hidden",
                      }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement
                        target.style.height = "auto"
                        target.style.height = Math.min(target.scrollHeight, 120) + "px"
                      }}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!newMessage.trim()}
                      className="bg-[#4B2E2E] hover:bg-[#3A2323] text-white h-10 px-3 sm:px-4"
                      title="Send message (Ctrl+Enter)"
                    >
                      Send
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Press Ctrl+Enter to send, Enter for new line</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
