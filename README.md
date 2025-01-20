# Cursor Sync Plugin

A plugin that synchronizes cursor positions between VSCode and JetBrains IDEs.

This is very much a work in progress. Please look at the [issues](https://github.com/andrewgazelka/cursor-sync/issues) for more information.

https://github.com/user-attachments/assets/acf66818-32f4-4695-9f2c-8486fdba73bc

## Reasoning

```mermaid
flowchart TB
    subgraph Motivation["Why Cursor Sync?"]
            direction TB
            ai["AI Features (Cursor IDE)"]
            ide["Professional IDE Features (JetBrains)"]
            pain["Pain Point: Switching between IDEs and finding position"]
            soln["Solution: Automatic cursor synchronization"]
            
            ai --> pain
            ide --> pain
            pain --> soln
        end
```

## Architecture

```mermaid
flowchart TB
    subgraph VSCode["VSCode Extension"]
        vsm["CursorSyncManager"]
        vws["WebSocket Server (Port 3000)"]
        vsm --> vws
    end
    
    subgraph JetBrains["JetBrains Plugin"]
        jext["CursorSyncPlugin"]
        jws["WebSocket Client"]
        jext --> jws
    end
    
    subgraph Data["Shared Data"]
        cpos[/"CursorPosition {
            file, line, character
        }"/]
    end
    
    %% Connections
    vws <-->|WebSocket| jws
    Data -->|JSON| vws
    Data -->|JSON| jws
    
    %% Styling
    classDef default fill:#f9f9f9,stroke:#333,stroke-width:1px
    classDef data fill:#ffe6cc,stroke:#ff9933,stroke-width:2px
    classDef motivation fill:#e1f3d8,stroke:#82b366,stroke-width:2px
    
    class cpos data
    class Motivation,ai,ide,pain,soln motivation
```

## Build Instructions

### VSCode Plugin
1. Navigate to the `vscode-plugin` directory
2. Run `npx vsce package`
3. When prompted, respond with 'y'
4. A file named `cursor-sync-0.0.1.vsix` will be generated
5. Install by dragging and dropping this file into the extensions panel of your VSCode-compatible editor

### JetBrains Plugin
1. Navigate to the `jetbrains-plugin` directory
2. Run `./gradlew buildPlugin`
3. The plugin will be generated at `build/distributions/jetbrains-plugin-1.0-SNAPSHOT.zip`
4. Install via "Install Plugin from Disk" in your JetBrains IDE
