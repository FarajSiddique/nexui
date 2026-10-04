# App icon

Nexui's icon is **Duet**: a lowercase n drawn as two strokes. The stem is you (ink, or paper in
dark mode, the app's "You" colors) and the arch is Nexui (highlighter yellow), on magenta
`#E8408C`. The SVGs here are the sources. The PNGs in `apps/mobile/assets/images/` are exported
from them and are what `apps/mobile/app.config.ts` uses.

| Source                        | Export                          | Requirements                                       |
| ----------------------------- | ------------------------------- | -------------------------------------------------- |
| `duet.svg`                    | `icon.png`                      | iOS light and the default icon. 1024px, no alpha. |
| `duet-dark.svg`               | `icon-dark.png`                 | iOS dark. 1024px, no alpha.                        |
| `duet-tinted.svg`             | `icon-tinted.png`               | iOS tinted. 1024px grayscale, no alpha.            |
| `duet-android-foreground.svg` | `android-icon-foreground.png`   | Android adaptive foreground. 1024px, transparent.  |
| `duet-android-monochrome.svg` | `android-icon-monochrome.png`   | Android themed icon. 1024px, transparent, white.   |
| `duet.svg`                    | `favicon.png`                   | Web. 256px with rounded corners.                   |

The glyph is centered on the 1024 canvas. On Android it's scaled to 70% because the launcher
shows only the middle two-thirds of each layer; the adaptive background is the magenta in
`app.config.ts`. The monochrome version leaves a gap between the stem and the arch so the two
strokes still read in one color.

A new icon reaches devices only with a new native build (`pnpm build:preview`). A local
`apps/mobile/ios` folder keeps its old icon until `npx expo prebuild` regenerates it.
