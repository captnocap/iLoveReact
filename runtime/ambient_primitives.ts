// Ambient primitive re-exports. Separated from framework/ambient.ts so
// the React+hooks ambient file has zero dependency on runtime/primitives.
// That split is what breaks the
//   require_index → require_react → init_ambient → init_primitives →
//   require_react (recursive → partial {}) → `React.memo` undefined
// cycle the single-file ambient produced in V8. Injected alongside
// framework/ambient.ts via scripts/build-bundle.mjs.

export {
  Box,
  Row,
  Col,
  Text,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  TextArea,
  TextEditor,
  Terminal,
  terminal,
  Video,
  StaticSurface,
  Canvas,
  Graph,
  Render,
  Effect,
  Native,
} from '../runtime/primitives';
