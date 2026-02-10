# react-love

Write React components once, render them as DOM overlays on a Love2D WASM canvas **or** as native Love2D draw calls via QuickJS. The React Native pattern applied to Love2D.

```
            Your Components (JSX)
     Box, Text, Image, ScrollView, Modal, Pressable,
     TextInput, FlatList, Slider, Switch, Checkbox,
     Radio, RadioGroup, Select
                     |
          +----------+----------+
          |                     |
     Web Renderer          Native Renderer
          |                     |
  Box -> <div> + CSS      Box -> Love2D rect
  Text -> <span>          Text -> Love2D print
  WebBridge (Module.FS)   NativeBridge (QuickJS FFI)
          |                     |
  DOM overlays on          react-reconciler ->
  Love2D WASM canvas       command buffer -> Lua ->
                           Love2D draw calls
```

## How it works

Both renderers share the same abstraction layer:

- **`IBridge`** — transport interface. `send()` commands to the game, `subscribe()` to events from it. Two implementations: `WebBridge` (Emscripten Module.FS file I/O) and `NativeBridge` (QuickJS FFI globals).
- **`RendererMode`** — React context (`'web'` or `'native'`). Primitives check this to decide what to emit.
- **Shared primitives** — `<Box>`, `<Text>`, `<Image>`. In web mode they render as `<div>`/`<span>`/`<img>` with CSS flexbox. In native mode they emit string-typed host elements (`'View'`/`'Text'`/`'Image'`) that react-reconciler serializes as mutation commands for Lua to interpret.
- **Shared hooks** — `useLoveState`, `useLoveEvent`, `useLoveRPC`, `useLoveSend`, etc. All consume `IBridge` via context. They don't know which bridge they're talking to.

## Packages

### `packages/shared`

The abstraction layer both renderers depend on. Contains all components, hooks, and the animation system.

| File | Purpose |
|---|---|
| `types.ts` | `Style`, `BoxProps`, `TextProps`, `ImageProps`, `ScrollViewProps`, `TextInputProps`, `FlatListProps`, `Color`, `LoveEvent`, `ScrollEvent` |
| `bridge.ts` | `IBridge` interface — `send`, `flush`, `subscribe`, `rpc`, `setState`, `isReady`, `onReady`, `destroy` |
| `context.ts` | `BridgeProvider` + `useBridge()`, `RendererProvider` + `useRendererMode()` |
| `hooks.ts` | `useLove`, `useLoveEvent`, `useLoveRPC`, `useLoveState`, `useLoveReady`, `useLoveSend`, `useLoveOverlays` |
| `primitives.tsx` | `Box`, `Text`, `Image` — mode-switching components. `styleToCSS`, `colorToCSS` utilities |
| `ScrollView.tsx` | Scrollable container with `scrollTo` imperative API. Web: native scroll. Native: scroll state in style props |
| `TextInput.tsx` | Text input with controlled/uncontrolled modes, cursor management, secure entry, multiline |
| `Pressable.tsx` | Touch/click handler with pressed/hovered/focused state via render props, long press, hit slop |
| `Portal.tsx` | Portal system for rendering children outside the component tree (modals, tooltips) |
| `Modal.tsx` | Modal dialog with backdrop, animation (fade/slide), escape key dismissal |
| `FlatList.tsx` | Virtualized list with windowed rendering, grid mode, inverted, headers/footers |
| `Slider.tsx` | Draggable value selector, horizontal/vertical, step snapping |
| `Switch.tsx` | Boolean toggle with animated thumb |
| `Checkbox.tsx` | Toggleable checkbox with optional label, custom colors/sizing |
| `Radio.tsx` | Radio + RadioGroup — exclusive selection via React context |
| `Select.tsx` | Dropdown select. Web: native `<select>`. Native: inline accordion expand/collapse |
| `animation.ts` | `AnimatedValue`, timing/spring physics, easing functions, composite animations (`parallel`, `sequence`, `stagger`, `loop`), hooks (`useAnimation`, `useSpring`, `useTransition`) |

### `packages/web`

DOM overlay renderer for Love2D in the browser via love.js.

| File | Purpose |
|---|---|
| `WebBridge.ts` | `IBridge` over Emscripten Module.FS. JSON files on a shared ramdisk. rAF polling loop. RPC with timeout. Multi-instance `BridgeRegistry` |
| `LoveInstance.tsx` | React component that mounts a Love2D WASM canvas. Children render as DOM overlays. Handles module loading, canvas lifecycle, namespace chaining for nesting |

### `packages/native`

Love2D draw-command renderer via QuickJS embedded in Love2D.

| File | Purpose |
|---|---|
| `NativeBridge.ts` | `IBridge` over QuickJS FFI globals (`__hostFlush`, `__hostGetEvents`). Immediately ready — Lua drives the frame loop |
| `hostConfig.ts` | `react-reconciler` host config. Mutation commands: `CREATE`, `APPEND`, `UPDATE`, `REMOVE`, `INSERT_BEFORE`, etc. Minimal prop diffing (only changed properties cross the bridge). Command coalescing (multiple UPDATEs for the same node merge before flush). Event handler registry on JS side |
| `eventDispatcher.ts` | Routes bridge events to React handlers. Bubbling support (click, release, wheel, touch, drag), non-bubbling (pointerEnter/Leave), global broadcast (keyboard, gamepad) |
| `NativeRenderer.ts` | `createRoot(bridge)` wrapper over react-reconciler. Flushes command buffer on commit |
| `measureText.ts` | Text measurement via Love2D font APIs through the bridge |

### `lua/`

Lua-side modules for both web and native targets.

| File | Purpose |
|---|---|
| `init.lua` | Entry point. Auto-detects web vs native mode. Exposes `ReactLove.init()`, `.update(dt)`, `.draw()`, `.mousepressed()`, `.mousereleased()`, `.mousemoved()`, `.keypressed()`, `.keyreleased()`, `.textinput()`, `.wheelmoved()`, `.touchpressed()`, `.touchreleased()`, `.touchmoved()`, `.gamepadpressed()`, `.gamepadreleased()`, `.gamepadaxis()`, `.resize()`, `.quit()` |
| `tree.lua` | Retained element tree. `applyCommands()` interprets mutation commands. In-place style merging for partial prop updates. Scroll state management |
| `layout.lua` | Flexbox layout engine. px/%/vw/vh units, flexDirection, justifyContent (6 modes), alignItems (4 modes), flexGrow/flexShrink, flexWrap, gap, padding, margin, absolute positioning |
| `painter.lua` | Love2D draw calls. backgroundColor, backgroundGradient, borderRadius, border, box shadow, opacity, transforms (translate/rotate/scale), text rendering (color, fontSize, textAlign, lineHeight, textOverflow), image (objectFit modes), scissor clipping, zIndex ordering |
| `events.lua` | Hit testing (reverse paint order, zIndex-aware, scroll-adjusted), hover tracking (pointerEnter/Leave), drag tracking with threshold, event bubble path construction |
| `bridge_fs.lua` | Module.FS bridge (web target). Reads/writes JSON files on Emscripten's in-memory filesystem |
| `bridge_quickjs.lua` | QuickJS FFI bridge (native target). Direct JSValue traversal via C API (no JSON serialization). LuaJIT FFI bindings, tag auto-detection, timer polyfills, host callbacks. Falls back to JSON on FFI errors |
| `measure.lua` | Text measurement and font caching for the layout engine |
| `images.lua` | Image loading with reference counting |
| `zindex.lua` | Z-index sorting for paint order |

## Components

### Primitives

```tsx
import { Box, Text, Image } from '@react-love/shared';

<Box style={{ flexDirection: 'row', gap: 8, padding: 16 }}>
  <Image src="avatar.png" style={{ width: 48, height: 48, borderRadius: 24 }} />
  <Text style={{ color: '#fff', fontSize: 14 }}>Hello world</Text>
</Box>
```

### ScrollView

```tsx
import { ScrollView } from '@react-love/shared';

const ref = useRef<ScrollViewRef>(null);

<ScrollView ref={ref} style={{ height: 300 }} onScroll={(e) => console.log(e.scrollY)}>
  {items.map(item => <ItemRow key={item.id} item={item} />)}
</ScrollView>

// Imperative scrolling
ref.current?.scrollTo({ y: 0, animated: true });
```

### TextInput

```tsx
import { TextInput } from '@react-love/shared';

<TextInput
  value={text}
  onChangeText={setText}
  placeholder="Type here..."
  style={{ borderWidth: 1, borderColor: '#ccc', padding: 8 }}
/>
```

Supports: controlled/uncontrolled, `secureTextEntry`, `multiline`, `maxLength`, `autoFocus`, `onSubmit`, `onFocus`/`onBlur`.

### Pressable

```tsx
import { Pressable } from '@react-love/shared';

<Pressable
  onPress={() => console.log('pressed')}
  onLongPress={() => console.log('long press')}
  style={(state) => ({
    backgroundColor: state.pressed ? '#0a5' : state.hovered ? '#0c7' : '#0d7',
    padding: 12,
    borderRadius: 6,
  })}
>
  {(state) => <Text style={{ color: '#fff' }}>{state.pressed ? 'Pressing...' : 'Press me'}</Text>}
</Pressable>
```

### Modal

```tsx
import { Modal } from '@react-love/shared';

<Modal
  visible={showModal}
  onRequestClose={() => setShowModal(false)}
  animationType="fade"
  transparent
>
  <Box style={{ padding: 24, backgroundColor: '#fff', borderRadius: 8 }}>
    <Text>Modal content</Text>
  </Box>
</Modal>
```

### FlatList

```tsx
import { FlatList } from '@react-love/shared';

<FlatList
  data={items}
  renderItem={({ item }) => <ItemRow item={item} />}
  keyExtractor={(item) => item.id}
  itemHeight={60}
  onEndReached={loadMore}
  ListEmptyComponent={<Text>No items</Text>}
/>
```

Supports: virtualized windowed rendering, `numColumns` grid, `inverted`, `initialNumToRender`, `windowSize`, headers/footers/separators, `scrollToIndex`/`scrollToOffset`.

### Slider

```tsx
import { Slider } from '@react-love/shared';

<Slider
  value={volume}
  onValueChange={setVolume}
  minimumValue={0}
  maximumValue={100}
  step={1}
/>
```

### Switch

```tsx
import { Switch } from '@react-love/shared';

<Switch value={enabled} onValueChange={setEnabled} />
```

### Checkbox

```tsx
import { Checkbox } from '@react-love/shared';

<Checkbox
  value={accepted}
  onValueChange={setAccepted}
  label="Accept terms"
/>
<Checkbox value={true} label="Custom color" color="#22c55e" />
<Checkbox value={false} disabled label="Disabled" />
```

Supports: controlled/uncontrolled, `label`, `size`, `color`, `uncheckedColor`, `disabled`.

### Radio / RadioGroup

```tsx
import { Radio, RadioGroup } from '@react-love/shared';

<RadioGroup value={selected} onValueChange={setSelected}>
  <Radio value="small" label="Small" />
  <Radio value="medium" label="Medium" />
  <Radio value="large" label="Large" />
</RadioGroup>
```

`RadioGroup` provides context for exclusive selection. Each `Radio` reads group state. Supports: controlled/uncontrolled, `size`, `color`, `uncheckedColor`, per-item `disabled`.

### Select

```tsx
import { Select } from '@react-love/shared';

<Select
  value={theme}
  onValueChange={setTheme}
  options={[
    { label: 'Dark', value: 'dark' },
    { label: 'Light', value: 'light' },
    { label: 'System', value: 'system' },
  ]}
  placeholder="Choose theme..."
/>
```

Web mode renders a native `<select>` element. Native mode renders an inline accordion — clicking the header toggles the option list, clicking an option selects it and collapses. No `position: absolute` required.

Supports: controlled/uncontrolled, `placeholder`, `disabled`, `color`.

## Animation

```tsx
import { useAnimation, useSpring, Easing, parallel, sequence } from '@react-love/shared';

// Timing animation
const opacity = useAnimation({ from: 0, to: 1, duration: 300, easing: Easing.easeOut });

// Spring animation
const scale = useSpring({ from: 0.8, to: 1, stiffness: 200, damping: 15 });

// Composite animations
parallel([
  opacity.timing({ to: 1, duration: 200 }),
  scale.spring({ to: 1.2 }),
]).start();

// Sequence with stagger
sequence([
  item1Opacity.timing({ to: 1, duration: 150 }),
  item2Opacity.timing({ to: 1, duration: 150 }),
]).start();

// Interpolation
const color = opacity.interpolate({
  inputRange: [0, 1],
  outputRange: ['#f00', '#0f0'],
});
```

Available easings: `linear`, `easeIn`, `easeOut`, `easeInOut`, `bezier(x1,y1,x2,y2)`, `bounce`, `elastic`.

## Events

Components receive events via handler props. Events support bubbling through the component tree.

### Mouse/Touch events (bubble)
`onClick`, `onRelease`, `onWheel`, `onTouchStart`, `onTouchEnd`, `onDragStart`, `onDrag`, `onDragEnd`

### Pointer events (no bubbling)
`onPointerEnter`, `onPointerLeave`

### Keyboard events (global broadcast)
`onKeyDown`, `onKeyUp`, `onTextInput`

### Gamepad events (global broadcast)
`onGamepadPress`, `onGamepadRelease`, `onGamepadAxis`

### Bubbling and stopPropagation

```tsx
<Box onClick={(e) => console.log('parent clicked')}>
  <Box onClick={(e) => {
    console.log('child clicked');
    e.stopPropagation(); // prevents parent handler from firing
  }}>
    <Text>Click me</Text>
  </Box>
</Box>
```

## Style system

The style API covers the intersection of CSS flexbox and what the Lua layout/painter can handle.

| Category | Properties |
|---|---|
| Sizing | `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `aspectRatio` |
| Flexbox | `display`, `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignSelf`, `flexGrow`, `flexShrink`, `flexBasis`, `gap` |
| Spacing | `padding`, `paddingLeft/Right/Top/Bottom`, `margin`, `marginLeft/Right/Top/Bottom` |
| Visual | `backgroundColor`, `borderRadius`, `overflow`, `opacity`, `zIndex` |
| Border | `borderWidth`, `borderTopWidth`, `borderBottomWidth`, `borderLeftWidth`, `borderRightWidth`, `borderColor`, `borderTopColor`, `borderBottomColor`, `borderLeftColor`, `borderRightColor` |
| Shadow | `shadowColor`, `shadowOffsetX`, `shadowOffsetY`, `shadowBlur` |
| Gradient | `backgroundGradient: { direction, colors }` |
| Transform | `transform: { translateX, translateY, rotate, scaleX, scaleY, originX, originY }` |
| Text | `color`, `fontSize`, `fontFamily`, `fontWeight`, `textAlign`, `textOverflow`, `textDecorationLine`, `lineHeight`, `letterSpacing` |
| Image | `objectFit` (`fill`, `contain`, `cover`, `none`) |
| Position | `position` (`relative`, `absolute`), `top`, `bottom`, `left`, `right` |

Units: numbers (pixels), strings (`'50%'`, `'100vw'`, `'100vh'`).

Colors: CSS strings (`'#ff0000'`, `'rgba(0,0,0,0.5)'`) or Love2D arrays (`[1, 0, 0, 1]`).

## Usage

### Writing components

```tsx
import { Box, Text, useLoveState, useLoveSend } from '@react-love/shared';

function HealthBar() {
  const [health] = useLoveState('health', 100);
  const send = useLoveSend();

  return (
    <Box style={{ padding: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4 }}>
      <Text style={{ color: '#fff', fontSize: 12 }}>HP: {Math.round(health)}</Text>
      <Box style={{ height: 4, backgroundColor: '#333', borderRadius: 2, overflow: 'hidden' }}>
        <Box style={{
          height: 4,
          width: `${health}%`,
          backgroundColor: health > 50 ? '#0d7' : health > 25 ? '#fa0' : '#f34',
          borderRadius: 2,
        }} />
      </Box>
      <Box onClick={() => send('action:heal')}
        style={{ marginTop: 6, padding: 4, backgroundColor: '#0d7', borderRadius: 2, alignItems: 'center' }}>
        <Text style={{ color: '#000', fontSize: 10, fontWeight: '700' }}>HEAL</Text>
      </Box>
    </Box>
  );
}
```

This component renders as DOM elements in web mode and as Love2D draw calls in native mode, without any changes.

### Web target

```tsx
import { LoveInstance } from '@react-love/web';

function App() {
  return (
    <LoveInstance id="game" src="/love.js" width={1024} height={768}>
      <HealthBar />
    </LoveInstance>
  );
}
```

### Native target

```tsx
import { NativeBridge, createRoot } from '@react-love/native';
import { BridgeProvider, RendererProvider } from '@react-love/shared';

const bridge = new NativeBridge();
const root = createRoot(bridge);
root.render(
  <BridgeProvider bridge={bridge}>
    <RendererProvider mode="native">
      <HealthBar />
    </RendererProvider>
  </BridgeProvider>
);
```

### Lua side

```lua
local ReactLove = require("lua.init")

function love.load()
    ReactLove.init({
        -- mode auto-detected: "web" or "native"
        bundlePath = "bundle.js",  -- native only
    })
end

function love.update(dt)
    ReactLove.update(dt)
end

function love.draw()
    -- Your game rendering here
    ReactLove.draw()  -- Paints the UI tree on top (native mode)
end

function love.mousepressed(x, y, button)
    ReactLove.mousepressed(x, y, button)
end

function love.mousereleased(x, y, button)
    ReactLove.mousereleased(x, y, button)
end

function love.mousemoved(x, y)
    ReactLove.mousemoved(x, y)
end

function love.keypressed(key, scancode, isrepeat)
    ReactLove.keypressed(key, scancode, isrepeat)
end

function love.keyreleased(key, scancode)
    ReactLove.keyreleased(key, scancode)
end

function love.textinput(text)
    ReactLove.textinput(text)
end

function love.wheelmoved(x, y)
    ReactLove.wheelmoved(x, y)
end

function love.resize(w, h)
    ReactLove.resize(w, h)
end

function love.quit()
    ReactLove.quit()
end
```

## Building

```bash
npm install

# Web target (ESM bundle)
npm run build:web

# Native target (IIFE bundle for QuickJS)
npm run build:native

# QuickJS setup (compile libquickjs.so for native target)
make setup
```

## Examples

### `examples/demo/` — Void Station

A self-contained space station command interface that demonstrates the bridge pattern with a mock bridge. Canvas renders a procedural space scene, React renders the HUD overlay using shared primitives.

```bash
npm run build:web
cd examples/demo && python3 -m http.server 8080
# Open http://localhost:8080
```

Features: system gauges, power allocation grid, sensor contacts, alert feed, action buttons. All interactive — allocate power between shields/engines/life-support/weapons, trigger repairs, boost shields, send distress signals.

### `examples/web-overlay/` — Web overlay on Love2D WASM

Mounts `<LoveInstance>` with shared HUD components as DOM overlays on a love.js canvas. Requires a compiled love.js build.

### `examples/storybook/` — Component storybook

Interactive component catalog for testing primitives side-by-side in web and native modes. Stories are organized by category:

- **Primitives** — Box, Text, Image, ScrollView, FlatList
- **Interactive** — Pressable, TextInput, Slider, Switch, Modal
- **Forms** — Checkbox, Radio, Select
- **CSS Features** — FlexShrink, AspectRatio, TextDecoration, PerSideBorders

```bash
npm run build:storybook          # Web bundle (Vite)
npm run build:storybook-native   # Native bundle (esbuild for QuickJS)
```

### `examples/native-hud/` — Native HUD via QuickJS

Love2D project that boots QuickJS, loads `bundle.js`, and renders the same HUD components as Love2D draw calls. Requires compiled QuickJS (`make setup`).

## Project structure

```
react-love/
  packages/
    shared/src/        # Components, hooks, animation, types, bridge interface
    web/src/           # WebBridge, LoveInstance
    native/src/        # NativeBridge, hostConfig, eventDispatcher, NativeRenderer
  lua/                 # Lua modules (tree, layout, painter, events, bridges, images)
  examples/
    demo/              # Void Station (self-contained, works now)
    storybook/         # Component catalog (web + native)
    web-overlay/       # Love2D WASM + DOM overlays
    native-hud/        # Love2D + QuickJS renderer
  docs/                # Research notes and reference material
```

## Architecture

### Bridge protocol

Values cross the Lua/JS bridge via direct QuickJS C API traversal — no JSON serialization. The bridge validates JSValue tag layout at init and falls back to JSON if the QuickJS build uses a different struct layout.

- **Commands** (JS -> Lua): React reconciler emits mutation commands (`CREATE`, `APPEND`, `UPDATE`, `REMOVE`, etc.). These are coalesced (multiple UPDATEs for the same node merge) and flushed once per frame as a raw JS array.
- **Events** (Lua -> JS): Input events are collected in a Lua queue and returned as a raw JS array when polled. Events include bubble paths for propagation.
- **Handlers stay in JS.** Event handler functions are never serialized. The Lua tree stores a `hasHandlers` boolean per node; hit-test results reference node IDs, and the JS-side handler registry dispatches to the correct callbacks.

### Prop diffing

The reconciler computes minimal diffs before sending UPDATE commands:

- Style objects are deep-diffed: changing `opacity` sends `{ style: { opacity: 0.5 } }`, not the entire style
- Removed properties are sent as `removeKeys`/`removeStyleKeys` arrays
- Multiple UPDATEs for the same node in a single commit are coalesced into one command
- The Lua tree merges style properties in-place rather than replacing the entire table

### Event bubbling

Mouse/touch/drag events include a bubble path — an array of node IDs from the target up to the root, filtered to nodes with handlers. The JS event dispatcher walks this path, calling handlers in order. `stopPropagation()` halts the chain. Keyboard and gamepad events broadcast globally (no focus system yet).

## Key design decisions

- **Legacy sync rendering** for react-reconciler in native mode. QuickJS lacks proper microtask scheduling, so concurrent features are disabled. Pinned to `react-reconciler@0.29`.
- **Direct FFI value passing.** QuickJS JSValues are traversed via LuaJIT FFI (`JS_GetPropertyStr`, `JS_IsArray`, etc.) instead of JSON round-trips. Eliminates per-frame GC pressure from `JSON.stringify`/`json.decode` on both sides.
- **Dual-mode components.** Every component checks `useRendererMode()` and renders DOM elements (web) or host elements (native). No conditional hooks — mode switching happens at the render output level.
- **File-based transport for web.** Both Lua and JS share Emscripten's in-memory filesystem. Love2D writes `__bridge_out.json`, JS reads it via `Module.FS.readFile`. No `js.global:eval()`, no custom WASM exports. Batched once per frame.
