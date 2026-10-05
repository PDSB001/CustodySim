# Episteme native reader integration

## Current implementation boundary

Episteme's semantic HTML/CSS parser, styling, native Compose measurement,
pagination and ruby drawing are vendored in `android/episteme-core`.
The reviewed upstream revision is recorded in `UPSTREAM.json` together with
each original and adapted file's SHA-256. The import script refuses another
revision. This module compiles independently and does not need WebView.

The app-side `EpistemeReader` adapter is enabled for the **development** build
through `BuildConfig.EPISTEME_READER`. EPUB/DOCX, including fixed-layout EPUB,
route to it without an automatic WebView fallback. TXT and PDF retain their
native paths. Other build types keep their existing renderer pending validation.
This is a device-test rollout, not a completed migration across all variants.

The adapter preserves the existing server document contract and reading session,
and converts Episteme UTF-16 splits to server Unicode-code-point positions.
It loads authenticated resources through the existing account/revision-scoped
persistent cache. Bitmap memory is bounded to 16 MiB per reader instance.
It implements native horizontal gestures, continuous scrolling, image containment,
search highlighting, ID/footnote navigation and adjacent-chapter preheating.
These paths require device validation before production activation.

Development preloading now counts actual screens: opening/jumping prepares
four screens (current plus following screens, filling from earlier screens
near the book end). While reading, a cancellable worker alternately warms the
next/previous screen until twenty on each side are ready, crossing linear
chapter boundaries. Source chapters are already in the persisted document;
native pagination is retained by chapter and can contain more than this window.
Image resource bytes use the existing bounded persistent cache; decoded bitmap
memory remains bounded to 16 MiB. Off-window chapters are evicted from memory.
Warm hits bypass speculative work, per-chapter locks avoid blocking unrelated
loads, and pagination/anchor work runs off the main thread while Compose text
measurement returns to the main thread as required.

Raw EPUB/DOCX package parsing is still performed by the existing server pipeline;
the imported Episteme parser consumes its canonical HTML/CSS. PDF remains on the
existing native Android PDF path. Neither raw DOCX parser migration nor an
Episteme/Pdfium PDF migration has been completed in this change.

## Local changes to vendored code

- Replace the upstream app BuildConfig reference with this module's BuildConfig.
- Remove broad API 34/35 annotations from portable Compose pagination functions;
  no corresponding platform-only calls were imported. API 26 device behavior
  remains a release validation requirement.
- Remove redundant compiler expressions without changing pagination decisions.
- Expose block-box and image-containment geometry to the app adapter so drawing
  and pagination can share their width/height rules.
- Import horizontal ruby and relative-position drawing helpers.
- Route the two upstream diagnostic log calls through Timber.

`scripts/vendor-episteme-core.mjs` contains these transformations; do not edit
generated source without also recording its transformation and updating hashes.

## Remaining activation gates

- Verify actual block geometry against the measured height: narrow/stacked tables,
  cell borders/padding, wrapping text with indents, flex rows and large images.
- Complete native vertical-writing, chant and complex MathML behavior; their
  current adapter presentation is not equivalent to the upstream reader.
- Verify fixed-layout EPUB scaling, page anchors on consecutive image-only pages,
  selection behavior in drawn wrapping text and external-link handling.
- Verify rapid repeat gestures, stable-key cross-section paging, mode changes,
  navigation cancellation and continuous-scroll restoration on a device.
- Only then enable the production variants and remove obsolete WebView code.

## Licensing and source distribution

The combined Android application is distributed under AGPL-3.0-only. Existing
MIT grants remain intact. Web/server code remains under the root MIT license;
no Episteme code has been copied into those applications. A Gradle module boundary
does not exempt the combined Android application from AGPL obligations.

See `android/README-LICENSE.md`. The in-app About page exposes the license texts,
upstream attribution and corresponding-source instructions. New direct reader
dependencies' original license texts are bundled in the APK assets.

From `android/`, run `./gradlew androidCorrespondingSource` to generate the
corresponding-source ZIP. Rebuild it from the exact source tree used for each
distributed APK and publish them together. The archive excludes build outputs,
local.properties, environment files, IDE metadata and signing keys; review other
locally added files before publication. No APK or source has been published by
this integration work.

## Validation recorded so far

- `:episteme-core:compileDebugKotlin` passed.
- `:app:compileDevelopmentKotlin` passed for the native adapter and license UI.
- `EpistemeAnchorsTest`: supplementary Unicode and repeated-text positions passed.
- `androidCorrespondingSource` generated successfully.
- Core Android lint passed with no issues after moving reviewed versions to the
  shared catalog and adapting diagnostic logging.
- The corresponding-source archive contains 350 entries; the build-input
  whitelist excludes local Gradle homes, signing material and private settings.
- App-wide lint is not clean: dependency-version and existing logging findings
  still require separate review. No global warning suppression was added.
- No new-engine device/performance results are asserted here.
- Development APK assembled with `EPISTEME_READER=true` and installed using
  `adb install -r` for user testing, without clearing app data.
- Router/anchor tests: 3 passed. EPUB/DOCX activation is verified at the build
  configuration and call-site level; actual book rendering/performance awaits
  device testing.

## Stable native paging window (2026-10-05)

Development EPUB/DOCX paging uses a stable-key window of up to 41 actual screens.
Settling a page commits its anchor without resetting the pager or disabling touch.
Window updates wait until dragging and settling have stopped; keys retain the
visible page when earlier screens are inserted. Explicit navigation still owns
its cancellable loading state. Text/link tap detectors retain their coroutine
across callback updates, preserving active touches during progress recomposition.

Preheating finishes its current batch and catches up to the latest position,
rather than cancelling chapter compilation on every settled page. Resource paths
are deduplicated for the worker lifetime. There is no fixed per-screen delay;
speculative block measurement pauses while either reader is scrolling. Whole
chapters are still paginated, and a single complex block can still occupy the
main thread; native frame-time measurements remain necessary before claiming
competitive performance. Persistent document/resource caches are unchanged.
## Navigation and continuous-scroll corrections (2026-10-05)

- Controller cancellation interrupts navigation/turn jobs only. It preserves the
  attached commit callback and preheating worker; disposal owns their teardown.
- Explicit directory/search/bookmark navigation stops the old pager/list motion
  before replacing its window. Navigation completion is observed even if the
  visible key was initially emitted while loading.
- Continuous mode shares the stable 41-screen cached window. Section crossings
  commit a keyed position without rebuilding chapters or issuing scrollToItem
  during the drag/fling. Idle window updates preserve the visible item and pixels.
- Image-only chapter fractions retain the native page identity when committing
  continuous-scroll locations, rather than being overwritten by pixel fractions.
- Adjacent-section errors do not hide a valid current section; cancellation still
  aborts superseded navigation. Cache pruning skips active explicit navigation.
- Failed image preheating is not permanently marked visited, so later batches retry.

These corrections were code-reviewed and covered by targeted JVM regressions;
slow-drag/continuous-fling timing still requires real-device interaction checks.

## Seek latency, raster decoding and link presentation (2026-10-05)

Progress-bar and other explicit jumps now publish the target without synchronously
preparing adjacent sections or a four-screen batch. Cold opening retains the
initial batch; the persistent worker continues the 20-screen bidirectional warm
window after a jump. The initial-load callback is delivered once per engine, so a
search callback that jumps to a result cannot recursively restart navigation.

Raster decoding now initializes a positive, bounded power-of-two sampling factor.
The former calculation read BitmapFactory.Options.inSampleSize before assigning
it, allowing division by zero to be caught as an image failure. Native images clear
stale display state on source changes, retry a failed load twice with bounded
backoff, and offer a manual retry after persistent failure without changing layout.

The pinned ReaderLinkStyle import is reproducibly adapted to use transparent link
backgrounds while retaining link color, underlines and URL annotations. Footnotes
therefore remain clickable without appearing permanently selected. The vendor
manifest records the adapted hash; upstream license/attribution remain intact.

## Cold-open motion wait regression (2026-10-05)

Navigation stops only the active mode's Compose scroll state. Stopping both states
can await the first layout of the unmounted pager/list indefinitely, preventing
cold opening from reaching parsing and position commit. ReaderMotionTest models
the unmounted state's never-completing layout wait for both modes. This fixes the
regression introduced by the navigation-interruption correction above.
