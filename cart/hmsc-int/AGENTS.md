# AGENTS.md - HMSC INT

This cart is internal tooling for Hitman Shitcity. Ship it with:

```sh
./tools/rjit ship hmsc-int
```

Keep it separate from the game cart. Map authoring, world inspection, chunk
visualization, and editor-only affordances belong here. The player-facing game
shell belongs in `cart/hmsc/`.
