import * as vscode from 'vscode';
import WebSocket = require('ws');

// Create a more descriptive logger with severity levels
class Logger {
    private channel: vscode.OutputChannel;
    private readonly PREFIX = {
        INFO: '📘 INFO',
        WARN: '⚠️ WARN',
        ERROR: '❌ ERROR',
        DEBUG: '🔍 DEBUG'
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
    source: 'vscode' | 'jetbrains';
    timestamp: number;
}

let lastJetBrainsCursorPosition: vscode.Position | null = null;

export class CursorSyncManager {
    private wsConnection: WebSocket | null = null;
    private wsServer: WebSocket.Server;
    private readonly port: number = 3000;
    private lastSentPosition: CursorPosition | null = null;
    private lastReceivedPosition: CursorPosition | null = null;
    private isUpdatingCursor: boolean = false;
    private readonly positionThreshold = 250; // ms
    public isWindowFocused = false;

    private createWebSocketServer(): void {
        this.wsServer = new WebSocket.Server({port: this.port});
        this.setupWebSocketServer();
        logger.info(`WebSocket server started on port ${this.port}`);
        vscode.window.showInformationMessage('WebSocket server started');
    }

    constructor() {
        logger.info('Initializing CursorSyncManager...');
        this.createWebSocketServer();
    }

    private setupWebSocketServer(): void {
        this.wsServer.on('connection', this.handleConnection.bind(this));
        this.wsServer.on('error', (error) => {
            logger.error('WebSocket server error', error);
            vscode.window.showErrorMessage(`WebSocket Server Error: ${(error as Error).message}`);
        });
    }

    private handleConnection(socket: WebSocket): void {
        logger.info('JetBrains IDE connected');
        this.wsConnection = socket;

        socket.on('message', (message: WebSocket.RawData) => {
            this.handleIncomingMessage(message);
        });

        socket.on('close', () => {
            logger.info('JetBrains IDE disconnected');
            vscode.window.showInformationMessage('JetBrains IDE disconnected');
            this.wsConnection = null;
        });

        socket.on('error', (error) => {
            logger.error('WebSocket connection error', error);
            vscode.window.showErrorMessage(`WebSocket Connection Error: ${(error as Error).message}`);
        });
    }

    private handleIncomingMessage(message: WebSocket.RawData): void {
        try {
            const cursorData: CursorPosition = JSON.parse(message.toString());
            logger.debug(`Received cursor update: ${JSON.stringify(cursorData)}`);
            this.handleCursorUpdate(cursorData);
        } catch (error) {
            logger.error('Error parsing incoming message', error as Error);
        }
    }

    private shouldIgnorePosition(newPosition: CursorPosition): boolean {
        if (!this.lastReceivedPosition) return false;

        const isSamePosition =
            this.lastReceivedPosition.line === newPosition.line &&
            this.lastReceivedPosition.character === newPosition.character &&
            this.lastReceivedPosition.file === newPosition.file;

        const isWithinThreshold =
            newPosition.timestamp - this.lastReceivedPosition.timestamp < this.positionThreshold;

        return isSamePosition && isWithinThreshold;
    }

    private async handleCursorUpdate(cursorData: CursorPosition): Promise<void> {
        if (cursorData.source !== 'jetbrains') {
            return;
        }

        if (this.shouldIgnorePosition(cursorData)) {
            logger.debug('Ignoring duplicate position update within threshold');
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
            logger.error('Error handling cursor update', error as Error);
            this.isUpdatingCursor = false;
        }
    }

    private async getOrOpenEditor(file: string): Promise<vscode.TextEditor | undefined> {
        // First try to find an already open editor
        const allEditors = vscode.window.visibleTextEditors;
        let targetEditor = allEditors.find(editor => editor.document.uri.fsPath === file);

        if (!targetEditor) {
            logger.debug('File not open in any editor, attempting to open...');
            try {
                const document = await vscode.workspace.openTextDocument(file);
                targetEditor = await vscode.window.showTextDocument(document);
                logger.debug('Successfully opened file');
            } catch (error) {
                logger.error(`Error opening file: ${file}`, error as Error);
                return undefined;
            }
        }

        return targetEditor;
    }

    private async updateEditorCursor(editor: vscode.TextEditor, cursorData: CursorPosition): Promise<void> {
        const position = new vscode.Position(cursorData.line, cursorData.character);
        const selection = new vscode.Selection(position, position);

        this.isUpdatingCursor = true;
        try {
            editor.selection = selection;
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            logger.debug(`Updated cursor position to line ${cursorData.line}, char ${cursorData.character}`);
        } finally {
            // Ensure flag is reset even if an error occurs
            setTimeout(() => {
                this.isUpdatingCursor = false;
            }, 100);
        }
    }

    private isSourceFile(file: string): boolean {
        // Ignore output channels, debug consoles, and other special files
        return !(file.includes('extension-output-') ||
            file.includes('debug-console') ||
            file.startsWith('output:') ||
            file.startsWith('extension:'));

    }

    public sendCursorPosition(position: vscode.Position, file: string): void {
        if (this.isUpdatingCursor) {
            logger.debug('Ignoring local cursor change during programmatic update');
            return;
        }

        if (!this.wsConnection) {
            logger.warn('No WebSocket connection, cannot send cursor position');
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
            source: 'vscode',
            timestamp: Date.now()
        };

        if (this.shouldSendPosition(cursorData)) {
            this.lastSentPosition = cursorData;
            logger.debug(`Sending cursor position: ${JSON.stringify(cursorData)}`);
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
        logger.info('Disposing CursorSyncManager...');
        if (this.wsConnection) {
            this.wsConnection.close();
        }
        this.wsServer.close();
        logger.info('Successfully disposed CursorSyncManager');
    }

    public restartWebSocket(): void {
        logger.info('Restarting WebSocket server...');
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        this.wsServer.close(() => {
            this.createWebSocketServer();
        });
    }
}

let cursorSyncManager: CursorSyncManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    logger.info('Cursor-sync extension is now active!');
    logger.show();

    cursorSyncManager = new CursorSyncManager();

    registerExtensionFeatures(context);
}

function registerExtensionFeatures(context: vscode.ExtensionContext): void {
    // Track window focus and last synced position

    context.subscriptions.push(
        vscode.window.onDidChangeWindowState((window) => {
            if (cursorSyncManager) {
                const wasFocused = cursorSyncManager.isWindowFocused;
                cursorSyncManager.isWindowFocused = window.focused;
                logger.debug(`Window focus changed: ${window.focused}`);
            }
        })
    );

    // Register cursor position change handler
    const cursorDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!cursorSyncManager) return;

        const editor = event.textEditor;
        const position = editor.selection.active;
        const file = editor.document.uri.fsPath;

        if (cursorSyncManager.isWindowFocused) {
            // Normal cursor movement when window is focused
            logger.debug(`Local cursor moved: ${file} line=${position.line}, char=${position.character}`);
            cursorSyncManager.sendCursorPosition(position, file);
        } else {
            /* cursor shouldnt be changing! */}
    });

    // Register status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    statusBarItem.text = "$(sync) Cursor Sync";
    statusBarItem.tooltip = "Cursor position is being synced with JetBrains IDE";
    statusBarItem.show();

    // Register commands
    const toggleCommand = vscode.commands.registerCommand('cursor-sync.toggle', () => {
        logger.info('Toggle command executed');
        vscode.window.showInformationMessage('Cursor sync toggled');
    });

    const restartCommand = vscode.commands.registerCommand('cursor-sync.restart', () => {
        logger.info('Restart command executed');
        if (cursorSyncManager) {
            cursorSyncManager.restartWebSocket();
        }
    });

    context.subscriptions.push(
        cursorDisposable,
        statusBarItem,
        toggleCommand,
        restartCommand,
        {
            dispose: () => {
                if (cursorSyncManager) {
                    cursorSyncManager.dispose();
                    cursorSyncManager = undefined;
                }
                logger.info('Extension disposed');
            }
        }
    );
}

export function deactivate(): void {
    logger.info('Deactivating extension...');
    if (cursorSyncManager) {
        cursorSyncManager.dispose();
        cursorSyncManager = undefined;
    }
    logger.info('Extension deactivated');
}