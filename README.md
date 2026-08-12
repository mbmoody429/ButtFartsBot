# ButtFartsBot

ButtFartsBot is a hosted Twitch chat bot that occasionally grabs a message and makes it worse on purpose.

Add it to your stream here:

https://buttsbot.up.railway.app

This repository is a public source showcase. It contains selected, non-deployment code so people can browse how ButtFartsBot works without exposing the private production repository or deployment configuration.

## What it does

ButtFartsBot supports multiple selectable modes per channel:

- Butt
- Cock
- Fart
- Vagine
- No
- UwU
- R's → W's
- C's → K's

Streamers can select one, several, or all modes and choose how often the bot activates.

Chatters can use `!notme` to opt out of having their messages transformed and `!pickme` to opt back in.

The word-replacement modes use TeX-style English hyphenation to swap part of a word while keeping the result readable. Letter modes randomly replace only some matching letters. URLs, mentions, commands, unchanged results, and other bad outputs are filtered out.

## About this source showcase

The production repository is private. Deployment configuration, secrets, token persistence, admin internals, Railway configuration, and production-only infrastructure are intentionally not included here.

This repository is provided for browsing and learning from the implementation. It is not the deployment source for the live bot.

## Mare's Bot Shop

For more custom Twitch and Discord bots, visit Mare's Bot Shop:

https://www.patreon.com/cw/MaresBotShop

Built because of NMD96 and Qipsir. Ty guys for this delightful idea.
