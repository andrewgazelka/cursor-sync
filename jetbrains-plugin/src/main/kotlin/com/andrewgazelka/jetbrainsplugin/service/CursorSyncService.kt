package com.andrewgazelka.jetbrainsplugin.service

import com.andrewgazelka.jetbrainsplugin.event.OperationEventHandler
import com.andrewgazelka.jetbrainsplugin.event.StatusEventHandler
import com.intellij.util.messages.Topic

class CursorSyncService {
    val operationTopic = Topic.create("Cursor Sync Operation Topic", OperationEventHandler::class.java)
    val statusTopic = Topic.create("Cursor Sync Status Topic", StatusEventHandler::class.java)
}