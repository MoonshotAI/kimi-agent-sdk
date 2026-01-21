# Anime Recognizer

An anime screenshot recognition tool that demonstrates the multimodal (vision) capability of Kimi Agent SDK.

## Features

- **Image Recognition**: Automatically identifies anime from screenshots using AI vision
- **Web Search**: Uses web search to verify and find anime information
- **Smart Renaming**: Renames files to `{AnimeName}-{Episode}.{ext}` format
- **Episode Detection**: Supports regular episodes (E01), movies, OVAs, and specials
- **Conflict Handling**: Automatically handles filename conflicts

## Prerequisites

- Go 1.25 or later
- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) installed
- Kimi Code subscription (required for Kimi Code features)
- Complete the setup process by running `/login`

## Installation

```bash
cd examples/go/anime-recognizer
go build .
```

## Usage

```bash
# Basic usage - process images in a directory
./anime-recognizer --input ./screenshots

# Specify output directory
./anime-recognizer --input ./screenshots --output ./renamed

# Preview renames without executing (dry run)
./anime-recognizer --input ./screenshots --dry-run

# Use custom prompt file
./anime-recognizer --input ./screenshots --prompt ./my-prompt.md
```

## Command Line Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--input` | Yes | - | Directory containing anime screenshots |
| `--output` | No | Same as input | Output directory for renamed files |
| `--prompt` | No | `prompts/recognize-anime.md` | Custom prompt file path |
| `--dry-run` | No | `false` | Preview renames without executing |

## Supported Image Formats

- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)
- GIF (`.gif`)
- WebP (`.webp`)

## Output Naming Convention

The tool renames files using the following format:

| Content Type | Format | Example |
|--------------|--------|---------|
| Regular Episode | `AnimeName-E01.ext` | `Attack_on_Titan-E01.png` |
| Movie | `AnimeName-Movie.ext` | `Your_Name-Movie.jpg` |
| Multiple Movies | `AnimeName-Movie1.ext` | `Evangelion-Movie1.png` |
| OVA | `AnimeName-OVA1.ext` | `Steins_Gate-OVA1.jpg` |
| Special | `AnimeName-Special1.ext` | `Demon_Slayer-Special1.png` |

## Example

```bash
# Before
screenshots/
├── a1b2c3d4-e5f6-7890.png    # Random UUID filename
├── screenshot_2024.jpg        # Generic screenshot name
└── image001.gif               # Generic image name

# After running: ./anime-recognizer --input ./screenshots
screenshots/
├── Attack_on_Titan-E01.png
├── Your_Name-Movie.jpg
└── Demon_Slayer-E19.gif
```

## How It Works

1. **Scan**: Finds all image files in the input directory
2. **Analyze**: Sends each image to the AI agent with the recognition prompt
3. **Identify**: AI analyzes visual content (characters, art style, scenes) and searches the web
4. **Report**: AI calls the `report_recognition_result` tool with findings
5. **Rename**: Files are renamed based on recognition results
