---
description: Set up Muster on this machine and get the player into a match
argument-hint: "[token] [friend code] [--server <url>] [--tunnel] [--two]"
---

Get the person playing Muster as fast as possible. Do the steps yourself; only stop for something that needs them.

Arguments given: `$ARGUMENTS`
- Something starting `mst_` is the person's token: pass it as `--token <token>`. Never print it back, commit it or put it in a file.
- A six-character code (letters and digits) is a friend's code: pass it as `--add <code>`.
- `--server <url>`, `--tunnel` and `--two` pass straight through to the play script.

1. Check Node: `node -v` must be 22.13 or newer. If it is missing or older, install it (macOS: `brew install node`; otherwise https://nodejs.org) and say what you installed.
2. From the repo root, start the game in the background: `npm run play -- <the arguments above>`. It installs packages on first run, starts the match server (unless `server.config.json` or `--server` names a hosted one), starts the game and opens the browser on the Versus screen. Leave it running.
3. Wait for the line `Muster is ready` in its output. If it stops with an error instead, read the error, fix it (a port in use: find and stop the old `tools/play.mjs`; missing packages: `npm install`) and start it again.
4. Tell the person, in a few lines:
   - the address the game is open at,
   - that their friend code is on the Versus screen (Copy invite gives a link to send),
   - how to play someone: type a friend's code and press Add, then Challenge once they accept; or Find match for a ranked rival,
   - if a token was given, that they are signed in with it; if the game asks for a token instead, they need one from whoever runs the server,
   - if a code was given, that a friend request has already gone to that player,
   - the same-Wi-Fi address from the output if there is one, for a phone.
5. If they want friends on other networks and no hosted server is set, offer `--tunnel` (needs `cloudflared`; on a Mac `brew install cloudflared`), which prints a public link friends can open in a browser with nothing to install.

Do not play the match for them unless they ask. If they want to build something on the game (a client, a bot, a stats page), the server's API is in the README under "The API": their token is the only credential, and it is theirs to answer for.
