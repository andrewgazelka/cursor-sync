package com.andrewgazelka.jetbrainsplugin.widgets

import com.intellij.icons.AllIcons
import com.intellij.openapi.wm.impl.status.TextPanel
import com.intellij.ui.ClickListener
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.update.UiNotifyConnector
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.event.MouseEvent
import javax.swing.Icon

internal class CursorSyncWidgetImpl(onClick: () -> Unit) : TextPanel() {

    private var icon: Icon = AllIcons.Actions.Close

    init {
        setBorder(JBUI.Borders.empty(0, 2))
        setTextAlignment(LEFT_ALIGNMENT)
        object : ClickListener() {
            override fun onClick(event: MouseEvent, clickCount: Int): Boolean {
                onClick.invoke()
                return true
            }
        }.installOn(this, true)
        text = "Loading..."
        updateUI()
    }

    fun update(text: String, icon: Icon) {
        this.text = text
        this.icon = icon

        toolTipText = "Cursor Sync Plugin Status: $text"
    }

    override fun getBackground(): Color? = null

    override fun paintComponent(g: Graphics) {
        val iconWidth = icon.iconWidth
        val iconHeight = icon.iconHeight

        val y = (height - iconHeight) / 2
        icon.paintIcon(this, g, 2, y)

        g.translate(iconWidth + 4, 0)
        super.paintComponent(g)
    }

    override fun getPreferredSize(): Dimension {
        val textSize = super.getPreferredSize()
        val iconWidth = icon.iconWidth

        return Dimension(
            iconWidth + 4 + textSize.width + 4,
            maxOf(textSize.height, AllIcons.Actions.AddList.iconHeight)
        )
    }
}