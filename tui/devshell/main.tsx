// scripts/devshell entry. tui/entry.tsx already does enter/startInput/mount —
// the cart just needs a default-exported component. Shell self-bootstraps
// (reads argv for the cart label, owns its own keybindings).

export { default } from './Shell';
