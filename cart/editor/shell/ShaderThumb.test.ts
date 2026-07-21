import { sameShaderThumbProps, type ShaderThumbProps } from './ShaderThumb';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, body: () => void): void {
  try {
    body();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

const base: ShaderThumbProps = { shader: 'shader-a', data: [1, 2, 3], size: 32 };

test('fresh arrays with equal shader data preserve the cached thumbnail', () => {
  assert(sameShaderThumbProps(base, { shader: 'shader-a', data: [1, 2, 3], size: 32 }), 'equal data invalidated the thumbnail');
});

test('implicit and explicit default sizes describe the same thumbnail', () => {
  assert(
    sameShaderThumbProps({ shader: 'shader-a', data: [1] }, { shader: 'shader-a', data: [1], size: 40 }),
    'default size equivalence was lost',
  );
});

test('real shader, data, and size changes invalidate the thumbnail', () => {
  assert(!sameShaderThumbProps(base, { ...base, shader: 'shader-b' }), 'shader change was ignored');
  assert(!sameShaderThumbProps(base, { ...base, data: [1, 2, 4] }), 'data change was ignored');
  assert(!sameShaderThumbProps(base, { ...base, data: [1, 2] }), 'data length change was ignored');
  assert(!sameShaderThumbProps(base, { ...base, size: 44 }), 'size change was ignored');
});
