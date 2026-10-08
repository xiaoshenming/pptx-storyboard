# EMF preview fidelity

`emf-converter@2.0.4.patch` is applied automatically by Bun (`patchedDependencies`
in the root package.json). It patches both ESM and CommonJS builds:

- Read LOGFONTW.lfFaceName after the object handle and 28-byte font header
  (`dataOff + 32`). The previous offset included charset/precision bytes,
  producing invalid Canvas font strings and incorrect inherited font sizes.
- Use the authored EMF frame, converted from 0.01 mm using reference device
  pixel/mm metrics, instead of the tight ink bounds. Preserve Word whitespace
  and aspect ratio. Invalid or absent device metrics retain the bounds fallback.

Regression fixtures in `packages/core/src/__tests__/fixtures/word-emf/` are the
two original EMF previews from slide 10 of the user-supplied `8.3 第1课时.pptx`.
The tests replay the real files and inspect canvas dimensions and font selections.
Visual verification also compares the rendered slide with the user's reference.
