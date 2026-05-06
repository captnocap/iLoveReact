// OSC 52 clipboard write — emits an escape sequence that asks the
// hosting terminal to put `text` into the system clipboard. No xclip /
// wl-copy / pbcopy dependency, works through SSH, works in tmux/kitty/
// alacritty/iTerm/most modern terminals.
//
// Format:  ESC ] 52 ; c ; <base64-utf8> BEL
//   `c` = system clipboard (use `p` for primary on X11)
//
// V8 standalone has no btoa or TextEncoder, so we encode UTF-8 + base64
// ourselves. ~20 lines, only runs once per copy.

declare const __writeStdout: ((s: string) => void) | undefined;

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6));
      out.push(0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      out.push(0xe0 | (c >> 12));
      out.push(0x80 | ((c >> 6) & 0x3f));
      out.push(0x80 | (c & 0x3f));
    } else {
      // surrogate pair
      i++;
      const low = s.charCodeAt(i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (low & 0x3ff));
      out.push(0xf0 | (cp >> 18));
      out.push(0x80 | ((cp >> 12) & 0x3f));
      out.push(0x80 | ((cp >> 6) & 0x3f));
      out.push(0x80 | (cp & 0x3f));
    }
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    const has2 = i < bytes.length;
    const b2 = has2 ? bytes[i++] : 0;
    const has3 = i < bytes.length;
    const b3 = has3 ? bytes[i++] : 0;
    out += B64[b1 >> 2];
    out += B64[((b1 & 3) << 4) | (b2 >> 4)];
    out += has2 ? B64[((b2 & 0xf) << 2) | (b3 >> 6)] : '=';
    out += has3 ? B64[b3 & 0x3f] : '=';
  }
  return out;
}

export function copyToClipboard(text: string): void {
  const seq = '\x1b]52;c;' + base64(utf8Bytes(text)) + '\x07';
  if (typeof __writeStdout === 'function') __writeStdout(seq);
  else process.stdout.write(seq);
}
