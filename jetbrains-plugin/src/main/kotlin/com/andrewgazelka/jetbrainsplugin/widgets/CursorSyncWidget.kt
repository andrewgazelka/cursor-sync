package com.andrewgazelka.jetbrainsplugin.widgets

import com.andrewgazelka.jetbrainsplugin.event.StatusEventHandler
import com.andrewgazelka.jetbrainsplugin.service.CursorSyncService
import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.CustomStatusBarWidget
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.impl.status.EditorBasedWidget
import com.intellij.ui.ClickListener
import com.intellij.util.Consumer
import com.intellij.util.ui.update.Activatable
import java.awt.event.MouseEvent
import javax.swing.JComponent

class CursorSyncWidget(private val project: Project) :
    CustomStatusBarWidget,
    StatusEventHandler,
    StatusBarWidget.WidgetPresentation {
    private var service: CursorSyncService = project.getService(CursorSyncService::class.java)
    private val widget by lazy {
        CursorSyncWidgetImpl(onClick = this::onClick)
    }

    init {
        project.messageBus.connect().subscribe(
            topic = service.statusTopic,
            handler = this
        )
    }

    companion object {
        const val ID = "CursorSyncWidget"
    }

    override fun ID(): String = ID

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getComponent(): JComponent {
        return widget
    }

    override fun onStatusChanged(status: StatusEventHandler.Status) {
        when (status) {
            StatusEventHandler.Status.Connected -> {
                widget.update(
                    text = "Syncing",
                    icon = AllIcons.Debugger.ThreadStates.Idle,
                )
            }

            is StatusEventHandler.Status.Connecting -> {
                widget.update(
                    text = "Establishing connection(${status.attempts})",
                    icon = AllIcons.Debugger.ThreadStates.Socket,
                )
            }

            StatusEventHandler.Status.Disconnected -> {
                widget.update(
                    text = "Disconnected",
                    icon = AllIcons.Debugger.ThreadStates.Daemon_sign,
                )
            }
        }
    }

    private fun onClick() {
        project.messageBus.syncPublisher(
            topic = service.operationTopic
        ).toggle()
    }

    override fun getTooltipText(): String? = null
} 