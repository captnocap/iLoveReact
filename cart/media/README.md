# Media

Image gallery cart with router-backed grid and detail views.

ReactJIT stdlib imports live under `runtime/`.

Edit files here:
- `index.tsx` is the cart entry point and gallery behavior.
- `style_cls.tsx` registers classifier components with `theme:` tokens.
- `theme.ts` defines the local color and style palette.
- `cart.json` controls the host window metadata.

Run it:
```sh
./scripts/dev media
```

Ship it:
```sh
./scripts/ship media
```
