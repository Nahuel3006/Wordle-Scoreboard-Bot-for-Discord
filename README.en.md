# Yordler

[Español](README.md)

A Discord bot that collects shared Wordle results, tracks player statistics, and publishes a points leaderboard.

## Features

- Reads result messages from a channel's history in pages of up to 100 messages.
- Recognizes multiple results on one line, Discord mentions, and plain-text usernames.
- Tracks games, wins, attempts, points, and counts from `1/6` through `X/6`.
- Merges usernames with Discord IDs when they can be matched unambiguously.
- Ranks players by total points; tied totals share a position.
- Recalculates history from a specified message or continues from the saved checkpoint.
- Watches a channel and publishes updated results when new Wordle messages arrive.

## Scoring

| Result | Points |
| --- | ---: |
| `1/6` | 6 |
| `2/6` | 5 |
| `3/6` | 4 |
| `4/6` | 3 |
| `5/6` | 2 |
| `6/6` | 1 |
| `X/6` | 0 |

The leaderboard uses total points. Each row also shows how many times the player achieved each result.

## Requirements

- Node.js 18 or later.
- A Discord application and bot created in the [Discord Developer Portal](https://discord.com/developers/applications).
- Permission to read the source channel's history and send messages in the output channel.
- The **Message Content** intent enabled for the bot in the Developer Portal.

## Setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN` and `CLIENT_ID` in `.env`.
4. Invite the bot with the `bot` and `applications.commands` scopes and the permissions needed to view channels, read message history, and send messages.
5. Start the bot with `node index.js`.

Do not publish `.env` or share your bot token.

## Commands

### `/obtenerresultados`

Processes a channel and publishes the leaderboard in the source channel or the specified output channel.

- `canal`: channel whose history will be processed.
- `canal2`: optional channel where the leaderboard will be posted.
- `recalcular`: rebuilds statistics instead of continuing from the saved checkpoint.
- `desde_id`: inclusive ID of the first message to count.

To rebuild exact result counts from a specific point, use `recalcular: true` with `desde_id`. This replaces the saved statistics with data from that message through the most recent message. If `desde_id` is provided without recalculation, messages are added to the existing totals; do not use it to process a range that has already been counted.

The local JSON file is written after history processing completes. If processing fails before then, the previous file is preserved.

### `/rastrear`

Stores a source channel and an output channel. When a new message that looks like a Wordle result arrives, the bot updates the statistics and publishes the leaderboard.

## Data and tests

Statistics and the checkpoint are stored in `wordle_stats.json`. This file contains mutable data and user IDs, so it is excluded from Git. Detailed result counts cannot be recovered from older aggregate totals; they are populated by recalculating the message history.

Run the local test suite with:

```sh
npm test
```

Tests cover parsing, pagination, statistics migration, aliases, ranking, and embed limits.