# Self-hosted web fonts

`app/layout.tsx` loads these with `next/font/local`, so `next build` never
downloads from Google Fonts (CODE_REVIEW row 2b). Each family exposes the same
CSS variable that `tailwind.config.ts` reads.

All files are the **latin** subset, copied unmodified from the Fontsource npm
packages below. Each font is licensed under the SIL Open Font License 1.1; the
package's license file sits next to the font as `OFL.txt`.

| Family            | CSS variable           | Package (npm)                              | File(s)                                      | Weights                  |
| ----------------- | ---------------------- | ------------------------------------------ | -------------------------------------------- | ------------------------ |
| Space Grotesk     | `--font-space-grotesk` | `@fontsource-variable/space-grotesk@5.3.0` | `space-grotesk-latin-wght-normal.woff2`      | variable, 300–700        |
| Plus Jakarta Sans | `--font-plus-jakarta`  | `@fontsource-variable/plus-jakarta-sans@5.3.0` | `plus-jakarta-sans-latin-wght-normal.woff2` | variable, 200–800       |
| Manrope           | `--font-manrope`       | `@fontsource-variable/manrope@5.3.0`       | `manrope-latin-wght-normal.woff2`            | variable, used at 700–800 |
| Archivo           | `--font-archivo`       | `@fontsource-variable/archivo@5.3.0`       | `archivo-latin-wght-normal.woff2`            | variable, used at 400–800 |
| IBM Plex Mono     | `--font-ibm-plex-mono` | `@fontsource/ibm-plex-mono@5.3.0`          | `ibm-plex-mono-latin-{400,500,600}-normal.woff2` | static 400, 500, 600 |

Manrope and Archivo use the variable file because that is what Google Fonts
served for them under `next/font/google`: one file for every requested weight.
`layout.tsx` declares only the weight span the app used before, so font
matching is unchanged.

npm integrity of the packed tarballs:

```
@fontsource-variable/space-grotesk@5.3.0     sha512-2IxmvfB08i9vnGB3Ym/AXvhRE+8XOjWMXIyDum03c+tPwH0FUoMNQfGpU8NXPxjbws0Vvss3AH0Zqt4oJBBAdw==
@fontsource-variable/plus-jakarta-sans@5.3.0 sha512-/l/4r0yyWK9JzAlmA0LiYgGgmJe/Gswt4jTJEzr5QhJfwMbvJZDmYWyW0M4X7yCK69BajMVlV/Lx8g7WDc1+sw==
@fontsource-variable/manrope@5.3.0           sha512-6D5dgokHsWDDMtmXHznKa0hK229NN+1a4BLPmUCLqcO1Pw5EEhWY5RFt0AcXnVRAljFFPfRtLkJePQj6LSsV6g==
@fontsource-variable/archivo@5.3.0           sha512-HogK8FJelrD1o7TlZlkIVtHgc20bO5PZRWE7mUeUTdMN055alznQV6/00J00IBeu8FQAH4s3zW9UJNvKExXf+g==
@fontsource/ibm-plex-mono@5.3.0              sha512-eTgnZjZEGk1QtD3ZstF+Vclo2HLAni8YMy34/DxllwZvyz1lR/1RF/xTiAquOBO7MvqBx8D2Ig2WCPMVfdZu7Q==
```

To reproduce or update: `npm pack <package>@<version>`, untar, and copy
`package/files/<name>-latin-…-normal.woff2` and `package/LICENSE` (as `OFL.txt`).
