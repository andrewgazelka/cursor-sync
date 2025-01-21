package com.andrewgazelka.jetbrainsplugin.widgets

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory

class CursorSyncWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = CursorSyncWidget.ID

    override fun getDisplayName(): String = "Cursor Sync"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget = CursorSyncWidget(project)

    override fun disposeWidget(widget: StatusBarWidget) {}

    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
} 