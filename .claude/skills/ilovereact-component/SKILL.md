---
name: ilovereact-component
description: >
  Build React components for iLoveReact using its primitives and style system.
  Use when the user asks to "create a component", "build a UI", "make a widget",
  "style a component", "add a button", "create a layout", "build a dashboard",
  or any request involving building UI with iLoveReact primitives. Also use when
  the user asks about available components, styling, or animation.
---

# Build iLoveReact Components

## Mandatory: Use the CLI Tool

**After writing or modifying ANY component, you MUST run these CLI commands.
Do NOT skip these steps or assume the code is correct without verification.**

### For Love2D / Web targets:
```bash
# 1. Lint — catches layout bugs that silently produce broken output
ilovereact lint

# 2. Build — runs lint gate automatically, then bundles
ilovereact build

# 3. Visual verification — screenshot the result and inspect it
ilovereact screenshot --output /tmp/preview.png
# Then read /tmp/preview.png to confirm the layout is correct
```

### For monorepo examples (any target):
```bash
# Build the specific target to verify it compiles
npm run build:<example-name>
```

**Do NOT manually invoke esbuild.** The CLI encodes the correct flags, lint gates,
and runtime configuration. Manual esbuild commands will use wrong flags and skip
the lint gate.

## Which Primitives to Use

### Grid targets (terminal, CC, Neovim, Hammerspoon, AwesomeWM)

Use lowercase JSX intrinsics. Define convenience wrappers:

```tsx
function Box({ style, children }: { style?: any; children?: React.ReactNode }) {
  return <view style={style}>{children}</view>;
}

function Text({ style, children }: { style?: any; children?: React.ReactNode }) {
  return <text style={style}>{children}</text>;
}
```

### Love2D / Web targets

Import from `@ilovereact/core`:

```tsx
import { Box, Text, Image, Pressable, ScrollView, TextInput, Modal } from '@ilovereact/core';
```

These auto-switch between DOM elements (web) and reconciler host elements (native) based on RendererMode context.

## Style Reference

Colors accept CSS strings (`'#ff0000'`, `'rgba(0,0,0,0.5)'`) or Love2D arrays (`[1, 0, 0, 1]`).

### Layout (works everywhere)
```typescript
{
  width: number | string,        // absolute px/chars or '%'
  height: number | string,
  flexDirection: 'row' | 'column',  // default 'column'
  flexGrow: number,
  flexShrink: number,
  flexBasis: number | string | 'auto',
  justifyContent: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly',
  alignItems: 'start' | 'center' | 'end' | 'stretch',
  alignSelf: 'auto' | 'start' | 'center' | 'end' | 'stretch',
  flexWrap: 'nowrap' | 'wrap',
  gap: number | string,
  padding: number | string,      // also paddingTop/Right/Bottom/Left
  margin: number | string,       // also marginTop/Right/Bottom/Left
  display: 'flex' | 'none',
}
```

### Visual (Love2D/Web only, except backgroundColor and color which work on grid)
```typescript
{
  backgroundColor: Color,
  color: Color,                  // text color
  borderRadius: number,
  borderWidth: number,           // also borderTop/Right/Bottom/LeftWidth
  borderColor: Color,
  overflow: 'visible' | 'hidden' | 'scroll',
  opacity: number,
  zIndex: number,
  // Shadow
  shadowColor: Color,
  shadowOffsetX: number,
  shadowOffsetY: number,
  shadowBlur: number,
  // Gradient
  backgroundGradient: { direction: 'horizontal' | 'vertical' | 'diagonal', colors: [Color, Color] },
  // Transform
  transform: { translateX?, translateY?, rotate?, scaleX?, scaleY?, originX?, originY? },
}
```

### Text (Love2D/Web only, except color which works on grid)
```typescript
{
  fontSize: number,
  fontFamily: string,
  fontWeight: 'normal' | 'bold' | number,
  textAlign: 'left' | 'center' | 'right',
  textOverflow: 'clip' | 'ellipsis',
  textDecorationLine: 'none' | 'underline' | 'line-through',
  lineHeight: number,
  letterSpacing: number,
}
```

### Positioning
```typescript
{
  position: 'relative' | 'absolute',
  top: number | string,
  bottom: number | string,
  left: number | string,
  right: number | string,
}
```

## Component Catalog

### Box (container)
```tsx
<Box style={{ flexDirection: 'row', gap: 8, padding: 16, backgroundColor: '#1a1a2e' }}>
  {children}
</Box>
```
Events: onClick, onRelease, onPointerEnter/Leave, onKeyDown/Up, onTextInput, onWheel, onTouchStart/End/Move, onGamepadPress/Release/Axis, onDragStart/Drag/DragEnd

### Text
```tsx
<Text style={{ color: '#fff', fontSize: 14 }} numberOfLines={2}>Hello</Text>
```
Events: onKeyDown, onKeyUp, onTextInput

### Image (Love2D/Web only)
```tsx
<Image src="path/to/image.png" style={{ width: 100, height: 100, objectFit: 'cover' }} />
```

### Pressable (Love2D/Web only)
```tsx
<Pressable
  onPress={() => console.log('pressed')}
  onPressIn={() => {}}
  onPressOut={() => {}}
  onLongPress={() => {}}
  hitSlop={10}
  style={(state) => ({
    backgroundColor: state.pressed ? '#333' : '#666',
    opacity: state.hovered ? 0.8 : 1,
  })}
>
  {(state) => <Text>{state.pressed ? 'Pressing...' : 'Press me'}</Text>}
</Pressable>
```

### TextInput (Love2D/Web only)
```tsx
<TextInput
  value={text}
  onChangeText={setText}
  onSubmit={(val) => console.log(val)}
  placeholder="Type here..."
  placeholderColor="#888"
  style={{ backgroundColor: '#222', padding: 8 }}
  textStyle={{ color: '#fff', fontSize: 14 }}
  autoFocus
/>
```

### ScrollView (Love2D/Web only)
```tsx
<ScrollView
  style={{ height: 200 }}
  horizontal={false}
  showScrollIndicator
  onScroll={({ scrollX, scrollY }) => {}}
>
  {/* tall content */}
</ScrollView>
```

### FlatList (Love2D/Web only)
```tsx
<FlatList
  data={items}
  renderItem={({ item, index }) => <ItemRow item={item} />}
  keyExtractor={(item) => item.id}
  itemHeight={40}
  style={{ height: 300 }}
  onEndReached={loadMore}
/>
```

### Modal (Love2D/Web only)
```tsx
<Modal visible={showModal} onRequestClose={() => setShowModal(false)}>
  <Box style={{ backgroundColor: '#fff', padding: 20 }}>
    <Text>Modal content</Text>
  </Box>
</Modal>
```

### Form Components (Love2D/Web only)
```tsx
<Slider value={val} onValueChange={setVal} min={0} max={100} />
<Switch value={on} onValueChange={setOn} />
<Checkbox checked={checked} onValueChange={setChecked} label="Option" />
<RadioGroup value={selected} onValueChange={setSelected}>
  <Radio value="a" label="Option A" />
  <Radio value="b" label="Option B" />
</RadioGroup>
<Select
  value={selected}
  onValueChange={setSelected}
  options={[{ label: 'One', value: '1' }, { label: 'Two', value: '2' }]}
/>
```

## Animation System (Love2D/Web only)

```tsx
import { useAnimation, useSpring, AnimatedValue, Easing, parallel, sequence, stagger, loop } from '@ilovereact/core';

// Timing animation
const opacity = useAnimation(0, 1, { duration: 300, easing: Easing.easeInOut });

// Spring animation
const scale = useSpring(1, { stiffness: 150, damping: 12 });

// Manual AnimatedValue
const val = new AnimatedValue(0);
val.timing({ toValue: 100, duration: 500 }).start();
val.spring({ toValue: 100, stiffness: 200 }).start();

// Composition
parallel([anim1, anim2]).start();
sequence([anim1, anim2]).start();
stagger(100, [anim1, anim2, anim3]).start();
loop(anim, { iterations: 3 }).start();
```

## Hooks

```tsx
import { useLove, useLoveEvent, useLoveRPC, useLoveState, useLoveReady, useLoveSend } from '@ilovereact/core';

// Access bridge
const bridge = useLove();

// Listen to bridge events
useLoveEvent('game:score', (data) => { ... });

// Call Lua functions
const result = await useLoveRPC()('getPlayerHealth', { id: 1 });

// Shared state with Lua
const [count, setCount] = useLoveState('counter', 0);

// Wait for bridge ready
const ready = useLoveReady();

// Send messages to Lua
const send = useLoveSend();
send('ui:action', { type: 'click' });
```

## This Is Not CSS (READ THIS FIRST)

iLoveReact's layout engine is **honest flexbox**. No margin collapsing, no shrink-to-fit
heuristics, no intrinsic sizing fallbacks, no auto-sizing magic. If you don't specify a
dimension, it's zero. If you say grow, it grows — no other mechanism intervenes.

**Every pattern you know from CSS/React web will silently produce broken layouts here.**
Your instinct to use `flexGrow: 1` on a root container, or omit `fontSize`, or use CSS
properties like `background` — all of these produce invisible, zero-size, or misrendered
elements with no error message.

### Pre-Generation Checklist

Before writing ANY component, verify:
- [ ] Root element has `width: '100%', height: '100%'` (NOT `flexGrow: 1`)
- [ ] Every `<Text>` has explicit `fontSize` in its style
- [ ] No `flexGrow` without at least one sibling having explicit main-axis size
- [ ] Pixel art grids have pre-computed container dimensions
- [ ] Only valid iLoveReact style properties used (no CSS-only props like `background`, `boxShadow`, `transition`)
- [ ] Flex nesting is shallow — prefer explicit sizes over deep nesting

These rules are enforced by `ilovereact lint`. If your code passes lint, the layout
structure is valid. **You MUST run `ilovereact lint` after writing any component —
this is not optional.**

### Screenshot Verification

After writing or modifying a component, verify the output visually:
```bash
ilovereact screenshot --output /tmp/preview.png
```
Then read `/tmp/preview.png` to confirm the layout is correct before proceeding.
**Do not consider a component done until you have visually verified the screenshot.**

## Layout Rules (CRITICAL)

These rules apply to ALL targets but are especially important for Love2D where the
flexbox engine requires deterministic sizing at every node in the tree.

### 1. Every container must have explicit dimensions or directly measurable content

The layout engine walks the tree bottom-up to compute sizes. If a container's size
depends on children whose sizes depend on the parent, you get undefined behavior
(overlapping, invisible elements, 0-height nodes).

**Good** — heart grid container with pre-computed dimensions:
```tsx
const HEART_PX = 12;
const HEART_COLS = 13;
const HEART_ROWS = 10;

<Box style={{ width: HEART_COLS * HEART_PX, height: HEART_ROWS * HEART_PX }}>
  {grid.map(row => (
    <Box style={{ flexDirection: 'row' }}>
      {row.map(cell => <Box style={{ width: HEART_PX, height: HEART_PX, backgroundColor: cell.color }} />)}
    </Box>
  ))}
</Box>
```

**Bad** — relying on 130 nested children to infer container size:
```tsx
<Box style={{ flexDirection: 'column' }}>
  {grid.map(row => (
    <Box style={{ flexDirection: 'row' }}>
      {row.map(cell => <Box style={{ width: 12, height: 12 }} />)}
    </Box>
  ))}
</Box>
```

If you can compute the dimensions ahead of time, always provide them explicitly.

### 2. Keep the flex tree shallow — never nest rows inside columns inside rows unnecessarily

Every wrapper layer adds ambiguity for the layout engine. A label/value pair does NOT
need its own FlexRow wrapper component inside a column inside a row.

**Good** — flat structure, each info row is a direct child:
```tsx
<Box style={{ gap: 4 }}>
  <Box style={{ flexDirection: 'row', gap: 4 }}>
    <Text style={{ color: '#e94560', fontSize: 14, fontWeight: '700' }}>OS:</Text>
    <Text style={{ color: '#e0e0f0', fontSize: 14 }}>Arch Linux</Text>
  </Box>
  <Box style={{ flexDirection: 'row', gap: 4 }}>
    <Text style={{ color: '#e94560', fontSize: 14, fontWeight: '700' }}>CPU:</Text>
    <Text style={{ color: '#e0e0f0', fontSize: 14 }}>Ryzen 9</Text>
  </Box>
</Box>
```

**Bad** — wrapper component adding unnecessary nesting depth:
```tsx
function InfoLine({ label, value }) {
  return (
    <FlexRow justify="space-between" align="center">
      <Text>{label}:</Text>
      <Text>{value}</Text>
    </FlexRow>
  );
}
// This creates: FlexRow > FlexColumn > FlexRow(InfoLine) > Text — 3 levels deep
```

### 3. Use `Box` with `flexDirection` directly — not wrapper components for layout

`FlexRow` and `FlexColumn` are convenience wrappers available from `@ilovereact/core`,
but when building layouts, prefer `Box` with explicit `flexDirection` and style props.
This keeps the tree transparent and avoids hidden abstraction layers.

```tsx
// Direct and clear
<Box style={{ flexDirection: 'row', gap: 24 }}>
  <Box style={{ width: 156, height: 120 }}>{/* heart */}</Box>
  <Box style={{ gap: 4 }}>{/* info lines */}</Box>
</Box>
```

### 4. Follow the SettingsDemo pattern for card-like containers

The proven pattern for card sections (used throughout the storybook):
```tsx
<Box style={{
  gap: 12,
  backgroundColor: '#1e293b',
  borderRadius: 10,
  padding: 14,
}}>
  <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700' }}>Section Title</Text>
  {/* content */}
</Box>
```

No `overflow: 'hidden'`, no wrapper body Box, no extra abstraction. Just a Box with
`gap`, `backgroundColor`, `borderRadius`, and `padding`.

### 5. Every Text MUST have explicit fontSize (Love2D/Web targets)

Text without fontSize cannot be measured. Always specify it:
```tsx
<Text style={{ color: '#fff', fontSize: 14 }}>Content</Text>
```

### 6. Reference the storybook — if a pattern works there, use it exactly

The storybook (`examples/storybook/`) is the source of truth for what renders correctly.
Before writing a new layout, find the closest working storybook demo and match its
structure. The same primitives doing the same thing produce the same result.

### 7. Fill the viewport — the window is a fixed-size canvas, not a scrolling page

Love2D windows have a fixed size set at startup (typically ~500×700 or similar). There
is no scrollbar. Treat the viewport as a canvas to fill, not a vertical document to
flow top-to-bottom into the top-left corner.

**Think in rows first.** Group related content into horizontal rows that span the full
width, then subdivide each row into columns. Use `justifyContent: 'space-around'` or
`'space-between'` on rows to distribute content across the available width.

**Good** — weather dashboard filling the viewport with explicit child sizing:
```tsx
<Box style={{ width: '100%', height: '100%', gap: 16, padding: 16 }}>
  {/* Row 1: visual + primary stats + secondary stats */}
  <Box style={{ flexDirection: 'row', gap: 20, flexGrow: 1 }}>
    <Box style={{ width: 88, height: 88 }}>{/* pixel art icon */}</Box>
    <Box style={{ flexGrow: 1, gap: 4 }}>{/* temp + condition — grows to fill */}</Box>
    <Box style={{ width: 180, gap: 4 }}>{/* humidity, wind, pressure — fixed width */}</Box>
  </Box>
  {/* Row 2: forecast + supplementary info */}
  <Box style={{ flexDirection: 'row', gap: 12, flexGrow: 1 }}>
    <Box style={{ flexGrow: 1 }}>{/* 7-day forecast — grows */}</Box>
    <Box style={{ width: 110 }}>{/* cloud cover — fixed width for pixel art */}</Box>
  </Box>
</Box>
```

**Bad** — stacking everything vertically, leaving 60% of horizontal space empty:
```tsx
<Box style={{ gap: 16, padding: 16 }}>
  <Box>{/* icon + temp */}</Box>
  <Box>{/* stats */}</Box>
  <Box>{/* forecast */}</Box>
  <Box>{/* cloud */}</Box>
</Box>
```

The Neofetch demo demonstrates this: heart on the left, info lines on the right —
one row filling the width. The SettingsDemo uses two columns of cards. Always plan
which content groups sit side-by-side before writing any JSX.


### Grid Target Dashboard
```tsx
function Dashboard() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a', flexDirection: 'column' }}>
      <Box style={{ backgroundColor: '#16213e', padding: 1 }}>
        <Text style={{ color: '#e94560' }}>Dashboard</Text>
      </Box>
      <Box style={{ flexDirection: 'row', flexGrow: 1 }}>
        <Box style={{ width: '30%', backgroundColor: '#1a1a2e', padding: 1 }}>
          <Text style={{ color: '#888' }}>Sidebar</Text>
        </Box>
        <Box style={{ flexGrow: 1, padding: 1 }}>
          <Text style={{ color: '#fff' }}>Main Content</Text>
        </Box>
      </Box>
      <Box style={{ backgroundColor: '#16213e', padding: 1 }}>
        <Text style={{ color: '#555' }}>Footer</Text>
      </Box>
    </Box>
  );
}
```

### Love2D HUD Overlay
```tsx
function HUD() {
  const [health] = useLoveState('health', 100);
  return (
    <Box style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 8 }}>
      <Box style={{
        width: 200, height: 20,
        backgroundColor: '#333',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        <Box style={{
          width: `${health}%`, height: '100%',
          backgroundColor: health > 50 ? '#4CAF50' : '#f44336',
        }} />
      </Box>
      <Text style={{ color: '#fff', fontSize: 14 }}>{health} HP</Text>
    </Box>
  );
}
```
