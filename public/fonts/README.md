# Embedded report font

`RebalanceSansSC-Regular.ttf` is a static, weight-400 instance of the official
Noto Sans SC variable TrueType font. Static TTF avoids the repeated WOFF
decompression cost observed in Fontkit for this large CJK font. It retains the upstream character coverage;
it is not restricted to the example report's words. The derivative family name
is Rebalance Sans SC. The upstream reserved name `Source` is not used as its
family name.

The source commit, source/output SHA-256 values, file size and tool version are
recorded in `manifest.json`. `OFL.txt` contains the upstream copyright and SIL
Open Font License 1.1. The font may be embedded and redistributed with this
application under that license. The license does not require generated reports
to be published under OFL.

To reproduce, use Python 3.12 in a local virtual environment, install
`scripts/pdf-font-requirements.txt`, and run `scripts/build_pdf_font.py` from the
repository root. The script verifies the pinned upstream font before writing
anything, instantiates the fixed weight, retains timestamps, emits static TTF,
and rebuilds the character-coverage and license metadata. `--source path.ttf`
can reuse an already downloaded file with the exact required SHA-256.

Normal npm builds use these checked-in assets and need neither Python nor a
Google-hosted font request. PDF assets load only after the download action. Once
the PDF worker and font are ready, they remain in that tab's memory for repeated
downloads, including while offline. Cold offline startup is not supported.

Characters outside the embedded font's coverage cause a visible export error,
preserving the original input rather than silently dropping characters. No
external emoji service is used.
