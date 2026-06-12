# BMS Player

A dependency-free browser player for previewing BMS and BME charts. Song files
are read locally and never uploaded.

## Live Player

[Open BMS Player](https://shigexdw.github.io/bms-player/)

## Usage

Open `index.html` in Chrome or Edge, select **Open folder**, and choose the
complete song folder.

## Features

- `#BASE 36` and `#BASE 62`
- BMS/BME encoded as Shift-JIS/CP932 or UTF-8
- 7-key and 14-key charts
- WAV keysounds and BGM channel `01`
- BPM channels `03` and `08`
- Variable measure lengths using channel `02`
- Long-note channels `51-69`
- MP4/WebM BGA using `#BMPxx` and channel `04`
- Multiple videos within one chart
- Normal, Mirror, Random, R-Random, and S-Random lane layouts
- SUDDEN+, IIDX-style Hi-Speed, playback speed, and pitch controls
- KPS, peak KPS, density, and note progress statistics

## GitHub Pages

The project is static and can be hosted directly with GitHub Pages. Publish the
repository root from the `main` branch; no build step or server is required.

## Limitations

This is an autoplay preview. Manual judging, score storage, and BMSON parsing
are not currently included.
