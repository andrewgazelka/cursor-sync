package com.andrewgazelka.jetbrainsplugin

import com.google.gson.Gson
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import java.io.File
import java.net.URI
import java.util.*
import kotlin.math.min
import kotlin.math.pow

private const val WEBSOCKET_URL = "ws://localhost:3000"
private const val POSITION_THRESHOLD_MS = 250L
private const val BASE_RECONNECT_DELAY_MS = 1000L
private const val MAX_RECONNECT_DELAY_MS = 30000L
private const val MAX_RECONNECT_ATTEMPTS = 5

data class CursorPosition(
    val source: String,
    val file: String,
    val line: Int,
    val character: Int,
    val timestamp: Long = System.currentTimeMillis()
)


class CursorSyncPlugin : ProjectActivity {
    private var lastPosition: CursorPosition? = null
    private var lastReceivedPosition: CursorPosition? = null
    private val isWindowFocused get() = ApplicationManager.getApplication().isActive
    private lateinit var wsClient: WebSocketClient
    private val editorListeners = mutableMapOf<VirtualFile, CaretListener>()
    private lateinit var project: Project
    private var reconnectAttempt = 0
    private var reconnectJob: Timer? = null


    override suspend fun execute(project: Project) {
        this.project = project
        initializePlugin()
    }


    private fun initializePlugin() {
        resetReconnectAttempts()
        logInfo("CursorSyncPlugin is starting!")

        try {
            connectWebSocket()
            setupEditorListeners()
            notifyUser("Cursor Sync plugin activated", NotificationType.INFORMATION)
        } catch (e: Exception) {
            handleStartupError(e)
        }
    }

    private fun handleStartupError(e: Exception) {
        logError("Error during plugin startup", e)
        notifyUser("Cursor Sync plugin failed to start: ${e.message}", NotificationType.ERROR)
    }

    private fun notifyUser(content: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Cursor Sync Notifications")
                .createNotification(content, type)
                .notify(project)
        }
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = Timer().apply {
            val delay = calculateReconnectDelay()
            logInfo("Scheduling reconnect attempt ${reconnectAttempt + 1} in ${delay}ms")

            schedule(object : TimerTask() {
                override fun run() {
                    if (!wsClient.isOpen) {
                        reconnectAttempt++
                        connectWebSocket()
                    }
                }
            }, delay)
        }
    }

    private fun calculateReconnectDelay(): Long {
        val exponentialDelay =
            BASE_RECONNECT_DELAY_MS * (2.0.pow(min(reconnectAttempt, MAX_RECONNECT_ATTEMPTS)).toLong())
        return min(exponentialDelay, MAX_RECONNECT_DELAY_MS)
    }

    private fun resetReconnectAttempts() {
        reconnectAttempt = 0
        reconnectJob?.cancel()
        reconnectJob = null
    }

    private fun connectWebSocket() {
        logInfo("Attempting to connect WebSocket... (Attempt ${reconnectAttempt + 1})")

        wsClient = object : WebSocketClient(URI(WEBSOCKET_URL)) {
            override fun onOpen(handshake: ServerHandshake?) {
                handleWebSocketOpen()
            }

            override fun onMessage(message: String?) {
                handleWebSocketMessage(message)
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                handleWebSocketClose(code, reason, remote)
            }

            override fun onError(ex: Exception?) {
                handleWebSocketError(ex)
            }
        }.apply { connect() }
    }

    private fun handleWebSocketOpen() {
        logInfo("WebSocket Connected Successfully!")
        notifyUser("Connected to VS Code", NotificationType.INFORMATION)
        resetReconnectAttempts()
    }

    private fun handleWebSocketMessage(message: String?) {
        logInfo("Received WebSocket message: $message")
        message?.let { parseAndHandlePosition(it) }
    }

    private fun parseAndHandlePosition(message: String) {
        try {
            val position = Gson().fromJson(message, CursorPosition::class.java)
            logInfo("Parsed position: $position")

            if (position.source == "vscode" && !isPositionDuplicate(position)) {
                lastReceivedPosition = position
                ApplicationManager.getApplication().invokeLater {
                    updateCursorPosition(position)
                }
            }
        } catch (e: Exception) {
            logError("Error parsing message", e)
        }
    }

    private fun isPositionDuplicate(position: CursorPosition): Boolean {
        return lastReceivedPosition?.let { lastPos ->
            lastPos.line == position.line &&
                    lastPos.character == position.character &&
                    lastPos.file == position.file &&
                    position.timestamp - lastPos.timestamp < POSITION_THRESHOLD_MS
        } ?: false
    }

    private fun handleWebSocketClose(code: Int, reason: String?, remote: Boolean) {
        logInfo("WebSocket Connection Closed. Code: $code, Reason: $reason, Remote: $remote")
        notifyUser("Disconnected from VS Code", NotificationType.WARNING)
        scheduleReconnect()
    }

    private fun handleWebSocketError(ex: Exception?) {
        logError("WebSocket Error", ex)
        notifyUser("WebSocket error: ${ex?.message}", NotificationType.ERROR)
    }

    private fun setupEditorListeners() {
        logInfo("Setting up editor listeners...")
        setupFileEditorManagerListener()
        setupExistingEditors()
    }

    private fun setupFileEditorManagerListener() {
        project.messageBus.connect().subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
                    setupCaretListenerForFile(file)
                }

                override fun fileClosed(source: FileEditorManager, file: VirtualFile) {
                    removeCaretListenerForFile(file)
                }
            }
        )
    }

    private fun setupExistingEditors() {
        FileEditorManager.getInstance(project).allEditors.forEach { editor ->
            (editor as? TextEditor)?.let {
                setupCaretListenerForFile(it.file)
            }
        }
    }

    private fun setupCaretListenerForFile(file: VirtualFile) {
        logInfo("Setting up caret listener for file: ${file.path}")
        removeCaretListenerForFile(file)

        val editor = (FileEditorManager.getInstance(project)
            .getSelectedEditor(file) as? TextEditor)?.editor ?: return

        val listener = createCaretListener()
        editor.caretModel.addCaretListener(listener)
        editorListeners[file] = listener
    }

    private fun createCaretListener() = object : CaretListener {
        override fun caretPositionChanged(event: CaretEvent) {
            if (!isWindowFocused) {
                logInfo("Ignoring cursor change - window not focused")
                return
            }

            handleCaretPositionChange(event)
        }
    }

    private fun handleCaretPositionChange(event: CaretEvent) {
        val position = CursorPosition(
            source = "jetbrains",
            file = event.editor.virtualFile.path,
            line = event.newPosition.line,
            character = event.newPosition.column
        )

        if (shouldUpdatePosition(position)) {
            lastPosition = position
            sendPositionUpdate(position)
        }
    }

    private fun shouldUpdatePosition(position: CursorPosition): Boolean {
        return lastPosition?.let {
            it.line != position.line ||
                    it.character != position.character ||
                    it.file != position.file
        } ?: true
    }

    private fun sendPositionUpdate(position: CursorPosition) {
        try {
            val json = Gson().toJson(position)
            logInfo("Sending position: $json")
            wsClient.send(json)
        } catch (e: Exception) {
            logError("Error sending position", e)
        }
    }

    private fun removeCaretListenerForFile(file: VirtualFile) {
        editorListeners[file]?.let { listener ->
            logInfo("Removing caret listener for file: ${file.path}")
            (FileEditorManager.getInstance(project)
                .getSelectedEditor(file) as? TextEditor)?.editor
                ?.caretModel
                ?.removeCaretListener(listener)
            editorListeners.remove(file)
        }
    }

    private fun updateCursorPosition(position: CursorPosition) {
        logInfo("Updating cursor position: $position")
        try {
            val virtualFile = getVirtualFile(position.file) ?: return
            updateEditorPosition(virtualFile, position)
        } catch (e: Exception) {
            logError("Error updating cursor position", e)
        }
    }

    private fun getVirtualFile(filePath: String): VirtualFile? {
        val file = File(filePath)
        return LocalFileSystem.getInstance().findFileByIoFile(file).also {
            if (it == null) logInfo("Could not find virtual file for path: $filePath")
        }
    }

    private fun updateEditorPosition(virtualFile: VirtualFile, position: CursorPosition) {
        ApplicationManager.getApplication().runWriteAction {
            try {
                val editor = FileEditorManager.getInstance(project)
                    .openFile(virtualFile, true)
                    .firstOrNull() as? TextEditor
                    ?: return@runWriteAction.also { logInfo("Could not open editor for file: ${position.file}") }

                editor.editor.caretModel.moveToLogicalPosition(
                    LogicalPosition(position.line, position.character)
                )
                logInfo("Successfully moved cursor")
            } catch (e: Exception) {
                logError("Error in runWriteAction", e)
            }
        }
    }

    private fun logInfo(message: String) {
        println("CursorSync: $message")
    }

    private fun logError(message: String, e: Exception? = null) {
        println("CursorSync Error: $message")
        e?.printStackTrace()
    }
}