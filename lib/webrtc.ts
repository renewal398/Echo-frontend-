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

  private setupSocketListeners() {
    this.socket.on("user-joined", (data: { clientId: string; displayName: string }) => {
      console.log("[v0] User joined:", data.clientId)
      this.addParticipant(data.clientId, data.displayName)
      setTimeout(() => this.createPeerConnection(data.clientId, true), 100)
    })

    this.socket.on("user-left", (data: { clientId: string }) => {
      console.log("[v0] User left:", data.clientId)
      this.removeParticipant(data.clientId)
    })

    this.socket.on("webrtc-offer", async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
      console.log("[v0] Received offer from:", data.from)
      await this.handleOffer(data.from, data.offer)
    })

    this.socket.on("webrtc-answer", async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      console.log("[v0] Received answer from:", data.from)
      await this.handleAnswer(data.from, data.answer)
    })

    this.socket.on("webrtc-ice-candidate", async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      console.log("[v0] Received ICE candidate from:", data.from)
      await this.handleIceCandidate(data.from, data.candidate)
    })

    this.socket.on("participants-list", (participants: Array<{ clientId: string; displayName: string }>) => {
      console.log("[v0] Received participants list:", participants)
      this.updateParticipantsList(participants)
      participants.forEach((p) => {
        if (!this.peerConnections.has(p.clientId)) {
          setTimeout(() => this.createPeerConnection(p.clientId, true), 200)
        }
      })
    })
  }

  private addParticipant(clientId: string, displayName: string) {
    this.participants.set(clientId, {
      clientId,
      displayName,
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

  private updateParticipantsList(participants: Array<{ clientId: string; displayName: string }>) {
    this.participants.clear()
    participants.forEach((p) => {
      this.participants.set(p.clientId, {
        clientId: p.clientId,
        displayName: p.displayName,
        isConnected: true,
      })
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
      ],
    })

    this.peerConnections.set(remoteClientId, pc)

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!)
      })
    }

    pc.ontrack = (event) => {
      console.log("[v0] Received remote stream from:", remoteClientId)
      const participant = this.participants.get(remoteClientId)
      if (participant) {
        participant.stream = event.streams[0]
        this.notifyParticipantUpdate()
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("webrtc-ice-candidate", {
          to: remoteClientId,
          candidate: event.candidate.toJSON(),
        })
      }
    }

    pc.onconnectionstatechange = () => {
      console.log("[v0] Connection state with", remoteClientId, ":", pc.connectionState)
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setTimeout(() => {
          if (this.participants.has(remoteClientId)) {
            this.removeParticipant(remoteClientId)
            this.createPeerConnection(remoteClientId, true)
          }
        }, 1000)
      }
    }

    if (isInitiator) {
      const dataChannel = pc.createDataChannel("fileTransfer", { ordered: true })
      this.setupDataChannel(dataChannel, remoteClientId)
      this.dataChannels.set(remoteClientId, dataChannel)
    }

    pc.ondatachannel = (event) => {
      console.log("[v0] Received data channel from:", remoteClientId)
      this.setupDataChannel(event.channel, remoteClientId)
      this.dataChannels.set(remoteClientId, event.channel)
    }

    if (isInitiator) {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        this.socket.emit("webrtc-offer", {
          to: remoteClientId,
          offer: offer,
        })
        console.log("[v0] Sent offer to:", remoteClientId)
      } catch (error) {
        console.error("[v0] Error creating offer:", error)
      }
    }
  }

  private setupDataChannel(dataChannel: RTCDataChannel, remoteClientId: string) {
    dataChannel.onopen = () => {
      console.log("[v0] Data channel opened with:", remoteClientId)
    }

    dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data)
    }

    dataChannel.onerror = (error) => {
      console.error("[v0] Data channel error:", error)
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

      this.socket.emit("webrtc-answer", {
        to: from,
        answer: answer,
      })
    } catch (error) {
      console.error("[v0] Error handling offer:", error)
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(from)
    if (pc) {
      try {
        await pc.setRemoteDescription(answer)
      } catch (error) {
        console.error("[v0] Error handling answer:", error)
      }
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(from)
    if (pc) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error("[v0] Error adding ICE candidate:", error)
      }
    }
  }

  async startLocalVideo(): Promise<MediaStream | null> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })

      this.peerConnections.forEach((pc) => {
        this.localStream!.getTracks().forEach((track) => {
          pc.addTrack(track, this.localStream!)
        })
      })

      return this.localStream
    } catch (error) {
      console.error("[v0] Error accessing media devices:", error)
      return null
    }
  }

  stopLocalVideo() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }
  }

  private handleDataChannelMessage(data: string) {
    try {
      const message = JSON.parse(data)
      if (message.type === "file" && this.onFileReceived) {
        const fileData: MediaFile = {
          id: message.id,
          name: message.name,
          type: message.fileType,
          size: message.size,
          data: new Uint8Array(message.data).buffer,
          timestamp: new Date(message.timestamp),
          sender: message.sender,
        }
        this.onFileReceived(fileData)
      }
    } catch (error) {
      console.error("[v0] Error parsing data channel message:", error)
    }
  }

  async sendFile(file: File, sender: string): Promise<void> {
    const arrayBuffer = await file.arrayBuffer()
    const fileMessage = {
      type: "file",
      id: crypto.randomUUID(),
      name: file.name,
      fileType: file.type,
      size: file.size,
      data: Array.from(new Uint8Array(arrayBuffer)),
      timestamp: new Date().toISOString(),
      sender,
    }

    const messageStr = JSON.stringify(fileMessage)
    let sentCount = 0

    this.dataChannels.forEach((dataChannel, clientId) => {
      if (dataChannel.readyState === "open") {
        try {
          dataChannel.send(messageStr)
          console.log("[v0] File sent to:", clientId)
          sentCount++
        } catch (error) {
          console.error("[v0] Error sending file to", clientId, ":", error)
        }
      } else {
        console.log("[v0] Data channel not ready for:", clientId, "state:", dataChannel.readyState)
      }
    })

    if (sentCount === 0) {
      const errorMsg = `No connected peers to send file to. Connected channels: ${this.dataChannels.size}, Open channels: ${Array.from(this.dataChannels.values()).filter((dc) => dc.readyState === "open").length}`
      console.error("[v0] Error sending file:", errorMsg)
      throw new Error(errorMsg)
    }

    console.log("[v0] File sent to", sentCount, "peers")
  }

  getParticipants(): Participant[] {
    return Array.from(this.participants.values())
  }

  cleanup() {
    this.stopLocalVideo()

    this.dataChannels.forEach((dc) => dc.close())
    this.dataChannels.clear()

    this.peerConnections.forEach((pc) => pc.close())
    this.peerConnections.clear()

    this.participants.clear()
  }
}
