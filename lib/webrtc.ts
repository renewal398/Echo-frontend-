export interface MediaFile {
  id: string
  name: string
  type: string
  size: number
  data: ArrayBuffer
  timestamp: Date
  sender: string
}

export interface Participant {
  clientId: string
  displayName: string
  isConnected: boolean
  stream?: MediaStream
}

export class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map()
  private dataChannels: Map<string, RTCDataChannel> = new Map()
  private localStream: MediaStream | null = null
  private onFileReceived?: (file: MediaFile) => void
  private onParticipantUpdate?: (participants: Participant[]) => void
  private participants: Map<string, Participant> = new Map()
  private socket: any
  private clientId = ""

  constructor(
    socket: any,
    onFileReceived?: (file: MediaFile) => void,
    onParticipantUpdate?: (participants: Participant[]) => void,
  ) {
    this.socket = socket
    this.onFileReceived = onFileReceived
    this.onParticipantUpdate = onParticipantUpdate
    this.setupSocketListeners()
  }

  setClientId(clientId: string) {
    this.clientId = clientId
  }

  private setupSocketListeners() {
    this.socket.on("user-joined", (data: { clientId: string; displayName?: string }) => {
      console.log("[v0] User joined:", data.clientId)
      if (data.clientId !== this.clientId) {
        const displayName = data.displayName || `User ${data.clientId.slice(0, 8)}`
        this.addParticipant(data.clientId, displayName)
        setTimeout(() => {
          if (!this.peerConnections.has(data.clientId)) {
            this.createPeerConnection(data.clientId, true)
          }
        }, 1000)
      }
    })

    this.socket.on("user-left", (data: { clientId: string }) => {
      console.log("[v0] User left:", data.clientId)
      this.removeParticipant(data.clientId)
    })

    this.socket.on("signal", async (data: { from: string; signal: any }) => {
      console.log("[v0] Received signal from:", data.from, "type:", data.signal.type)

      try {
        if (data.signal.type === "offer") {
          await this.handleOffer(data.from, data.signal)
        } else if (data.signal.type === "answer") {
          await this.handleAnswer(data.from, data.signal)
        } else if (data.signal.candidate) {
          await this.handleIceCandidate(data.from, data.signal)
        }
      } catch (error) {
        console.error("[v0] Error handling signal:", error)
      }
    })

    this.socket.on("participants-list", (participants: Array<{ clientId: string; displayName?: string }>) => {
      console.log("[v0] Received participants list:", participants)
      this.updateParticipantsList(participants)
      const otherParticipants = participants.filter((p) => p.clientId !== this.clientId)
      console.log("[v0] Other participants to connect to:", otherParticipants.length)

      otherParticipants.forEach((p) => {
        if (!this.peerConnections.has(p.clientId)) {
          setTimeout(() => {
            if (!this.peerConnections.has(p.clientId) && this.participants.has(p.clientId)) {
              console.log("[v0] Creating delayed connection to:", p.clientId)
              this.createPeerConnection(p.clientId, true)
            }
          }, 500)
        }
      })
    })
  }

  private addParticipant(clientId: string, displayName: string) {
    if (!clientId || typeof clientId !== "string") {
      console.error("[v0] Invalid clientId provided to addParticipant:", clientId)
      return
    }

    const safeName = displayName && typeof displayName === "string" ? displayName : `User ${clientId.slice(0, 8)}`
    this.participants.set(clientId, {
      clientId,
      displayName: safeName,
      isConnected: true,
    })
    this.notifyParticipantUpdate()
  }

  private removeParticipant(clientId: string) {
    const pc = this.peerConnections.get(clientId)
    if (pc) {
      pc.close()
      this.peerConnections.delete(clientId)
    }

    const dc = this.dataChannels.get(clientId)
    if (dc) {
      dc.close()
      this.dataChannels.delete(clientId)
    }

    this.participants.delete(clientId)
    this.notifyParticipantUpdate()
  }

  private updateParticipantsList(participants: Array<{ clientId: string; displayName?: string }>) {
    this.participants.clear()
    if (!Array.isArray(participants)) {
      console.error("[v0] Invalid participants array:", participants)
      this.notifyParticipantUpdate()
      return
    }

    participants.forEach((p) => {
      if (p && p.clientId && typeof p.clientId === "string" && p.clientId !== this.clientId) {
        const safeName =
          p.displayName && typeof p.displayName === "string" ? p.displayName : `User ${p.clientId.slice(0, 8)}`
        this.participants.set(p.clientId, {
          clientId: p.clientId,
          displayName: safeName,
          isConnected: true,
        })
      }
    })
    this.notifyParticipantUpdate()
  }

  private notifyParticipantUpdate() {
    if (this.onParticipantUpdate) {
      this.onParticipantUpdate(Array.from(this.participants.values()))
    }
  }

  private async createPeerConnection(remoteClientId: string, isInitiator: boolean) {
    if (this.peerConnections.has(remoteClientId)) {
      console.log("[v0] Peer connection already exists for:", remoteClientId)
      return
    }

    console.log("[v0] Creating peer connection with:", remoteClientId, "as initiator:", isInitiator)

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.services.mozilla.com" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    })

    this.peerConnections.set(remoteClientId, pc)

    if (this.localStream) {
      console.log("[v0] Adding local stream tracks to peer connection:", remoteClientId)
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!)
      })
    }

    pc.ontrack = (event) => {
      console.log("[v0] Received remote stream from:", remoteClientId)
      const participant = this.participants.get(remoteClientId)
      if (participant && event.streams[0]) {
        participant.stream = event.streams[0]
        this.notifyParticipantUpdate()
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("signal", {
          to: remoteClientId,
          signal: event.candidate.toJSON(),
        })
      }
    }

    pc.onconnectionstatechange = () => {
      console.log("[v0] Connection state with", remoteClientId, ":", pc.connectionState)
      if (pc.connectionState === "failed") {
        console.log("[v0] Connection failed with:", remoteClientId, "- cleaning up")
        this.peerConnections.delete(remoteClientId)
        pc.close()

        // Attempt reconnection after cleanup
        setTimeout(() => {
          if (this.participants.has(remoteClientId) && !this.peerConnections.has(remoteClientId)) {
            console.log("[v0] Attempting to reconnect to:", remoteClientId)
            this.createPeerConnection(remoteClientId, true)
          }
        }, 3000)
      } else if (pc.connectionState === "disconnected") {
        console.log("[v0] Connection disconnected with:", remoteClientId, "- waiting for reconnection")
        // Don't immediately reconnect on disconnect, wait for failed state
      }
    }

    if (isInitiator) {
      try {
        const dataChannel = pc.createDataChannel("fileTransfer", { ordered: true })
        this.setupDataChannel(dataChannel, remoteClientId)
        this.dataChannels.set(remoteClientId, dataChannel)
        console.log("[v0] Created data channel for:", remoteClientId)

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        this.socket.emit("signal", {
          to: remoteClientId,
          signal: offer,
        })
        console.log("[v0] Sent offer to:", remoteClientId)
      } catch (error) {
        console.error("[v0] Error creating offer:", error)
      }
    }

    pc.ondatachannel = (event) => {
      console.log("[v0] Received data channel from:", remoteClientId)
      this.setupDataChannel(event.channel, remoteClientId)
      this.dataChannels.set(remoteClientId, event.channel)
    }
  }

  private setupDataChannel(dataChannel: RTCDataChannel, remoteClientId: string) {
    dataChannel.onopen = () => {
      console.log("[v0] Data channel opened with:", remoteClientId)
    }

    dataChannel.onmessage = (event) => {
      console.log("[v0] Received message:", event.data)
      this.handleDataChannelMessage(event.data)
    }

    dataChannel.onerror = (error) => {
      console.error("[v0] Data channel error:", error)
    }

    dataChannel.onclose = () => {
      console.log("[v0] Data channel closed with:", remoteClientId)
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    let pc = this.peerConnections.get(from)
    if (!pc) {
      await this.createPeerConnection(from, false)
      pc = this.peerConnections.get(from)!
    }

    try {
      await pc.setRemoteDescription(offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      this.socket.emit("signal", {
        to: from,
        signal: answer,
      })

      console.log("[v0] Sent answer to:", from)
    } catch (error) {
      console.error("[v0] Error handling offer:", error)
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(from)
    if (pc) {
      try {
        await pc.setRemoteDescription(answer)
        console.log("[v0] Set remote description for answer from:", from)
      } catch (error) {
        console.error("[v0] Error handling answer:", error)
      }
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(from)
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error("[v0] Error adding ICE candidate:", error)
      }
    }
  }

  async startLocalAudio(): Promise<MediaStream | null> {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
          latency: 0.01, // Low latency for real-time
        },
      })

      // If we already have a video stream, combine them
      if (this.localStream) {
        const videoTracks = this.localStream.getVideoTracks()
        const audioTracks = audioStream.getAudioTracks()

        // Create combined stream
        const combinedStream = new MediaStream([...videoTracks, ...audioTracks])

        // Stop old audio tracks if any
        this.localStream.getAudioTracks().forEach((track) => track.stop())

        this.localStream = combinedStream
      } else {
        this.localStream = audioStream
      }

      // Add tracks to existing peer connections
      this.peerConnections.forEach((pc, clientId) => {
        console.log("[v0] Adding audio tracks to existing connection:", clientId)
        audioStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, this.localStream!)
        })
      })

      return this.localStream
    } catch (error) {
      console.error("[v0] Error accessing microphone:", error)
      return null
    }
  }

  async startLocalVideo(): Promise<MediaStream | null> {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: "user",
        },
        audio: false,
      })

      // If we already have an audio stream, combine them
      if (this.localStream) {
        const audioTracks = this.localStream.getAudioTracks()
        const videoTracks = videoStream.getVideoTracks()

        // Create combined stream
        const combinedStream = new MediaStream([...audioTracks, ...videoTracks])

        // Stop old video tracks if any
        this.localStream.getVideoTracks().forEach((track) => track.stop())

        this.localStream = combinedStream
      } else {
        this.localStream = videoStream
      }

      // Add tracks to existing peer connections
      this.peerConnections.forEach((pc, clientId) => {
        console.log("[v0] Adding video tracks to existing connection:", clientId)
        videoStream.getVideoTracks().forEach((track) => {
          pc.addTrack(track, this.localStream!)
        })
      })

      return this.localStream
    } catch (error) {
      console.error("[v0] Error accessing camera:", error)
      return null
    }
  }

  stopLocalAudio() {
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks()
      audioTracks.forEach((track) => track.stop())

      // If we still have video tracks, keep the stream with only video
      const videoTracks = this.localStream.getVideoTracks()
      if (videoTracks.length > 0) {
        this.localStream = new MediaStream(videoTracks)
      } else {
        this.localStream = null
      }
    }
  }

  stopLocalVideo() {
    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks()
      videoTracks.forEach((track) => track.stop())

      // If we still have audio tracks, keep the stream with only audio
      const audioTracks = this.localStream.getAudioTracks()
      if (audioTracks.length > 0) {
        this.localStream = new MediaStream(audioTracks)
      } else {
        this.localStream = null
      }
    }
  }

  stopAllMedia() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }
  }

  getParticipants(): Participant[] {
    return Array.from(this.participants.values())
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  cleanup() {
    this.stopAllMedia()

    this.dataChannels.forEach((dc) => dc.close())
    this.dataChannels.clear()

    this.peerConnections.forEach((pc) => pc.close())
    this.peerConnections.clear()

    this.participants.clear()
  }

  async sendFile(file: File, senderId: string): Promise<void> {
    const openChannels = Array.from(this.dataChannels.values()).filter((dc) => dc.readyState === "open")
    const totalChannels = this.dataChannels.size

    console.log(
      `[v0] Attempting to send file. Connected channels: ${openChannels.length}, Open channels: ${openChannels.length}`,
    )

    if (openChannels.length === 0) {
      throw new Error(
        `No connected peers to send file to. Connected channels: ${openChannels.length}, Open channels: ${totalChannels}`,
      )
    }

    const fileData = await file.arrayBuffer()
    const chunkSize = 16384 // 16KB chunks
    const totalChunks = Math.ceil(fileData.byteLength / chunkSize)

    const fileInfo = {
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      size: file.size,
      totalChunks,
      sender: senderId,
      timestamp: new Date().toISOString(),
    }

    // Send file info to all connected peers
    openChannels.forEach((dc) => {
      try {
        dc.send(JSON.stringify({ type: "file-info", data: fileInfo }))
      } catch (error) {
        console.error("[v0] Error sending file info:", error)
      }
    })

    // Send file chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, fileData.byteLength)
      const chunk = fileData.slice(start, end)

      const chunkData = {
        fileId: fileInfo.id,
        chunkIndex: i,
        totalChunks,
        data: Array.from(new Uint8Array(chunk)),
      }

      openChannels.forEach((dc) => {
        try {
          if (dc.readyState === "open") {
            dc.send(JSON.stringify({ type: "file-chunk", data: chunkData }))
          }
        } catch (error) {
          console.error("[v0] Error sending file chunk:", error)
        }
      })

      // Small delay between chunks to prevent overwhelming
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  private handleDataChannelMessage(data: string) {
    try {
      const message = JSON.parse(data)

      if (message.type === "file-info") {
        console.log("[v0] Received file info:", message.data.name)
        // Handle file info
      } else if (message.type === "file-chunk") {
        console.log("[v0] Received file chunk:", message.data.chunkIndex)
        // Handle file chunk
      }
    } catch (error) {
      console.error("[v0] Error parsing data channel message:", error)
    }
  }
}
