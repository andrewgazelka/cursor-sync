package com.andrewgazelka.jetbrainsplugin.ws

import org.java_websocket.client.WebSocketClient
import java.net.URI

private const val WEBSOCKET_URL = "ws://localhost:3000"

abstract class CursorSyncWebSocketClient : WebSocketClient(URI(WEBSOCKET_URL)) {
    var isOpened = false
        private set

    var isManuallyDisconnect = false


    override fun isOpen(): Boolean {
        isOpened = true
        return super.isOpen()
    }
}