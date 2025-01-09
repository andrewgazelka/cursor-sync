import * as vscode from "vscode";
import WebSocket = require("ws");

// Create a more descriptive logger with severity levels
class Logger {
    private channel: vscode.OutputChannel;
    private readonly PREFIX = {
        INFO: "📘 INFO",
        WARN: "⚠️ WARN",
        ERROR: "❌ ERROR",
        DEBUG: "🔍 DEBUG",
    };

    constructor(channelName: string) {
        this.channel = vscode.window.createOutputChannel(channelName);
    }

    public info(message: string): void {
        this.log(this.PREFIX.INFO, message);
    }

    public warn(message: string): void {
        this.log(this.PREFIX.WARN, message);
    }

    public error(message: string, error?: Error): void {
        this.log(this.PREFIX.ERROR, message);
        if (error?.stack) {
            this.log(this.PREFIX.ERROR, `Stack trace: ${error.stack}`);
        }
    }

    public debug(message: string): void {
        this.log(this.PREFIX.DEBUG, message);
    }

    private log(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        this.channel.appendLine(`[${timestamp}] ${level}: ${message}`);
    }

    public show(): void {
        this.channel.show();
    }
}

const logger = new Logger("Cursor Sync");

interface CursorPosition {
    file: string;
    line: number;
    character: number;
    source: "vscode" | "jetbrains";
    timestamp: number;
}

let lastJetBrainsCursorPosition: vscode.Position | null = null;

// ステータスバーの状態を管理する型定義
enum ConnectionStatus {
    Disconnected,
    Connected,
    Error,
}

// ステータスバーを管理するクラス
class StatusBarManager {
    public readonly statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
        );
        this.updateStatus(ConnectionStatus.Disconnected);
        this.statusBarItem.show();
    }

    public updateStatus(status: ConnectionStatus): void {
        switch (status) {
            case ConnectionStatus.Connected:
                this.statusBarItem.text = "$(sync) Cursor Sync";
                this.statusBarItem.tooltip =
                    "Connected - Syncing cursor position";
                break;
            case ConnectionStatus.Disconnected:
                this.statusBarItem.text = "$(sync-ignored) Cursor Sync";
                this.statusBarItem.tooltip = "Disconnected";
                break;
            case ConnectionStatus.Error:
                this.statusBarItem.text = "$(error) Cursor Sync";
                this.statusBarItem.tooltip = "Connection Error";
                break;
        }
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
}

export class CursorSyncManager {
    private wsConnection: WebSocket | null = null;
    private wsServer: WebSocket.Server | null = null;
    private readonly port: number = 3000;
    private lastSentPosition: CursorPosition | null = null;
    private lastReceivedPosition: CursorPosition | null = null;
    private isUpdatingCursor: boolean = false;
    private readonly positionThreshold = 250; // ms
    public isWindowFocused = false;
    public readonly statusBarManager: StatusBarManager = new StatusBarManager();

    private createWebSocketServer(): WebSocket.Server {
        const wsServer = new WebSocket.Server({ port: this.port });
        this.setupWebSocketServer(wsServer);
        logger.info(`WebSocket server started on port ${this.port}`);
        vscode.window.showInformationMessage("WebSocket server started");
        return wsServer;
    }

    constructor() {
        logger.info("Initializing CursorSyncManager...");
        this.connect(); // 初期状態で接続を開始
    }

    private setupWebSocketServer(wsServer: WebSocket.Server): void {
        wsServer.on("connection", this.handleConnection.bind(this));
        wsServer.on("error", (error) => {
            logger.error("WebSocket server error", error);
            vscode.window.showErrorMessage(
                `WebSocket Server Error: ${(error as Error).message}`,
            );
            this.statusBarManager.updateStatus(ConnectionStatus.Error);
        });
    }

    private handleConnection(socket: WebSocket): void {
        logger.info("JetBrains IDE connected");
        this.wsConnection = socket;
        this.statusBarManager.updateStatus(ConnectionStatus.Connected);

        socket.on("message", (message: WebSocket.RawData) => {
            this.handleIncomingMessage(message);
        });

        socket.on("close", () => {
            logger.info("JetBrains IDE disconnected");
            vscode.window.showInformationMessage("JetBrains IDE disconnected");
            this.wsConnection = null;
            this.statusBarManager.updateStatus(ConnectionStatus.Disconnected);
        });

        socket.on("error", (error) => {
            logger.error("WebSocket connection error", error);
            vscode.window.showErrorMessage(
                `WebSocket Connection Error: ${(error as Error).message}`,
            );
            this.statusBarManager.updateStatus(ConnectionStatus.Error);
        });
    }

    private handleIncomingMessage(message: WebSocket.RawData): void {
        try {
            const cursorData: CursorPosition = JSON.parse(message.toString());
            logger.debug(
                `Received cursor update: ${JSON.stringify(cursorData)}`,
            );
            this.handleCursorUpdate(cursorData);
        } catch (error) {
            logger.error("Error parsing incoming message", error as Error);
        }
    }

    private shouldIgnorePosition(newPosition: CursorPosition): boolean {
        if (!this.lastReceivedPosition) return false;

        const isSamePosition =
            this.lastReceivedPosition.line === newPosition.line &&
            this.lastReceivedPosition.character === newPosition.character &&
            this.lastReceivedPosition.file === newPosition.file;

        const isWithinThreshold =
            newPosition.timestamp - this.lastReceivedPosition.timestamp <
                this.positionThreshold;

        return isSamePosition && isWithinThreshold;
    }

    private async handleCursorUpdate(
        cursorData: CursorPosition,
    ): Promise<void> {
        if (cursorData.source !== "jetbrains") {
            return;
        }

        if (this.shouldIgnorePosition(cursorData)) {
            logger.debug("Ignoring duplicate position update within threshold");
            return;
        }

        this.lastReceivedPosition = cursorData;

        try {
            const targetEditor = await this.getOrOpenEditor(cursorData.file);
            if (!targetEditor) {
                return;
            }

            await this.updateEditorCursor(targetEditor, cursorData);
        } catch (error) {
            logger.error("Error handling cursor update", error as Error);
            this.isUpdatingCursor = false;
        }
    }

    private async getOrOpenEditor(
        file: string,
    ): Promise<vscode.TextEditor | undefined> {
        // First try to find an already open editor
        const allEditors = vscode.window.visibleTextEditors;
        let targetEditor = allEditors.find((editor) =>
            editor.document.uri.fsPath === file
        );

        if (!targetEditor) {
            logger.debug("File not open in any editor, attempting to open...");
            try {
                const document = await vscode.workspace.openTextDocument(file);
                targetEditor = await vscode.window.showTextDocument(document);
                logger.debug("Successfully opened file");
            } catch (error) {
                logger.error(`Error opening file: ${file}`, error as Error);
                return undefined;
            }
        }

        return targetEditor;
    }

    private async updateEditorCursor(
        editor: vscode.TextEditor,
        cursorData: CursorPosition,
    ): Promise<void> {
        const position = new vscode.Position(
            cursorData.line,
            cursorData.character,
        );
        const selection = new vscode.Selection(position, position);

        this.isUpdatingCursor = true;
        try {
            editor.selection = selection;
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter,
            );
            logger.debug(
                `Updated cursor position to line ${cursorData.line}, char ${cursorData.character}`,
            );
        } finally {
            // Ensure flag is reset even if an error occurs
            setTimeout(() => {
                this.isUpdatingCursor = false;
            }, 100);
        }
    }

    private isSourceFile(file: string): boolean {
        // Ignore output channels, debug consoles, and other special files
        return !(file.includes("extension-output-") ||
            file.includes("debug-console") ||
            file.startsWith("output:") ||
            file.startsWith("extension:"));
    }

    public sendCursorPosition(position: vscode.Position, file: string): void {
        if (this.isUpdatingCursor) {
            logger.debug(
                "Ignoring local cursor change during programmatic update",
            );
            return;
        }

        if (!this.wsConnection) {
            logger.warn("No WebSocket connection, cannot send cursor position");
            return;
        }

        if (!this.isSourceFile(file)) {
            // logger.debug('Ignoring cursor change in non-source file');
            return;
        }

        logger.debug(`Source file`);

        const cursorData: CursorPosition = {
            file,
            line: position.line,
            character: position.character,
            source: "vscode",
            timestamp: Date.now(),
        };

        if (this.shouldSendPosition(cursorData)) {
            this.lastSentPosition = cursorData;
            logger.debug(
                `Sending cursor position: ${JSON.stringify(cursorData)}`,
            );
            this.wsConnection.send(JSON.stringify(cursorData));
        }
    }

    private shouldSendPosition(cursorData: CursorPosition): boolean {
        if (!this.lastSentPosition) return true;

        return !(
            this.lastSentPosition.line === cursorData.line &&
            this.lastSentPosition.character === cursorData.character &&
            this.lastSentPosition.file === cursorData.file
        );
    }

    public dispose(): void {
        logger.info("Disposing CursorSyncManager...");
        if (this.wsConnection) {
            this.wsConnection.close();
        }
        this.wsServer?.close();
        this.statusBarManager.dispose();
        logger.info("Successfully disposed CursorSyncManager");
    }

    public restartWebSocket(): void {
        logger.info("Restarting WebSocket server...");
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        this.wsServer?.close(() => {
            this.wsServer = this.createWebSocketServer();
        });
    }

    public connect(): void {
        if (this.wsServer) {
            logger.info("Already connected");
            return;
        }
        logger.info("Connecting WebSocket server...");
        this.wsServer = this.createWebSocketServer();
    }

    public disconnect(): void {
        if (!this.wsServer) {
            logger.info("Already disconnected");
            return;
        }
        logger.info("Disconnecting WebSocket server...");
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        this.wsServer.close(() => {
            this.wsServer = null;
            this.statusBarManager.updateStatus(ConnectionStatus.Disconnected);
            logger.info("WebSocket server disconnected");
        });
    }

    public isConnected(): boolean {
        return this.wsServer !== null;
    }
}

let cursorSyncManager: CursorSyncManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    logger.info("Cursor-sync extension is now active!");
    logger.show();

    cursorSyncManager = new CursorSyncManager();

    registerExtensionFeatures(context, cursorSyncManager);
}

function registerExtensionFeatures(
    context: vscode.ExtensionContext,
    manager: CursorSyncManager,
): void {
    // Track window focus and last synced position

    context.subscriptions.push(
        vscode.window.onDidChangeWindowState((window) => {
            manager.isWindowFocused = window.focused;
            logger.debug(`Window focus changed: ${window.focused}`);
        }),
    );

    // Register cursor position change handler
    const cursorDisposable = vscode.window.onDidChangeTextEditorSelection(
        (event) => {
            const editor = event.textEditor;
            const position = editor.selection.active;
            const file = editor.document.uri.fsPath;

            if (manager.isWindowFocused) {
                // Normal cursor movement when window is focused
                logger.debug(
                    `Local cursor moved: ${file} line=${position.line}, char=${position.character}`,
                );
                manager.sendCursorPosition(position, file);
            } else {
                /* cursor shouldnt be changing! */
            }
        },
    );

    const connectCommand = vscode.commands.registerCommand(
        "cursor-sync.connect",
        () => {
            logger.info("Connect command executed");
            manager.connect();
            vscode.window.showInformationMessage("Cursor Sync: Connected");
        },
    );

    const disconnectCommand = vscode.commands.registerCommand(
        "cursor-sync.disconnect",
        () => {
            logger.info("Disconnect command executed");
            manager.disconnect();
            vscode.window.showInformationMessage(
                "Cursor Sync: Disconnected",
            );
        },
    );

    const restartCommand = vscode.commands.registerCommand(
        "cursor-sync.restart",
        () => {
            logger.info("Restart command executed");
            manager.restartWebSocket();
        },
    );

    context.subscriptions.push(
        cursorDisposable,
        manager.statusBarManager.statusBarItem,
        connectCommand,
        disconnectCommand,
        restartCommand,
        {
            dispose: () => {
                manager.dispose();
                cursorSyncManager = undefined;
                logger.info("Extension disposed");
            },
        },
    );
}

export function deactivate(): void {
    logger.info("Deactivating extension...");
    if (cursorSyncManager) {
        cursorSyncManager.dispose();
        cursorSyncManager = undefined;
    }
    logger.info("Extension deactivated");
}
