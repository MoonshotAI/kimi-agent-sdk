# Python KAOS Sandboxes

This directory groups all Python KAOS sandbox backends under one place:

- `boxlite/`: local BoxLite runtime backend
- `e2b/`: E2B cloud sandbox backend
- `sprites/`: Sprites cloud sandbox backend

All three use the same pattern:

1. Create or connect to a sandbox resource
2. Install backend via `set_current_kaos(...)`
3. Call `prompt(...)` or `Session` normally
4. Reset KAOS context and optionally clean up resources

```mermaid
flowchart LR
    subgraph Server
        App["Your App"] --> SDK["Kimi Agent SDK"] --> CLI["Kimi CLI"]
        subgraph Tools["Tools"]
            ReadFile["ReadFile"]
            WriteFile["WriteFile"]
            Shell["Shell"]
        end
        CLI --- Tools
    end

    subgraph BoxLite["BoxLite Box"]
        BFS[("Filesystem")]
        BSH{{"Shell"}}
    end

    subgraph E2B["E2B Sandbox"]
        EFS[("Filesystem")]
        ESH{{"Shell"}}
    end

    subgraph Sprites["Sprites Sandbox"]
        SFS[("Filesystem")]
        SSH{{"Shell"}}
    end

    ReadFile -->|"Kaos.readtext()"| FSRouter["Selected KAOS Backend"]
    WriteFile -->|"Kaos.writetext()"| FSRouter
    Shell -->|"Kaos.exec()"| SHRouter["Selected KAOS Backend"]

    FSRouter --> BFS
    FSRouter --> EFS
    FSRouter --> SFS
    SHRouter --> BSH
    SHRouter --> ESH
    SHRouter --> SSH

    style Tools stroke-dasharray: 5 5
```

## Backends

- `examples/python/kaos/boxlite`: local BoxLite runtime backend
- `examples/python/kaos/e2b`: E2B cloud sandbox backend
- `examples/python/kaos/sprites`: Sprites cloud sandbox backend
