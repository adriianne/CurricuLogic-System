# Vendored libraries

Code from other projects that the pages load from this folder, not from a CDN.

| File | Version | Source | sha256 |
|---|---|---|---|
| `xlsx.full.min.js` | SheetJS 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |

**Why it is here.** The copy on npm (0.18.5) is the last one published there and has
known vulnerabilities (prototype pollution, slow-parse denial of service) when it
reads a crafted file. Fixed versions are published only on SheetJS's own site. Every
grade, schedule and account upload goes through this library.

**Updating it.** Download the new file, check the version (`XLSX.version`) and that
`XLSX.read`, `XLSX.writeFile` and the `XLSX.utils.*` calls the pages use still work,
then put its new sha256 in `tests/externalscripts.test.mjs` and in the table above.
The test fails until you do, on purpose.
