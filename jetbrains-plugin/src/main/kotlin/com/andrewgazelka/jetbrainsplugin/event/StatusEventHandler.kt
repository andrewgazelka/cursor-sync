package com.andrewgazelka.jetbrainsplugin.event

interface StatusEventHandler {
    fun onStatusChanged(status: Status)
    sealed interface Status {
        data class Connecting(val attempts: Int) : Status
        data object Disconnected : Status
        data object Connected : Status
    }
}