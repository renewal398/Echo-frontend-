import { io, type Socket } from "socket.io-client"

let socket: Socket | null = null

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io("https://echo-hrfm.onrender.com/", {
      transports: ["websocket", "polling"],
      timeout: 20000,
    })
  }
  return socket
}

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
