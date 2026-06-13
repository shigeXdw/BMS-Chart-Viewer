(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEY_CHANNELS = ["1", "2", "3", "4", "5", "8", "9"];
  const LANE_ORDER = { "6": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "8": 6, "9": 7 };
  const AUDIO_EXTENSIONS = new Set([
    ".wav", ".wave", ".ogg", ".oga", ".opus", ".mp3", ".mp2",
    ".m4a", ".aac", ".flac", ".aif", ".aiff", ".weba", ".caf"
  ]);
  const VIDEO_EXTENSIONS = new Set([
    ".mp4", ".m4v", ".webm", ".ogv", ".ogg", ".mov", ".mpeg",
    ".mpg", ".mpe", ".ts", ".m2ts"
  ]);
  const IMAGE_EXTENSIONS = new Set([".bmp", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);
  const DIFFICULTIES = {
    1: ["BEGINNER", "#45dc67"],
    2: ["NORMAL", "#54a8ff"],
    3: ["HYPER", "#ffd642"],
    4: ["ANOTHER", "#ff4d59"],
    5: ["LEGGENDARIA", "#c77dff"]
  };

  const ui = {
    open: $("openButton"),
    openOsz: $("openOszButton"),
    folder: $("folderInput"),
    osz: $("oszInput"),
    select: $("chartSelect"),
    play: $("playButton"),
    stop: $("stopButton"),
    canvas: $("playfield"),
    judgeText: $("judgeText"),
    seek: $("seekInput"),
    back: $("backButton"),
    forward: $("forwardButton"),
    video: $("bga"),
    layerVideo: $("bgaLayerVideo"),
    bgaCanvas: $("bgaCanvas"),
    placeholder: $("moviePlaceholder"),
    title: $("title"),
    artist: $("artist"),
    genre: $("genre"),
    difficulty: $("difficulty"),
    bpm: $("bpm"),
    notes: $("notes"),
    time: $("time"),
    base: $("base"),
    scrollMode: $("scrollMode"),
    scrollModeValue: $("scrollModeValue"),
    speedLabel: $("speedLabel"),
    speed: $("speed"),
    speedValue: $("speedValue"),
    columnWidth: $("columnWidth"),
    columnWidthValue: $("columnWidthValue"),
    scratchWidth: $("scratchWidth"),
    scratchWidthValue: $("scratchWidthValue"),
    noteThickness: $("noteThickness"),
    noteThicknessValue: $("noteThicknessValue"),
    sudden: $("suddenButton"),
    suddenAmount: $("suddenAmount"),
    suddenAmountValue: $("suddenAmountValue"),
    laneArrangement1: $("laneArrangement1"),
    laneArrangement2: $("laneArrangement2"),
    laneArrangement2Label: $("laneArrangement2Label"),
    songSpeed: $("songSpeed"),
    songSpeedValue: $("songSpeedValue"),
    pitchWithSpeed: $("pitchWithSpeed"),
    volume: $("volume"),
    volumeValue: $("volumeValue"),
    keysounds: $("keysounds"),
    hitEffects: $("hitEffects"),
    currentKps: $("currentKps"),
    peakKps: $("peakKps"),
    density: $("density"),
    status: $("status"),
    playerView: $("playerView"),
    inspectorView: $("inspectorView"),
    inspectorTitle: $("inspectorTitle"),
    inspectorSubtitle: $("inspectorSubtitle"),
    inspectorColumnSize: $("inspectorColumnSize"),
    inspectorCurrent: $("inspectorCurrentButton"),
    inspectorFollow: $("inspectorFollow"),
    inspectorScroller: $("inspectorScroller"),
    measureGrid: $("measureGrid"),
    laneDistribution: $("laneDistribution"),
    densityGraph: $("densityGraph"),
    notesRadar: $("notesRadar"),
    analysisNotes: $("analysisNotes"),
    analysisPeak: $("analysisPeak"),
    analysisChord: $("analysisChord"),
    analysisScratch: $("analysisScratch"),
    analysisLong: $("analysisLong"),
    analysisBpm: $("analysisBpm")
  };

  const ctx = ui.canvas.getContext("2d", { alpha: false, desynchronized: true });
  const bgaCtx = ui.bgaCanvas.getContext("2d", { alpha: false });
  const modButtons = [...document.querySelectorAll(".mod-button")];
  const viewButtons = [...document.querySelectorAll(".view-tab")];

  const state = {
    files: new Map(),
    charts: [],
    chart: null,
    audio: null,
    gain: null,
    buffers: new Map(),
    stretchedBuffers: new Map(),
    sources: [],
    scheduled: new Set(),
    hitNotes: new Set(),
    effects: [],
    startAt: 0,
    pausedAt: 0,
    lastTime: 0,
    nextScheduleAt: 0,
    lastUiUpdate: 0,
    frame: 0,
    playing: false,
    seeking: false,
    playGeneration: 0,
    videoUrl: "",
    currentBga: "",
    bgaFallbacks: [],
    bgaFallbackIndex: 0,
    bgaOffset: 0,
    bgaAssets: new Map(),
    bgaBase: null,
    bgaLayer: null,
    bgaWantedBase: "",
    bgaWantedLayer: "",
    bgaPreloadPromise: null,
    bgaRenderToken: 0,
    failedAudio: new Set(),
    peakKps: 0,
    laneMod: "normal",
    laneMappings: [],
    suddenEnabled: false,
    canvasWidth: 1,
    canvasHeight: 1,
    iidxHispeed: 2,
    fixedScrollSpeed: 720,
    palette: {},
    view: "player",
    followedMeasure: -1
  };

  function refreshPalette() {
    const styles = getComputedStyle(document.documentElement);
    for (const name of [
      "--canvas-bg", "--lane-scratch", "--lane-white", "--lane-blue",
      "--lane-border", "--judge-line", "--note-scratch", "--note-white",
      "--note-blue", "--measure-line", "--cover-bg", "--cover-edge"
      , "--ln-body", "--ln-edge"
    ]) {
      state.palette[name] = styles.getPropertyValue(name).trim();
    }
  }

  function themeColor(name) {
    return state.palette[name];
  }

  function normalizePath(value) {
    return value.replaceAll("\\", "/").replace(/^\.?\//, "").toLowerCase();
  }

  function splitFilename(path) {
    const basename = path.split("/").pop();
    const dot = basename.lastIndexOf(".");
    return dot < 0
      ? { basename, stem: basename, extension: "" }
      : { basename, stem: basename.slice(0, dot), extension: basename.slice(dot) };
  }

  function mediaCandidates(path, mediaType) {
    const target = normalizePath(path);
    const exact = state.files.get(target);
    const { basename, stem } = splitFilename(target);
    const family = mediaType === "audio" ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
    const matches = [...state.files.entries()]
      .filter(([key]) => {
        const candidate = splitFilename(key);
        return candidate.stem === stem && family.has(candidate.extension);
      })
      .map(([, file]) => file);

    if (exact) return [exact, ...matches.filter((file) => file !== exact)];
    const basenameMatches = [...state.files.entries()]
      .filter(([key]) => key.endsWith("/" + basename) || key === basename)
      .map(([, file]) => file);
    return [...basenameMatches, ...matches.filter((file) => !basenameMatches.includes(file))];
  }

  function decodeText(file) {
    return file.arrayBuffer().then((data) => {
      try { return new TextDecoder("shift-jis", { fatal: true }).decode(data); }
      catch { return new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, ""); }
    });
  }

  function parseChart(text, name) {
    const lines = text.split(/\r?\n/);
    const header = {};
    const wav = new Map();
    const bmp = new Map();
    const bpmExt = new Map();
    const raw = [];
    let base = 36;

    for (const source of lines) {
      const line = source.trim();
      if (!line || line.startsWith("*")) continue;
      let match;
      if ((match = line.match(/^#BASE\s+(\d+)/i))) {
        base = Number(match[1]) === 62 ? 62 : 36;
      } else if ((match = line.match(/^#WAV([0-9A-Za-z]{2})\s+(.+)$/i))) {
        wav.set(match[1], match[2].trim());
      } else if ((match = line.match(/^#BMP([0-9A-Za-z]{2})\s+(.+)$/i))) {
        bmp.set(match[1], match[2].trim());
      } else if ((match = line.match(/^#BPM([0-9A-Za-z]{2})\s+([\d.]+)/i))) {
        bpmExt.set(match[1], Number(match[2]));
      } else if ((match = line.match(/^#(\d{3})([0-9A-Za-z]{2}):(.+)$/))) {
        raw.push({ measure: Number(match[1]), channel: match[2].toUpperCase(), data: match[3].trim() });
      } else if ((match = line.match(/^#([A-Z][A-Z0-9]*)\s*(.*)$/i))) {
        header[match[1].toUpperCase()] = match[2].trim();
      }
    }

    const measureRatios = new Map();
    for (const row of raw) if (row.channel === "02") measureRatios.set(row.measure, Number(row.data));
    const maxMeasure = Math.max(0, ...raw.map((row) => row.measure));
    const starts = [0];
    for (let measure = 0; measure <= maxMeasure + 1; measure++) {
      starts[measure + 1] = starts[measure] + 4 * (measureRatios.get(measure) || 1);
    }

    const events = [];
    for (const row of raw) {
      if (row.channel === "02") continue;
      const count = Math.floor(row.data.length / 2);
      for (let index = 0; index < count; index++) {
        const object = row.data.slice(index * 2, index * 2 + 2);
        if (object === "00") continue;
        events.push({
          beat: starts[row.measure] + 4 * (measureRatios.get(row.measure) || 1) * index / count,
          measure: row.measure, channel: row.channel, object
        });
      }
    }

    const initialBpm = Number(header.BPM) || 120;
    const bpmChanges = [{ beat: 0, bpm: initialBpm }];
    for (const event of events) {
      if (event.channel === "03") bpmChanges.push({ beat: event.beat, bpm: parseInt(event.object, 16) });
      if (event.channel === "08") bpmChanges.push({ beat: event.beat, bpm: bpmExt.get(event.object) || initialBpm });
    }
    bpmChanges.sort((a, b) => a.beat - b.beat);

    function beatToSeconds(beat) {
      let seconds = 0, cursor = 0, bpm = initialBpm;
      for (const change of bpmChanges) {
        if (change.beat <= cursor) { bpm = change.bpm; continue; }
        if (change.beat >= beat) break;
        seconds += (change.beat - cursor) * 60 / bpm;
        cursor = change.beat;
        bpm = change.bpm;
      }
      return seconds + (beat - cursor) * 60 / bpm;
    }

    for (const change of bpmChanges) change.time = beatToSeconds(change.beat);
    for (const event of events) event.time = beatToSeconds(event.beat);
    function secondsToBeat(seconds) {
      let elapsed = 0, beat = 0, bpm = initialBpm;
      for (const change of bpmChanges) {
        if (change.beat <= beat) { bpm = change.bpm; continue; }
        const segment = (change.beat - beat) * 60 / bpm;
        if (elapsed + segment >= seconds) return beat + (seconds - elapsed) * bpm / 60;
        elapsed += segment;
        beat = change.beat;
        bpm = change.bpm;
      }
      return beat + (seconds - elapsed) * bpm / 60;
    }
    events.sort((a, b) => a.time - b.time);
    const playable = events.filter((event) => /^[12][1-9]$/.test(event.channel));
    const longNotes = events.filter((event) => /^[56][1-9]$/.test(event.channel));
    const longNoteState = new Map();
    for (const event of longNotes) {
      const active = longNoteState.get(event.channel);
      event.longStart = !active;
      if (active) {
        event.longPair = active;
        active.longPair = event;
        longNoteState.delete(event.channel);
      } else {
        longNoteState.set(event.channel, event);
      }
    }
    const duration = Math.max(beatToSeconds(starts[maxMeasure + 1]), ...events.map((event) => event.time));
    const lanes = events.some((event) => /^2[1-9]$/.test(event.channel) || /^6[1-9]$/.test(event.channel)) ? 16 : 8;
    const hitNotes = [...playable, ...longNotes.filter((event) => event.longStart)].sort((a, b) => a.time - b.time);
    const displayNotes = [...playable, ...longNotes].sort((a, b) => a.time - b.time);
    const bgmEvents = events.filter((event) => event.channel === "01");
    const keyEvents = events.filter((event) =>
      /^[12][1-9]$/.test(event.channel) ||
      (/^[56][1-9]$/.test(event.channel) && event.longStart)
    );
    const bgaEvents = events.filter((event) => event.channel === "04");

    return {
      name, header, base, wav, bmp, events, playable, longNotes, bpmChanges,
      duration, lanes, beatToSeconds, secondsToBeat, measureStarts: starts,
      hitNotes, displayNotes, bgmEvents, keyEvents, bgaEvents,
      layerEvents: events.filter((event) => event.channel === "07"),
      poorEvents: events.filter((event) => event.channel === "06"),
      noteCount: Number(header.TOTALNOTES) || playable.length
    };
  }

  function parseBmson(text, name) {
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const info = data.info || {};
    const resolution = Number(info.resolution) || 240;
    const initialBpm = Number(info.init_bpm) || 120;
    const header = {
      TITLE: [info.title, info.subtitle].filter(Boolean).join(" "),
      ARTIST: info.artist || "",
      SUBARTIST: (info.subartists || []).join(", "),
      GENRE: info.genre || "BMSON",
      PLAYLEVEL: String(info.level ?? ""),
      BPM: String(initialBpm),
      DIFFICULTY: String(difficultyFromName(info.chart_name || name))
    };
    const mode = String(info.mode_hint || "beat-7k").toLowerCase();
    const lanes = mode.includes("14k") || mode.includes("10k") ? 16 : 8;
    const bpmRaw = [{ y: 0, bpm: initialBpm }, ...(data.bpm_events || [])]
      .map((event) => ({ y: Number(event.y) || 0, bpm: Number(event.bpm) || initialBpm }))
      .sort((a, b) => a.y - b.y);
    const stops = (data.stop_events || [])
      .map((event) => ({ y: Number(event.y) || 0, duration: Number(event.duration) || 0 }))
      .sort((a, b) => a.y - b.y);

    function pulseToSeconds(pulse) {
      let seconds = 0;
      let cursor = 0;
      let bpm = initialBpm;
      let bpmIndex = 0;
      let stopIndex = 0;
      while (cursor < pulse) {
        const nextBpm = bpmRaw[bpmIndex + 1]?.y ?? Infinity;
        const nextStop = stops[stopIndex]?.y ?? Infinity;
        const next = Math.min(pulse, nextBpm, nextStop);
        seconds += (next - cursor) / resolution * 60 / bpm;
        cursor = next;
        if (cursor === nextBpm) {
          bpmIndex++;
          bpm = bpmRaw[bpmIndex].bpm;
        }
        if (cursor === nextStop && cursor < pulse) {
          seconds += stops[stopIndex].duration / resolution * 60 / bpm;
          stopIndex++;
        } else if (cursor === nextStop) {
          break;
        }
      }
      return seconds;
    }

    function laneChannel(x, long = false) {
      const value = Number(x);
      const prefix = long ? "5" : "1";
      if (lanes === 8) {
        if (value === 8) return prefix + "6";
        return prefix + (KEY_CHANNELS[value - 1] || "1");
      }
      if (value === 8) return prefix + "6";
      if (value === 16) return (long ? "6" : "2") + "6";
      if (value >= 9) return (long ? "6" : "2") + (KEY_CHANNELS[value - 9] || "1");
      return prefix + (KEY_CHANNELS[value - 1] || "1");
    }

    const wav = new Map();
    const bmp = new Map();
    const events = [];
    const visualByPosition = new Map();
    (data.sound_channels || []).forEach((sound, soundIndex) => {
      const object = `bmson-${soundIndex}`;
      wav.set(object, sound.name || "");
      const notes = [...(sound.notes || [])].sort((a, b) => Number(a.y) - Number(b.y));
      const pulseGroups = new Map();
      for (const note of notes) {
        const pulse = Number(note.y) || 0;
        if (!pulseGroups.has(pulse)) pulseGroups.set(pulse, []);
        pulseGroups.get(pulse).push(note);
      }
      const pulses = [...pulseGroups.keys()].sort((a, b) => a - b);
      let restartPulse = 0;
      pulses.forEach((pulse, pulseIndex) => {
        const group = pulseGroups.get(pulse);
        if (group.some((note) => !note.c)) restartPulse = pulse;
        const nextPulse = pulses[pulseIndex + 1];
        const audioOffset = Math.max(0, pulseToSeconds(pulse) - pulseToSeconds(restartPulse));
        const audioDuration = nextPulse == null ? undefined : Math.max(0, pulseToSeconds(nextPulse) - pulseToSeconds(pulse));
        for (const note of group) {
          const x = Number(note.x) || 0;
          const length = Number(note.l) || 0;
          const baseEvent = {
            beat: pulse / resolution,
            pulse,
            measure: 0,
            channel: x === 0 ? "01" : laneChannel(x, length > 0),
            object,
            time: pulseToSeconds(pulse),
            audioOffset,
            audioDuration,
            bmson: true
          };
          events.push(baseEvent);
          if (x > 0) {
            const visualKey = `${x}:${pulse}`;
            if (!visualByPosition.has(visualKey)) visualByPosition.set(visualKey, baseEvent);
            if (length > 0) {
              baseEvent.longStart = true;
              const endEvent = {
                ...baseEvent,
                beat: (pulse + length) / resolution,
                pulse: pulse + length,
                time: pulseToSeconds(pulse + length),
                audioOffset: undefined,
                audioDuration: undefined,
                longStart: false,
                longPair: baseEvent
              };
              baseEvent.longPair = endEvent;
              events.push(endEvent);
            }
          }
        }
      });
    });

    const bga = data.bga || {};
    for (const image of bga.bga_header || []) bmp.set(String(image.id), image.name);
    for (const event of bga.bga_events || []) {
      events.push({ beat: Number(event.y) / resolution, pulse: Number(event.y), measure: 0, channel: "04", object: String(event.id), time: pulseToSeconds(Number(event.y)) });
    }
    for (const event of bga.layer_events || []) {
      events.push({ beat: Number(event.y) / resolution, pulse: Number(event.y), measure: 0, channel: "07", object: String(event.id), time: pulseToSeconds(Number(event.y)), bmsonLayer: true });
    }
    for (const event of bga.poor_events || []) {
      events.push({ beat: Number(event.y) / resolution, pulse: Number(event.y), measure: 0, channel: "06", object: String(event.id), time: pulseToSeconds(Number(event.y)) });
    }

    const maxPulse = Math.max(
      resolution * 4,
      ...events.map((event) => event.pulse || Math.round(event.beat * resolution)),
      ...(data.lines || []).map((line) => Number(line.y) || 0)
    );
    let linePulses = (data.lines || []).map((line) => Number(line.y) || 0).sort((a, b) => a - b);
    if (!linePulses.length) {
      linePulses = [];
      for (let pulse = 0; pulse <= maxPulse + resolution * 4; pulse += resolution * 4) linePulses.push(pulse);
    }
    if (linePulses[0] !== 0) linePulses.unshift(0);
    const measureStarts = linePulses.map((pulse) => pulse / resolution);
    for (const event of events) {
      event.measure = Math.max(0, upperBoundValue(measureStarts, event.beat) - 1);
    }
    events.sort((a, b) => a.time - b.time);
    const bpmChanges = bpmRaw.map((event) => ({ beat: event.y / resolution, bpm: event.bpm, time: pulseToSeconds(event.y) }));
    const playable = [...visualByPosition.values()].filter((event) => !event.longStart);
    const longNotes = events.filter((event) => /^[56]/.test(event.channel));
    const hitNotes = [...visualByPosition.values()].sort((a, b) => a.time - b.time);
    const displayNotes = [...playable, ...longNotes].sort((a, b) => a.time - b.time);
    const bgmEvents = events.filter((event) => event.channel === "01");
    const keyEvents = events.filter((event) => /^[12]/.test(event.channel) || (/^[56]/.test(event.channel) && event.longStart));
    const duration = pulseToSeconds(maxPulse + resolution * 4);

    function beatToSeconds(beat) { return pulseToSeconds(beat * resolution); }
    function secondsToBeat(seconds) {
      let low = 0, high = maxPulse + resolution * 8;
      for (let count = 0; count < 32; count++) {
        const middle = (low + high) / 2;
        if (pulseToSeconds(middle) < seconds) low = middle;
        else high = middle;
      }
      return (low + high) / 2 / resolution;
    }

    return {
      name, header, base: "BMSON", wav, bmp, events, playable, longNotes, bpmChanges,
      duration, lanes, beatToSeconds, secondsToBeat, measureStarts,
      hitNotes, displayNotes, bgmEvents, keyEvents,
      bgaEvents: events.filter((event) => event.channel === "04"),
      layerEvents: events.filter((event) => event.channel === "07"),
      poorEvents: events.filter((event) => event.channel === "06"),
      noteCount: hitNotes.length,
      format: "bmson"
    };
  }

  async function calculateOsuStars(bytes) {
    try {
      if (!globalThis.rosuPp) throw new Error("rosu-pp did not load");
      if (!globalThis.rosuPpReady) {
        const binary = atob(globalThis.ROSU_PP_WASM_BASE64);
        const wasm = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) wasm[index] = binary.charCodeAt(index);
        globalThis.rosuPp.initSync({ module: wasm });
        globalThis.rosuPpReady = true;
        delete globalThis.ROSU_PP_WASM_BASE64;
      }
      const map = new globalThis.rosuPp.Beatmap(bytes);
      const calculator = new globalThis.rosuPp.Difficulty({ lazer: true });
      try {
        if (map.isSuspicious()) return null;
        const attributes = calculator.calculate(map);
        try {
          return attributes.stars;
        } finally {
          attributes.free();
        }
      } finally {
        calculator.free();
        map.free();
      }
    } catch (error) {
      console.warn("Could not calculate osu! star rating", error);
      return null;
    }
  }

  function parseOsuSections(text) {
    const sections = new Map();
    let current = "";
    for (const source of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = source.trim();
      if (!line || line.startsWith("//")) continue;
      const section = line.match(/^\[(.+)]$/);
      if (section) {
        current = section[1];
        sections.set(current, []);
      } else if (current) {
        sections.get(current).push(line);
      }
    }
    return sections;
  }

  function osuPairs(lines = []) {
    const values = {};
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return values;
  }

  function unquote(value) {
    return String(value || "").trim().replace(/^"(.*)"$/, "$1");
  }

  async function parseOsu(bytes, name) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    const sections = parseOsuSections(text);
    const general = osuPairs(sections.get("General"));
    const metadata = osuPairs(sections.get("Metadata"));
    const difficulty = osuPairs(sections.get("Difficulty"));
    if (Number(general.Mode) !== 3) return null;

    const lanes = Math.max(1, Math.min(18, Math.round(Number(difficulty.CircleSize) || 4)));
    const timingPoints = (sections.get("TimingPoints") || [])
      .map((line) => line.split(","))
      .filter((parts) => Number(parts[1]) > 0 && Number(parts[6]) === 1)
      .map((parts) => ({
        time: Number(parts[0]) / 1000,
        beatLength: Number(parts[1]) / 1000,
        meter: Math.max(1, Number(parts[2]) || 4)
      }))
      .sort((a, b) => a.time - b.time);
    if (!timingPoints.length) timingPoints.push({ time: 0, beatLength: 0.5, meter: 4 });

    timingPoints[0].beat = timingPoints[0].time / timingPoints[0].beatLength;
    for (let index = 1; index < timingPoints.length; index++) {
      const previous = timingPoints[index - 1];
      const point = timingPoints[index];
      point.beat = previous.beat + (point.time - previous.time) / previous.beatLength;
    }

    function secondsToBeat(seconds) {
      let point = timingPoints[0];
      for (const candidate of timingPoints) {
        if (candidate.time > seconds) break;
        point = candidate;
      }
      return point.beat + (seconds - point.time) / point.beatLength;
    }

    function beatToSeconds(beat) {
      let point = timingPoints[0];
      for (const candidate of timingPoints) {
        if (candidate.beat > beat) break;
        point = candidate;
      }
      return point.time + (beat - point.beat) * point.beatLength;
    }

    const events = [];
    const playable = [];
    const longNotes = [];
    const wav = new Map();
    const keyEvents = [];
    const sampleObjects = new Map();
    function sampleObject(filename) {
      const path = unquote(filename);
      if (!path) return "osu-hit";
      const key = normalizePath(path);
      if (!sampleObjects.has(key)) {
        const object = `osu-sample-${sampleObjects.size}`;
        sampleObjects.set(key, object);
        wav.set(object, path);
      }
      return sampleObjects.get(key);
    }

    for (const line of sections.get("HitObjects") || []) {
      const parts = line.split(",");
      const x = Number(parts[0]);
      const time = Number(parts[2]) / 1000;
      const type = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(time)) continue;
      const lane = Math.max(0, Math.min(lanes - 1, Math.floor(x * lanes / 512)));
      const beat = secondsToBeat(time);
      const hitSample = String(parts[5] || "").split(":");
      const customFilename = type & 128 ? hitSample.slice(5).join(":") : hitSample.slice(4).join(":");
      const object = sampleObject(customFilename);
      if (type & 128) {
        const endTime = Number(hitSample[0]) / 1000;
        const start = {
          time, beat, lane, measure: 0, channel: "51", object,
          longStart: true, osu: true
        };
        const end = {
          time: Math.max(time, endTime),
          beat: secondsToBeat(Math.max(time, endTime)),
          lane, measure: 0, channel: "51", object,
          longStart: false, longPair: start, osu: true
        };
        start.longPair = end;
        longNotes.push(start, end);
        events.push(start, end);
        if (customFilename) keyEvents.push(start);
      } else {
        const note = { time, beat, lane, measure: 0, channel: "11", object, osu: true };
        playable.push(note);
        events.push(note);
        if (customFilename) keyEvents.push(note);
      }
    }

    const hitNotes = [...playable, ...longNotes.filter((note) => note.longStart)]
      .sort((a, b) => a.time - b.time);
    const duration = Math.max(1, ...events.map((event) => event.time + 2));
    const maxBeat = Math.max(4, secondsToBeat(duration));
    const measureStarts = [];
    for (let beat = 0; beat <= maxBeat + 4; beat += 4) measureStarts.push(beat);
    for (const event of events) {
      event.measure = Math.max(0, upperBoundValue(measureStarts, event.beat) - 1);
    }

    const bgmEvents = [];
    if (general.AudioFilename && findFile(unquote(general.AudioFilename), "audio")) {
      wav.set("osu-audio", unquote(general.AudioFilename));
      const bgm = { time: 0, beat: 0, measure: 0, channel: "01", object: "osu-audio", osu: true };
      events.push(bgm);
      bgmEvents.push(bgm);
    }

    const bmp = new Map();
    const bgaEvents = [];
    for (const line of sections.get("Events") || []) {
      const parts = line.match(/(?:[^,"]+|"[^"]*")+/g) || [];
      if (parts[0] === "0" && parts[2]) {
        bmp.set("osu-bg", unquote(parts[2]));
        bgaEvents.push({ time: 0, beat: 0, measure: 0, channel: "04", object: "osu-bg", osu: true });
        break;
      }
    }

    const stars = await calculateOsuStars(bytes);
    const bpmChanges = timingPoints.map((point) => ({
      time: point.time,
      beat: point.beat,
      bpm: 60 / point.beatLength
    }));
    const version = metadata.Version || "osu!mania";
    return {
      name,
      header: {
        TITLE: metadata.TitleUnicode || metadata.Title || name,
        ARTIST: metadata.ArtistUnicode || metadata.Artist || "",
        SUBARTIST: metadata.Creator ? `mapped by ${metadata.Creator}` : "",
        GENRE: "osu!mania",
        PLAYLEVEL: Number.isFinite(stars) ? stars.toFixed(2) + "★" : "--",
        BPM: String(bpmChanges[0]?.bpm || 120),
        DIFFICULTY: "0",
        OSU_VERSION: version
      },
      base: "osu!",
      wav,
      bmp,
      events: events.sort((a, b) => a.time - b.time),
      playable,
      longNotes,
      bpmChanges,
      duration,
      lanes,
      hasScratch: false,
      beatToSeconds,
      secondsToBeat,
      measureStarts,
      hitNotes,
      displayNotes: [...playable, ...longNotes].sort((a, b) => a.time - b.time),
      bgmEvents,
      keyEvents: keyEvents.sort((a, b) => a.time - b.time),
      bgaEvents,
      layerEvents: [],
      poorEvents: [],
      noteCount: hitNotes.length,
      format: "osu",
      stars
    };
  }

  function lowerBoundTime(items, time) {
    let low = 0, high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (items[middle].time < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBoundTime(items, time) {
    let low = 0, high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (items[middle].time <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function noteSide(event) {
    return event.channel[0] === "2" || event.channel[0] === "6" ? 1 : 0;
  }

  function createFixedMapping(mod) {
    if (mod === "mirror") return [...KEY_CHANNELS].reverse();
    if (mod === "random") return shuffle(KEY_CHANNELS);
    if (mod === "rrandom") {
      const offset = 1 + Math.floor(Math.random() * (KEY_CHANNELS.length - 1));
      return KEY_CHANNELS.map((_, index) => KEY_CHANNELS[(index + offset) % KEY_CHANNELS.length]);
    }
    return [...KEY_CHANNELS];
  }

  function applyLaneMod() {
    const sideCount = state.chart?.lanes === 16 ? 2 : 1;
    state.laneMappings = Array.from({ length: sideCount }, () => createFixedMapping(state.laneMod));
    if (!state.chart) {
      updateLaneArrangement();
      return;
    }

    for (const note of state.chart.displayNotes) note.modKey = note.channel[1];

    if (state.laneMod === "srandom") {
      for (let side = 0; side < sideCount; side++) applySRandom(side);
    } else {
      for (const note of state.chart.displayNotes) {
        if (note.channel[1] === "6") continue;
        const sourceIndex = KEY_CHANNELS.indexOf(note.channel[1]);
        note.modKey = state.laneMappings[noteSide(note)][sourceIndex] || note.channel[1];
      }
    }

    state.hitNotes.clear();
    state.effects = [];
    updateLaneArrangement();
    draw(state.pausedAt);
    if (state.view === "inspector") renderInspector();
  }

  function applySRandom(side) {
    const notes = state.chart.displayNotes.filter((note) =>
      noteSide(note) === side && note.channel[1] !== "6"
    );
    const activeLongNotes = new Map();
    let index = 0;

    while (index < notes.length) {
      const time = notes[index].time;
      const group = [];
      while (index < notes.length && Math.abs(notes[index].time - time) < 0.000001) {
        group.push(notes[index++]);
      }

      for (const note of group.filter((item) => item.longStart === false)) {
        note.modKey = activeLongNotes.get(note.channel) || note.channel[1];
        activeLongNotes.delete(note.channel);
      }

      const occupied = new Set(activeLongNotes.values());
      const available = shuffle(KEY_CHANNELS.filter((key) => !occupied.has(key)));
      const starts = group.filter((item) => item.longStart !== false);
      for (let noteIndex = 0; noteIndex < starts.length; noteIndex++) {
        const note = starts[noteIndex];
        const target = available[noteIndex] || shuffle(KEY_CHANNELS)[0];
        note.modKey = target;
        if (note.longStart) activeLongNotes.set(note.channel, target);
      }
    }
  }

  function arrangementText(mapping) {
    const inverse = KEY_CHANNELS.map((target) => {
      const sourceIndex = mapping.indexOf(target);
      return sourceIndex >= 0 ? String(sourceIndex + 1) : "-";
    });
    return inverse.join(" ");
  }

  function sRandomArrangement(side, time) {
    if (!state.chart) return "no chart";
    const notes = state.chart.hitNotes;
    let index = lowerBoundTime(notes, time);

    while (index < notes.length && (noteSide(notes[index]) !== side || notes[index].channel[1] === "6")) {
      index++;
    }
    if (index >= notes.length) return "end";

    const nextTime = notes[index].time;
    const assignments = [];
    while (index < notes.length && Math.abs(notes[index].time - nextTime) < 0.000001) {
      const note = notes[index++];
      if (noteSide(note) !== side || note.channel[1] === "6") continue;
      const source = KEY_CHANNELS.indexOf(note.channel[1]) + 1;
      const target = KEY_CHANNELS.indexOf(note.modKey) + 1;
      assignments.push(`${source}>${target}`);
    }
    return assignments.join(" ") || "scratch";
  }

  function updateLaneArrangement(time = state.pausedAt) {
    const first = state.laneMappings[0] || KEY_CHANNELS;
    ui.laneArrangement1.value = state.laneMod === "srandom"
      ? sRandomArrangement(0, time)
      : arrangementText(first);
    const doublePlay = state.chart?.lanes === 16;
    ui.laneArrangement2.hidden = !doublePlay;
    ui.laneArrangement2Label.hidden = !doublePlay;
    if (doublePlay) {
      ui.laneArrangement2.value = state.laneMod === "srandom"
        ? sRandomArrangement(1, time)
        : arrangementText(state.laneMappings[1] || KEY_CHANNELS);
    }
    modButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.mod === state.laneMod);
    });
  }

  function findFile(path, mediaType = "") {
    const target = normalizePath(path);
    if (state.files.has(target)) return state.files.get(target);

    const { basename, stem, extension } = splitFilename(target);
    const candidates = [...state.files.entries()].filter(([key]) => key.endsWith("/" + basename) || key === basename);
    if (candidates.length === 1) return candidates[0][1];

    const family = mediaType === "audio"
      ? AUDIO_EXTENSIONS
      : mediaType === "video"
        ? VIDEO_EXTENSIONS
        : mediaType === "image"
          ? IMAGE_EXTENSIONS
        : AUDIO_EXTENSIONS.has(extension)
          ? AUDIO_EXTENSIONS
          : VIDEO_EXTENSIONS.has(extension)
            ? VIDEO_EXTENSIONS
            : IMAGE_EXTENSIONS.has(extension)
              ? IMAGE_EXTENSIONS
            : null;
    if (!family) return null;

    const alternatives = [...state.files.entries()].filter(([key]) => {
      const candidate = splitFilename(key);
      return candidate.stem === stem && family.has(candidate.extension);
    });
    return alternatives.length === 1 ? alternatives[0][1] : null;
  }

  function supportsHevc() {
    return [
      'video/mp4; codecs="hvc1"',
      'video/mp4; codecs="hev1"'
    ].some((type) => ui.video.canPlayType(type) !== "");
  }

  function resetLoadedContent() {
    stop();
    for (const assetPromise of state.bgaAssets.values()) {
      Promise.resolve(assetPromise).then((asset) => {
        if (asset?.kind === "video") URL.revokeObjectURL(asset.url);
        if (asset?.kind === "image") asset.source?.close?.();
      });
    }
    state.bgaAssets.clear();
    state.bgaBase = null;
    state.bgaLayer = null;
    state.files.clear();
    state.charts = [];
  }

  async function loadCollectedFiles() {
    const chartFiles = [...state.files.values()].filter((file) => /\.(bms|bme|bmson|osu)$/i.test(file.name));
    for (const file of chartFiles) {
      try {
        if (/\.osu$/i.test(file.name)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const chart = await parseOsu(bytes, file.name);
          if (chart) state.charts.push(chart);
          continue;
        }
        const text = /\.bmson$/i.test(file.name) ? await file.text() : await decodeText(file);
        state.charts.push(/\.bmson$/i.test(file.name) ? parseBmson(text, file.name) : parseChart(text, file.name));
      } catch (error) {
        console.error(file.name, error);
      }
    }
    state.charts.sort((a, b) => a.name.localeCompare(b.name));
    ui.select.innerHTML = "";
    for (let index = 0; index < state.charts.length; index++) {
      const chart = state.charts[index];
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = chartSelectLabel(chart);
      option.title = chart.name;
      ui.select.append(option);
    }
    ui.select.disabled = !state.charts.length;
    ui.play.disabled = !state.charts.length;
    ui.stop.disabled = !state.charts.length;
    ui.seek.disabled = !state.charts.length;
    ui.back.disabled = !state.charts.length;
    ui.forward.disabled = !state.charts.length;
    if (state.charts.length) selectChart(0);
    ui.status.textContent = `${state.charts.length} chart(s), ${state.files.size} files loaded.`;
  }

  function chartSelectLabel(chart) {
    const title = chart.header.TITLE || chart.name.replace(/\.(bms|bme|bmson|osu)$/i, "");
    if (chart.format === "osu") {
      const rating = Number.isFinite(chart.stars) ? chart.stars.toFixed(2) : "--";
      const version = chart.header.OSU_VERSION || chart.name;
      return `SR ${rating} | ${chart.lanes}K | ${title} [${version}]`;
    }
    const level = chart.header.PLAYLEVEL || "--";
    const difficulty = currentChartDifficultyLabel(chart);
    const playSide = chart.lanes === 16 ? "DP" : "SP";
    return `LV ${level} | ${playSide} | ${title}${difficulty ? ` [${difficulty}]` : ""}`;
  }

  function currentChartDifficultyLabel(chart) {
    const difficulty = Number(chart.header.DIFFICULTY) || difficultyFromName(chart.name);
    return (DIFFICULTIES[difficulty] || [chart.header.CHARTNAME || ""])[0];
  }

  function chartArtistLabel(chart) {
    const artist = chart.header.ARTIST || "Unknown artist";
    const subartist = chart.header.SUBARTIST;
    return subartist ? `${artist} · ${subartist}` : artist;
  }

  async function loadFolder(fileList) {
    resetLoadedContent();
    for (const file of fileList) {
      const relative = file.webkitRelativePath || file.name;
      const parts = relative.split("/");
      parts.shift();
      state.files.set(normalizePath(parts.join("/")), file);
    }
    await loadCollectedFiles();
  }

  async function loadOsz(file) {
    if (!file) return;
    resetLoadedContent();
    ui.status.textContent = `Opening ${file.name}...`;
    try {
      const archive = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
      for (const [path, bytes] of Object.entries(archive)) {
        if (path.endsWith("/")) continue;
        const name = path.split("/").pop();
        state.files.set(normalizePath(path), new File([bytes], name));
      }
      await loadCollectedFiles();
      const skipped = [...state.files.values()].filter((entry) => /\.osu$/i.test(entry.name)).length - state.charts.length;
      if (skipped > 0) {
        ui.status.textContent += ` ${skipped} non-mania chart(s) skipped.`;
      }
    } catch (error) {
      console.error(file.name, error);
      ui.status.textContent = `Could not open ${file.name}.`;
    }
  }

  function selectChart(index) {
    stop();
    state.chart = state.charts[index];
    state.buffers.clear();
    state.stretchedBuffers.clear();
    state.failedAudio.clear();
    state.hitNotes.clear();
    state.effects = [];
    state.lastTime = 0;
    state.peakKps = 0;
    state.followedMeasure = -1;
    const c = state.chart;
    ui.title.textContent = c.header.TITLE || c.name;
    ui.artist.textContent = chartArtistLabel(c);
    ui.genre.textContent = c.header.GENRE || "BMS";
    ui.difficulty.textContent = c.header.PLAYLEVEL || "--";
    if (c.format === "osu") {
      ui.difficulty.dataset.label = "";
      ui.difficulty.style.setProperty("--level-color", osuStarColor(c.stars));
    } else {
      const difficulty = Number(c.header.DIFFICULTY) || difficultyFromName(c.name);
      const levelStyle = DIFFICULTIES[difficulty] || ["CHART", "#d5ff36"];
      ui.difficulty.dataset.label = levelStyle[0];
      ui.difficulty.style.setProperty("--level-color", levelStyle[1]);
    }
    ui.notes.textContent = String(c.noteCount);
    ui.base.textContent = String(c.base);
    updateTempoDisplay(0);
    ui.time.textContent = `00:00 / ${formatTime(c.duration)}`;
    ui.seek.value = "0";
    applyLaneMod();
    updateNoteCounter(0);
    updateLiveStats(0);
    renderInspector();
    state.bgaPreloadPromise = preloadBgaAssets(c);
    updateBga(0);
    draw(0);
  }

  function bpmAt(time) {
    let bpm = Number(state.chart?.header.BPM) || 120;
    for (const change of state.chart?.bpmChanges || []) {
      if (change.time <= time) {
        bpm = change.bpm;
      } else {
        break;
      }
    }
    return bpm;
  }

  function difficultyFromName(name) {
    const value = name.toLowerCase();
    if (value.includes("leggendaria")) return 5;
    if (value.includes("another")) return 4;
    if (value.includes("hyper")) return 3;
    if (value.includes("normal")) return 2;
    if (value.includes("beginner")) return 1;
    return 0;
  }

  function currentDifficultyStyle() {
    const chart = state.chart;
    if (chart?.format === "osu") return [chart.header.OSU_VERSION || "osu!mania", osuStarColor(chart.stars)];
    const difficulty = Number(chart?.header.DIFFICULTY) || difficultyFromName(chart?.name || "");
    return DIFFICULTIES[difficulty] || ["CHART", "#d5ff36"];
  }

  function osuStarColor(stars) {
    const anchors = [
      [0, "#4290fb"], [2, "#4fc0ff"], [2.7, "#4fffd5"], [3.3, "#7cff4f"],
      [4, "#f6f05c"], [4.7, "#ff8068"], [5.3, "#ff4e6f"], [6, "#c645b8"],
      [6.7, "#6563de"], [7.7, "#18158e"], [9, "#000000"]
    ];
    const value = Number.isFinite(stars) ? stars : 0;
    let lower = anchors[0], upper = anchors[anchors.length - 1];
    for (let index = 1; index < anchors.length; index++) {
      if (value <= anchors[index][0]) {
        lower = anchors[index - 1];
        upper = anchors[index];
        break;
      }
    }
    const ratio = Math.max(0, Math.min(1, (value - lower[0]) / Math.max(0.001, upper[0] - lower[0])));
    const rgb = [1, 3, 5].map((offset) => Math.round(
      parseInt(lower[1].slice(offset, offset + 2), 16)
      + (parseInt(upper[1].slice(offset, offset + 2), 16) - parseInt(lower[1].slice(offset, offset + 2), 16)) * ratio
    ));
    return `rgb(${rgb.join(",")})`;
  }

  function playbackSpeed() {
    return Number(ui.songSpeed.value) / 100;
  }

  function hiSpeed() {
    return Number(ui.speed.value) / 100;
  }

  function visibleLaneFraction() {
    return state.suddenEnabled ? 1 - Number(ui.suddenAmount.value) / 100 : 1;
  }

  function greenNumber(time = state.pausedAt) {
    if (!state.chart) return 0;
    const effectiveBpm = bpmAt(time) * playbackSpeed();
    return 240000 / (effectiveBpm * hiSpeed()) * visibleLaneFraction();
  }

  function updateTempoDisplay(time = state.pausedAt) {
    if (!state.chart) return;
    const effectiveBpm = bpmAt(time) * playbackSpeed();
    ui.bpm.textContent = effectiveBpm.toFixed(effectiveBpm % 1 ? 1 : 0);
    if (ui.scrollMode.value === "iidx") {
      ui.scrollModeValue.value = String(Math.round(greenNumber(time)));
    }
  }

  async function getAudioBuffer(object) {
    if (state.buffers.has(object)) return state.buffers.get(object);
    const path = state.chart.wav.get(object);
    const file = path ? findFile(path, "audio") : null;
    if (!file) {
      if (path) state.failedAudio.add(path);
      return null;
    }
    const promise = file.arrayBuffer()
      .then((data) => state.audio.decodeAudioData(data.slice(0)))
      .catch((error) => {
        state.failedAudio.add(file.name);
        console.warn(`Could not decode audio file: ${file.name}`, error);
        return null;
      });
    state.buffers.set(object, promise);
    return promise;
  }

  async function getPlaybackBuffer(object) {
    const buffer = await getAudioBuffer(object);
    const speed = playbackSpeed();
    if (!buffer || ui.pitchWithSpeed.checked || Math.abs(speed - 1) < 0.001) return buffer;

    const key = `${object}:${speed.toFixed(3)}`;
    if (state.stretchedBuffers.has(key)) return state.stretchedBuffers.get(key);
    const promise = Promise.resolve().then(() => stretchAudioBuffer(buffer, speed));
    state.stretchedBuffers.set(key, promise);
    return promise;
  }

  function stretchAudioBuffer(buffer, speed) {
    const windowSize = 2048;
    const synthesisHop = 512;
    const analysisHop = synthesisHop * speed;
    const outputLength = Math.max(
      windowSize,
      Math.ceil(buffer.length / speed) + windowSize
    );
    const output = state.audio.createBuffer(buffer.numberOfChannels, outputLength, buffer.sampleRate);
    const weights = new Float32Array(outputLength);
    const window = new Float32Array(windowSize);

    for (let index = 0; index < windowSize; index++) {
      window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1));
    }

    let inputPosition = 0;
    let outputPosition = 0;
    while (inputPosition + windowSize < buffer.length && outputPosition + windowSize < outputLength) {
      const inputStart = Math.floor(inputPosition);
      const outputStart = Math.floor(outputPosition);
      for (let sample = 0; sample < windowSize; sample++) {
        weights[outputStart + sample] += window[sample];
      }
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const input = buffer.getChannelData(channel);
        const target = output.getChannelData(channel);
        for (let sample = 0; sample < windowSize; sample++) {
          target[outputStart + sample] += input[inputStart + sample] * window[sample];
        }
      }
      inputPosition += analysisHop;
      outputPosition += synthesisHop;
    }

    for (let channel = 0; channel < output.numberOfChannels; channel++) {
      const target = output.getChannelData(channel);
      for (let sample = 0; sample < target.length; sample++) {
        if (weights[sample] > 0.001) target[sample] /= weights[sample];
      }
    }
    return output;
  }

  async function preloadAudio(generation) {
    const needed = [...new Set(
      state.chart.events
        .filter((event) =>
          event.channel === "01" ||
          /^[12][1-9]$/.test(event.channel) ||
          (/^[56][1-9]$/.test(event.channel) && event.longStart)
        )
        .map((event) => event.object)
    )];
    const batchSize = 24;
    ui.play.disabled = true;
    ui.play.textContent = "…";

    for (let start = 0; start < needed.length; start += batchSize) {
      if (generation !== state.playGeneration) return false;
      const batch = needed.slice(start, start + batchSize);
      await Promise.all(batch.map(getPlaybackBuffer));
      const loaded = Math.min(start + batch.length, needed.length);
      ui.status.textContent = `Loading audio: ${loaded} / ${needed.length}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (state.failedAudio.size) {
      ui.status.textContent = `${state.failedAudio.size} audio file(s) could not be decoded by this browser.`;
    } else {
      ui.status.textContent = `${needed.length} audio files loaded. Starting playback.`;
    }
    return true;
  }

  function scheduleAudioWindow(from, until) {
    const groups = ui.keysounds.checked
      ? [state.chart.bgmEvents, state.chart.keyEvents]
      : [state.chart.bgmEvents];
    for (const events of groups) {
      const start = lowerBoundTime(events, from - 0.1);
      const end = upperBoundTime(events, until);
      for (let index = start; index < end; index++) {
        const event = events[index];
        if (state.scheduled.has(event)) continue;
        state.scheduled.add(event);
        getPlaybackBuffer(event.object).then((buffer) => {
          if (!buffer || !state.playing) return;
          const source = state.audio.createBufferSource();
          source.buffer = buffer;
          const changesPitch = ui.pitchWithSpeed.checked;
          const speed = playbackSpeed();
          source.playbackRate.value = changesPitch ? speed : 1;
          source.connect(state.gain);
          const when = Math.max(state.audio.currentTime, state.startAt + event.time / playbackSpeed());
          const offset = Math.max(0, Number(event.audioOffset) || 0) / (changesPitch ? 1 : speed);
          const duration = Number(event.audioDuration) / (changesPitch ? 1 : speed);
          if (duration > 0) source.start(when, offset, duration);
          else source.start(when, offset);
          state.sources.push(source);
        });
      }
    }
  }

  async function resumeActiveBgm(atTime, generation) {
    const speed = playbackSpeed();
    const changesPitch = ui.pitchWithSpeed.checked;
    const pastBgm = state.chart.bgmEvents.slice(0, lowerBoundTime(state.chart.bgmEvents, atTime)).reverse();

    for (const event of pastBgm) {
      const buffer = await getPlaybackBuffer(event.object);
      if (generation !== state.playGeneration || !state.playing) return;
      if (!buffer) continue;

      const currentChartTime = (state.audio.currentTime - state.startAt) * speed;
      const chartElapsed = currentChartTime - event.time;
      const sourceOffset = (Number(event.audioOffset) || 0) / (changesPitch ? 1 : speed);
      const bufferOffset = sourceOffset + (changesPitch ? chartElapsed : chartElapsed / speed);
      if (bufferOffset < 0 || bufferOffset >= buffer.duration) continue;
      const sourceDuration = Number(event.audioDuration) / (changesPitch ? 1 : speed);
      if (sourceDuration > 0 && bufferOffset >= sourceOffset + sourceDuration) continue;

      state.scheduled.add(event);
      const source = state.audio.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = changesPitch ? speed : 1;
      source.connect(state.gain);
      const remaining = sourceDuration > 0
        ? sourceOffset + sourceDuration - bufferOffset
        : undefined;
      if (remaining > 0) source.start(state.audio.currentTime, bufferOffset, remaining);
      else source.start(state.audio.currentTime, bufferOffset);
      state.sources.push(source);
    }
  }

  function stopAudioSources() {
    for (const source of state.sources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    state.sources = [];
    state.scheduled.clear();
  }

  async function play() {
    if (!state.chart || state.playing) return;
    state.audio ||= new AudioContext();
    state.gain ||= state.audio.createGain();
    state.gain.connect(state.audio.destination);
    state.gain.gain.value = Number(ui.volume.value);
    await state.audio.resume();
    const generation = ++state.playGeneration;
    const ready = await preloadAudio(generation);
    if (!ready || generation !== state.playGeneration) return;
    state.sources = [];
    state.scheduled.clear();
    state.hitNotes.clear();
    state.effects = [];
    state.lastTime = state.pausedAt;
    state.startAt = state.audio.currentTime - state.pausedAt / playbackSpeed();
    const offset = state.pausedAt;
    state.nextScheduleAt = offset;
    state.lastUiUpdate = 0;
    state.playing = true;
    state.bgaBase = null;
    state.bgaLayer = null;
    ui.play.disabled = false;
    ui.play.textContent = "■";
    ui.play.title = "Pause";
    if (offset > 0) resumeActiveBgm(offset, generation);
    scheduleAudioWindow(offset, offset + 8);
    ui.status.textContent = state.failedAudio.size
      ? `Playback running with ${state.failedAudio.size} unsupported or missing audio file(s).`
      : "Playback running.";
    tick();
  }

  function pause() {
    if (!state.playing) return;
    state.playGeneration += 1;
    stopAudioSources();
    state.playing = false;
    cancelAnimationFrame(state.frame);
    ui.video.pause();
    ui.layerVideo.pause();
    ui.play.textContent = "▶";
    ui.play.title = "Resume";
    ui.status.textContent = `Paused at ${formatTime(state.pausedAt)}.`;
    draw(state.pausedAt);
  }

  function stop() {
    state.playGeneration += 1;
    stopAudioSources();
    state.hitNotes.clear();
    state.effects = [];
    state.lastTime = 0;
    state.peakKps = 0;
    state.playing = false;
    state.pausedAt = 0;
    cancelAnimationFrame(state.frame);
    ui.play.textContent = "▶";
    ui.play.title = "Play";
    ui.play.disabled = !state.chart;
    updateNoteCounter(0);
    updateLiveStats(0);
    ui.seek.value = "0";
    ui.video.pause();
    ui.video.currentTime = 0;
    ui.layerVideo.pause();
    ui.layerVideo.currentTime = 0;
    state.bgaBase = null;
    state.bgaLayer = null;
    renderBgaFrame();
    draw(0);
    updateInspectorCurrent();
  }

  function tick(frameTime = 0) {
    if (!state.playing) return;
    const time = (state.audio.currentTime - state.startAt) * playbackSpeed();
    if (time >= state.chart.duration) { stop(); return; }
    state.pausedAt = time;
    if (time >= state.nextScheduleAt) {
      scheduleAudioWindow(time, time + 4);
      state.nextScheduleAt = time + 0.25 * playbackSpeed();
    }
    registerHits(state.lastTime, time);
    state.lastTime = time;
    updateBga(time);
    draw(time);
    if (frameTime - state.lastUiUpdate >= 100) {
      updateNoteCounter(time);
      updateLiveStats(time);
      updateLaneArrangement(time);
      updateTempoDisplay(time);
      updateInspectorCurrent();
      ui.time.textContent = `${formatTime(time)} / ${formatTime(state.chart.duration)}`;
      if (!state.seeking) ui.seek.value = String(Math.round(time / state.chart.duration * 1000));
      state.lastUiUpdate = frameTime;
    }
    state.frame = requestAnimationFrame(tick);
  }

  function handleVisibilityChange() {
    if (!state.playing || !state.chart) return;

    const time = (state.audio.currentTime - state.startAt) * playbackSpeed();
    if (document.hidden) {
      // Background tabs throttle animation frames, so queue the remaining
      // keysounds while the page still has an active AudioContext.
      scheduleAudioWindow(time, state.chart.duration);
      return;
    }

    state.pausedAt = time;
    state.lastTime = time;
    updateBga(time);
    draw(time);
  }

  function updateBga(time) {
    updateBgaSlot("base", state.chart.bgaEvents, time);
    updateBgaSlot("layer", state.chart.layerEvents || [], time);
    renderBgaFrame();
  }

  function updateBgaSlot(slotName, events, time) {
    const eventIndex = upperBoundTime(events, time) - 1;
    const event = eventIndex >= 0 ? events[eventIndex] : null;
    const path = event ? state.chart.bmp.get(event.object) : "";
    const current = slotName === "base" ? state.bgaBase : state.bgaLayer;
    if (!path) {
      if (slotName === "base") {
        state.bgaBase = null;
        state.bgaWantedBase = "";
      } else {
        state.bgaLayer = null;
        state.bgaWantedLayer = "";
      }
      return;
    }
    if (current?.path === path) {
      if (current.kind === "video") syncBgaVideo(current, time);
      return;
    }
    if (slotName === "base") state.bgaWantedBase = path;
    else state.bgaWantedLayer = path;
    loadBgaAsset(path, slotName === "layer", Boolean(event?.bmsonLayer)).then((asset) => {
      const wanted = slotName === "base" ? state.bgaWantedBase : state.bgaWantedLayer;
      if (!asset || wanted !== path) return;
      const slot = { ...asset, path, eventTime: event.time };
      if (slotName === "base") state.bgaBase = slot;
      else state.bgaLayer = slot;
      if (slot.kind === "video") {
        const media = slotName === "base" ? ui.video : ui.layerVideo;
        slot.media = media;
        media.src = slot.url;
        media.playbackRate = playbackSpeed();
        media.preservesPitch = !ui.pitchWithSpeed.checked;
        media.currentTime = Math.max(0, time - event.time);
        if (state.playing) media.play().catch(() => {});
      }
      renderBgaFrame();
    });
  }

  async function loadBgaAsset(path, isLayer, preserveAlpha) {
    const cacheKey = `${normalizePath(path)}:${isLayer && !preserveAlpha ? "keyed" : "normal"}`;
    if (state.bgaAssets.has(cacheKey)) return state.bgaAssets.get(cacheKey);
    const promise = (async () => {
      const extension = splitFilename(path).extension;
      if (VIDEO_EXTENSIONS.has(extension)) {
        const file = mediaCandidates(path, "video")[0];
        return file ? { kind: "video", url: URL.createObjectURL(file) } : null;
      }
      const file = findFile(path, "image");
      if (!file || !IMAGE_EXTENSIONS.has(splitFilename(file.name).extension.toLowerCase())) return null;
      let bitmap = await createImageBitmap(file);
      if (isLayer && !preserveAlpha) {
        const keyed = document.createElement("canvas");
        keyed.width = bitmap.width;
        keyed.height = bitmap.height;
        const keyedContext = keyed.getContext("2d", { willReadFrequently: true });
        keyedContext.drawImage(bitmap, 0, 0);
        const pixels = keyedContext.getImageData(0, 0, keyed.width, keyed.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          if (pixels.data[index] <= 2 && pixels.data[index + 1] <= 2 && pixels.data[index + 2] <= 2) {
            pixels.data[index + 3] = 0;
          }
        }
        keyedContext.putImageData(pixels, 0, 0);
        bitmap.close();
        bitmap = await createImageBitmap(keyed);
      }
      return { kind: "image", source: bitmap };
    })();
    state.bgaAssets.set(cacheKey, promise);
    return promise;
  }

  async function preloadBgaAssets(chart) {
    const requests = new Map();
    for (const event of chart.bgaEvents) {
      const path = chart.bmp.get(event.object);
      if (path) requests.set(`${path}:base`, [path, false, true]);
    }
    for (const event of chart.layerEvents || []) {
      const path = chart.bmp.get(event.object);
      if (path) requests.set(`${path}:layer:${Boolean(event.bmsonLayer)}`, [path, true, Boolean(event.bmsonLayer)]);
    }
    const assets = [...requests.values()];
    for (let start = 0; start < assets.length; start += 16) {
      await Promise.all(assets.slice(start, start + 16).map((args) => loadBgaAsset(...args)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function syncBgaVideo(slot, time) {
    if (!slot.media) return;
    const expected = Math.max(0, time - slot.eventTime) / playbackSpeed();
    if (Math.abs(slot.media.currentTime - expected) > 0.18) slot.media.currentTime = expected;
    slot.media.playbackRate = playbackSpeed();
    if (state.playing && slot.media.paused) slot.media.play().catch(() => {});
  }

  function drawBgaSource(source) {
    if (!source) return;
    const width = ui.bgaCanvas.width;
    const height = ui.bgaCanvas.height;
    const sourceWidth = source.videoWidth || source.width;
    const sourceHeight = source.videoHeight || source.height;
    if (!sourceWidth || !sourceHeight) return;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;
    bgaCtx.drawImage(source, (width - targetWidth) / 2, (height - targetHeight) / 2, targetWidth, targetHeight);
  }

  function renderBgaFrame() {
    const rect = ui.bgaCanvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (ui.bgaCanvas.width !== width || ui.bgaCanvas.height !== height) {
      ui.bgaCanvas.width = width;
      ui.bgaCanvas.height = height;
    }
    bgaCtx.clearRect(0, 0, width, height);
    bgaCtx.fillStyle = "#000";
    bgaCtx.fillRect(0, 0, width, height);
    const baseSource = state.bgaBase?.kind === "video" ? state.bgaBase.media : state.bgaBase?.source;
    const layerSource = state.bgaLayer?.kind === "video" ? state.bgaLayer.media : state.bgaLayer?.source;
    drawBgaSource(baseSource);
    drawBgaSource(layerSource);
    ui.placeholder.style.display = baseSource || layerSource ? "none" : "grid";
  }

  async function seekTo(time) {
    if (!state.chart) return;
    const target = Math.max(0, Math.min(state.chart.duration - 0.01, time));
    const resume = state.playing;
    state.playGeneration += 1;
    stopAudioSources();
    state.hitNotes.clear();
    state.effects = [];
    state.pausedAt = target;
    state.lastTime = target;
    state.playing = false;
    updateNoteCounter(target);
    updateLiveStats(target);
    updateLaneArrangement(target);
    updateInspectorCurrent();
    ui.time.textContent = `${formatTime(target)} / ${formatTime(state.chart.duration)}`;
    ui.seek.value = String(Math.round(target / state.chart.duration * 1000));
    ui.video.pause();
    ui.layerVideo.pause();
    state.bgaBase = null;
    state.bgaLayer = null;
    updateBga(target);
    if (resume) await play();
    else draw(target);
  }

  function laneFor(note, lanes) {
    if (typeof note !== "string" && Number.isInteger(note.lane)) return note.modLane ?? note.lane;
    const channel = typeof note === "string" ? note : note.channel;
    const side = Number(channel[0]);
    const key = typeof note === "string" ? channel[1] : (note.modKey || channel[1]);
    const local = LANE_ORDER[key] ?? 0;
    if (lanes === 8) return local;
    if (side === 2 || side === 6) return 8 + (local === 0 ? 7 : local - 1);
    return local;
  }

  function laneGeometry(lanes, fieldWidth, left, hasScratch = true) {
    const scratchRatio = Number(ui.scratchWidth.value) / 100;
    const scratchCount = hasScratch ? (lanes === 16 ? 2 : 1) : 0;
    const regularCount = lanes - scratchCount;
    const unit = fieldWidth / (regularCount + scratchCount * scratchRatio);
    const geometry = [];
    let cursor = left;
    for (let lane = 0; lane < lanes; lane++) {
      const scratch = hasScratch && (lane === 0 || (lanes === 16 && lane === 15));
      const width = unit * (scratch ? scratchRatio : 1);
      geometry.push({ x: cursor, width, scratch });
      cursor += width;
    }
    return geometry;
  }

  function isWhiteKeyLane(lane, lanes, hasScratch = true) {
    if (!hasScratch) return lane % 2 === 0;
    const localLane = lanes === 16 && lane >= 8 ? lane - 7 : lane;
    return localLane % 2 === 1;
  }

  function registerHits(previous, time) {
    if (!state.chart) return;
    const notes = state.chart.hitNotes;
    const start = upperBoundTime(notes, previous);
    const end = upperBoundTime(notes, time);
    for (let index = start; index < end; index++) {
      const note = notes[index];
      if (state.hitNotes.has(note)) continue;
      state.hitNotes.add(note);
      if (ui.hitEffects.checked) {
        state.effects.push({
          lane: laneFor(note, state.chart.lanes),
          started: time,
          color: note.channel[1] === "6" ? "#ffbf2f" : "#65d8ff"
        });
      }
    }
  }

  function updateNoteCounter(time) {
    if (!state.chart) {
      ui.judgeText.textContent = "0000 / 0000";
      return;
    }
    const notes = state.chart.hitNotes;
    const passed = upperBoundTime(notes, time);
    const total = Math.max(state.chart.noteCount, notes.length);
    const width = Math.max(4, String(total).length);
    ui.judgeText.textContent = `${String(passed).padStart(width, "0")} / ${String(total).padStart(width, "0")}`;
  }

  function updateLiveStats(time) {
    if (!state.chart) {
      ui.currentKps.textContent = "0.0";
      ui.peakKps.textContent = "0.0";
      ui.density.textContent = "0";
      return;
    }

    const notes = state.chart.hitNotes;
    const realSecondInChartTime = playbackSpeed();
    const kpsStart = lowerBoundTime(notes, Math.max(0, time - realSecondInChartTime));
    const kpsEnd = upperBoundTime(notes, time);
    const currentKps = kpsEnd - kpsStart;
    if (state.playing) state.peakKps = Math.max(state.peakKps, currentKps);

    const densityWindow = 2 * playbackSpeed();
    const densityStart = lowerBoundTime(notes, Math.max(0, time - densityWindow));
    const densityEnd = upperBoundTime(notes, time);
    const density = (densityEnd - densityStart) / 2;

    ui.currentKps.textContent = currentKps.toFixed(1);
    ui.peakKps.textContent = state.peakKps.toFixed(1);
    ui.density.textContent = density.toFixed(1);
  }

  function switchView(view) {
    state.view = view === "inspector" ? "inspector" : "player";
    ui.playerView.hidden = state.view !== "player";
    ui.inspectorView.hidden = state.view !== "inspector";
    viewButtons.forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (state.view === "inspector") renderInspector();
    else {
      syncCanvasSize();
      draw(state.pausedAt);
      renderBgaFrame();
    }
  }

  function chartAnalysis(chart) {
    const notes = chart.hitNotes;
    let peak = 0;
    let left = 0;
    for (let right = 0; right < notes.length; right++) {
      while (notes[left]?.time < notes[right].time - 1) left++;
      peak = Math.max(peak, right - left + 1);
    }
    const chords = new Map();
    const laneCounts = Array(chart.lanes).fill(0);
    let scratch = 0;
    for (const note of notes) {
      const key = note.beat.toFixed(6);
      chords.set(key, (chords.get(key) || 0) + 1);
      const lane = laneFor(note, chart.lanes);
      laneCounts[lane]++;
      if (chart.hasScratch !== false && (lane === 0 || (chart.lanes === 16 && lane === 15))) scratch++;
    }
    const bpms = chart.bpmChanges.map((change) => change.bpm).filter(Number.isFinite);
    const chordSizes = [...chords.values()].filter((count) => count >= 2);
    const chordNotes = chordSizes.reduce((sum, count) => sum + count, 0);
    const chordExcess = chordSizes.reduce((sum, count) => sum + count - 1, 0);
    const chordRate = chordSizes.length / Math.max(1, chart.duration);
    const averageChordSize = chordSizes.length ? chordNotes / chordSizes.length : 0;
    const longCount = chart.longNotes.filter((note) => note.longStart).length;
    const averageNps = notes.length / Math.max(1, chart.duration);
    const bpmRatio = Math.max(...bpms) / Math.max(1, Math.min(...bpms));
    const soflanChanges = Math.max(0, chart.bpmChanges.length - 1);
    const chordRatio = chordExcess / Math.max(1, notes.length);
    const chordScore = 100 * (
      chordRatio / 0.22 * 0.55
      + chordRate / 1.2 * 0.3
      + Math.max(0, averageChordSize - 2) / 2 * 0.15
    );
    return {
      peak,
      maxChord: Math.max(0, ...chords.values()),
      laneCounts,
      scratch,
      longNotes: longCount,
      minBpm: Math.min(...bpms),
      maxBpm: Math.max(...bpms),
      radar: [
        Math.min(200, averageNps / 8 * 100),
        Math.min(200, peak / 18 * 100),
        Math.min(200, scratch / Math.max(1, notes.length) / 0.2 * 100),
        Math.min(200, ((Math.log2(Math.max(1, bpmRatio)) / 2) + soflanChanges / 24) * 100),
        Math.min(200, longCount / Math.max(1, notes.length) / 0.25 * 100),
        Math.min(200, chordScore)
      ]
    };
  }

  function renderInspector() {
    const chart = state.chart;
    if (!chart) return;
    const analysis = chartAnalysis(chart);
    ui.inspectorTitle.textContent = chart.header.TITLE || chart.name;
    const modLabel = state.laneMod === "rrandom" ? "R-Random"
      : state.laneMod === "srandom" ? "S-Random"
        : state.laneMod[0].toUpperCase() + state.laneMod.slice(1);
    ui.inspectorSubtitle.textContent = `${chartArtistLabel(chart)} · ${chart.lanes === 16 ? "Double play" : "Single play"} · ${chart.measureStarts.length - 1} measures · ${modLabel}`;
    ui.analysisNotes.textContent = String(chart.noteCount);
    ui.analysisPeak.textContent = analysis.peak.toFixed(1);
    ui.analysisChord.textContent = String(analysis.maxChord);
    ui.analysisScratch.textContent = String(analysis.scratch);
    ui.analysisLong.textContent = String(analysis.longNotes);
    ui.analysisBpm.textContent = analysis.minBpm === analysis.maxBpm
      ? String(analysis.minBpm)
      : `${analysis.minBpm}-${analysis.maxBpm}`;
    renderLaneDistribution(analysis.laneCounts);
    renderDensityGraph(chart);
    renderNotesRadar(analysis.radar);
    renderMeasureGrid(chart);
  }

  function renderLaneDistribution(counts) {
    const maximum = Math.max(1, ...counts);
    ui.laneDistribution.replaceChildren();
    counts.forEach((count, lane) => {
      const row = document.createElement("div");
      row.className = "lane-stat";
      const label = document.createElement("span");
      label.textContent = state.chart?.hasScratch !== false && (lane === 0 || (counts.length === 16 && lane === 15))
        ? "SC"
        : String(state.chart?.hasScratch === false ? lane + 1 : counts.length === 16 && lane >= 8 ? lane - 7 : lane);
      const meter = document.createElement("span");
      meter.className = "lane-meter";
      const fill = document.createElement("i");
      fill.style.width = `${count / maximum * 100}%`;
      meter.append(fill);
      const value = document.createElement("b");
      value.textContent = String(count);
      row.append(label, meter, value);
      ui.laneDistribution.append(row);
    });
  }

  function renderDensityGraph(chart) {
    const canvas = ui.densityGraph;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, Math.round(canvas.clientWidth));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight));
    const backingWidth = Math.round(cssWidth * pixelRatio);
    const backingHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const width = cssWidth;
    const height = cssHeight;
    const bins = Math.max(24, Math.ceil(chart.duration / 2));
    const values = Array(bins).fill(0);
    for (const note of chart.hitNotes) {
      const index = Math.min(bins - 1, Math.floor(note.time / chart.duration * bins));
      values[index]++;
    }
    const maximum = Math.max(1, ...values);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0d1014";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#65d8ff";
    context.lineWidth = 2;
    context.beginPath();
    values.forEach((value, index) => {
      const x = index / Math.max(1, bins - 1) * width;
      const y = height - 8 - value / maximum * (height - 18);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    drawDensityProgress(state.pausedAt);
  }

  function drawDensityProgress(time) {
    const chart = state.chart;
    if (!chart) return;
    const canvas = ui.densityGraph;
    const context = canvas.getContext("2d");
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const x = Math.max(1, Math.min(width - 1, time / Math.max(0.001, chart.duration) * width));
    context.save();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.strokeStyle = currentDifficultyStyle()[1];
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    context.fillStyle = currentDifficultyStyle()[1];
    context.beginPath();
    context.moveTo(x - 4, 0);
    context.lineTo(x + 4, 0);
    context.lineTo(x, 6);
    context.closePath();
    context.fill();
    context.restore();
  }

  function renderNotesRadar(values) {
    const canvas = ui.notesRadar;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, Math.round(canvas.clientWidth));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight));
    const backingWidth = Math.round(cssWidth * pixelRatio);
    const backingHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const width = cssWidth;
    const height = cssHeight;
    const centerX = width / 2;
    const centerY = height / 2 + 2;
    const maximumRadius = Math.min(width * 0.4, height * 0.4);
    const radius100 = maximumRadius * 0.68;
    const labels = ["NOTES", "PEAK", "SCRATCH", "SOF-LAN", "CHARGE", "CHORD"];
    const colors = ["#f064cf", "#f6d64a", "#ff7c58", "#6d7cff", "#49d8df", "#b7e65c"];
    const levelColor = currentDifficultyStyle()[1];
    const point = (axis, value = 100) => {
      const angle = -Math.PI / 2 + axis * Math.PI / 3;
      const normalized = Math.max(0, Math.min(200, value));
      const distance = normalized <= 100
        ? radius100 * normalized / 100
        : radius100 + (maximumRadius - radius100) * (normalized - 100) / 100;
      return [centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance];
    };

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0d1014";
    context.fillRect(0, 0, width, height);
    for (let ring = 1; ring <= 4; ring++) {
      context.beginPath();
      for (let axis = 0; axis < 6; axis++) {
        const [x, y] = point(axis, ring * 25);
        if (axis === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.strokeStyle = "rgba(185,205,216,.25)";
      context.lineWidth = ring === 4 ? 2 : 1;
      context.stroke();
    }
    for (let axis = 0; axis < 6; axis++) {
      const [x, y] = point(axis, 200);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(x, y);
      context.strokeStyle = "rgba(185,205,216,.25)";
      context.lineWidth = 1;
      context.stroke();
    }

    context.beginPath();
    values.forEach((value, axis) => {
      const [x, y] = point(axis, Math.max(4, Math.min(200, value)));
      if (axis === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.globalAlpha = 0.48;
    context.fillStyle = levelColor;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = levelColor;
    context.lineWidth = 2;
    context.stroke();

    context.font = "700 12px Segoe UI, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    labels.forEach((label, axis) => {
      const angle = -Math.PI / 2 + axis * Math.PI / 3;
      const labelRadius = maximumRadius + 10;
      const measured = context.measureText(label);
      const halfWidth = measured.width / 2;
      const x = Math.max(
        halfWidth + 4,
        Math.min(width - halfWidth - 4, centerX + Math.cos(angle) * labelRadius)
      );
      const y = Math.max(
        10,
        Math.min(height - 10, centerY + Math.sin(angle) * labelRadius)
      );
      context.fillStyle = colors[axis];
      context.fillText(label, x, y);
    });

    const [scaleX, scaleY] = point(0, 100);
    context.font = "600 9px Segoe UI, Arial, sans-serif";
    context.fillStyle = "#b9cdd8";
    context.fillText("100", scaleX + 12, scaleY + 3);
  }

  function renderMeasureGrid(chart) {
    const measuresPerColumn = Number(ui.inspectorColumnSize.value) || 4;
    const measureCount = Math.max(1, chart.measureStarts.length - 1);
    const groups = Array.from({ length: measureCount }, () => []);
    for (const note of chart.displayNotes) {
      const measure = Math.min(measureCount - 1, Math.max(0, note.measure ?? upperBoundValue(chart.measureStarts, note.beat) - 1));
      groups[measure].push(note);
    }
    ui.measureGrid.replaceChildren();
    state.followedMeasure = -1;
    for (let start = 0; start < measureCount; start += measuresPerColumn) {
      const column = document.createElement("div");
      column.className = "measure-column";
      for (let measure = start; measure < Math.min(measureCount, start + measuresPerColumn); measure++) {
        const card = document.createElement("div");
        card.className = "measure-card";
        card.dataset.measure = String(measure);
        const canvas = document.createElement("canvas");
        canvas.width = 324;
        canvas.height = 348;
        drawMeasure(canvas, chart, measure, groups[measure]);
        const number = document.createElement("span");
        number.className = "measure-number";
        number.textContent = String(measure + 1);
        const progress = document.createElement("i");
        progress.className = "measure-progress";
        card.append(canvas, progress, number);
        column.append(card);
      }
      ui.measureGrid.append(column);
    }
    updateInspectorCurrent();
  }

  function drawMeasure(canvas, chart, measure, notes) {
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const startBeat = chart.measureStarts[measure];
    const endBeat = chart.measureStarts[measure + 1] ?? startBeat + 4;
    const laneWidth = width / chart.lanes;
    context.fillStyle = "#090c0f";
    context.fillRect(0, 0, width, height);
    for (let lane = 0; lane < chart.lanes; lane++) {
      context.fillStyle = chart.hasScratch !== false && (lane === 0 || (chart.lanes === 16 && lane === 15))
        ? "#19140d"
        : isWhiteKeyLane(lane, chart.lanes, chart.hasScratch !== false)
          ? "#171a1e"
          : "#0e1115";
      context.fillRect(lane * laneWidth, 0, laneWidth, height);
      context.strokeStyle = "#34404a";
      context.strokeRect(lane * laneWidth, 0, laneWidth, height);
    }
    if (chart.lanes === 16) {
      const centerX = laneWidth * 8;
      context.fillStyle = "#030506";
      context.fillRect(centerX - 3, 0, 6, height);
      context.fillStyle = "#8fa4b0";
      context.fillRect(centerX - 0.75, 0, 1.5, height);
    }
    context.strokeStyle = "#2e3942";
    for (let division = 1; division < 16; division++) {
      const y = height - division / 16 * height;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const bpmEvents = chart.bpmChanges.filter((event) => event.beat >= startBeat && event.beat < endBeat);
    for (const event of bpmEvents) {
      const y = height - (event.beat - startBeat) / Math.max(0.001, endBeat - startBeat) * height;
      context.strokeStyle = "#ff5265";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    for (const note of notes) {
      const lane = laneFor(note, chart.lanes);
      const y = height - (note.beat - startBeat) / Math.max(0.001, endBeat - startBeat) * height;
      const scratch = chart.hasScratch !== false && (lane === 0 || (chart.lanes === 16 && lane === 15));
      const noteColor = scratch ? "#ffbf2f" : isWhiteKeyLane(lane, chart.lanes, chart.hasScratch !== false) ? "#f3f5f6" : "#377dff";
      context.fillStyle = noteColor;
      if (note.longStart && note.longPair) {
        const pairBeat = Math.min(endBeat, note.longPair.beat);
        const pairY = height - (pairBeat - startBeat) / Math.max(0.001, endBeat - startBeat) * height;
        context.globalAlpha = 0.62;
        context.fillStyle = noteColor;
        context.fillRect(lane * laneWidth + laneWidth * 0.25, pairY, laneWidth * 0.5, Math.max(4, y - pairY));
        context.globalAlpha = 1;
      }
      context.fillStyle = noteColor;
      context.fillRect(lane * laneWidth + 2, y - 3, Math.max(2, laneWidth - 4), 6);
    }
  }

  function updateInspectorCurrent() {
    if (!state.chart || state.view !== "inspector") return;
    const beat = state.chart.secondsToBeat(state.pausedAt);
    const measure = Math.max(0, upperBoundValue(state.chart.measureStarts, beat) - 1);
    for (const card of ui.measureGrid.querySelectorAll(".measure-card")) {
      const current = Number(card.dataset.measure) === measure;
      card.classList.toggle("current", current);
      const progress = card.querySelector(".measure-progress");
      if (progress) {
        const startBeat = state.chart.measureStarts[measure] ?? 0;
        const endBeat = state.chart.measureStarts[measure + 1] ?? startBeat + 4;
        const position = current
          ? Math.max(0, Math.min(1, (beat - startBeat) / Math.max(0.001, endBeat - startBeat)))
          : 0;
        progress.style.display = current ? "block" : "none";
        progress.style.bottom = `${position * 100}%`;
      }
    }
    renderDensityGraph(state.chart);
    if (ui.inspectorFollow.checked && state.followedMeasure !== measure) {
      state.followedMeasure = measure;
      const current = ui.measureGrid.querySelector(".measure-card.current");
      current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }

  function upperBoundValue(items, value) {
    let low = 0, high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (items[middle] <= value) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function lowerBoundBeat(items, beat) {
    let low = 0, high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (items[middle].beat < beat) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function syncCanvasSize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const rect = ui.canvas.getBoundingClientRect();
    const width = Math.floor(rect.width * ratio), height = Math.floor(rect.height * ratio);
    if (ui.canvas.width !== width || ui.canvas.height !== height) {
      ui.canvas.width = width; ui.canvas.height = height;
    }
    state.canvasWidth = rect.width;
    state.canvasHeight = rect.height;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(time) {
    const width = state.canvasWidth, height = state.canvasHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = themeColor("--canvas-bg");
    ctx.fillRect(0, 0, width, height);
    const chart = state.chart;
    const lanes = chart?.lanes || 8;
    const widthScale = Number(ui.columnWidth.value) / 100;
    const idealWidth = (lanes === 16 ? height * 1.28 : height * 0.78) * widthScale;
    const minimumWidth = (lanes === 16 ? 680 : 460) * widthScale;
    const fieldWidth = Math.min(width - 32, Math.max(minimumWidth, idealWidth));
    const left = (width - fieldWidth) / 2;
    const hasScratch = chart?.hasScratch !== false;
    const geometry = laneGeometry(lanes, fieldWidth, left, hasScratch);
    const judgeY = height - 86;

    for (let lane = 0; lane < lanes; lane++) {
      const column = geometry[lane];
      ctx.fillStyle = column.scratch
        ? themeColor("--lane-scratch")
        : isWhiteKeyLane(lane, lanes, hasScratch)
          ? themeColor("--lane-white")
          : themeColor("--lane-blue");
      ctx.fillRect(column.x, 0, column.width, height);
      ctx.strokeStyle = themeColor("--lane-border");
      ctx.beginPath(); ctx.moveTo(column.x, 0); ctx.lineTo(column.x, height); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(left + fieldWidth, 0); ctx.lineTo(left + fieldWidth, height); ctx.stroke();
    if (lanes === 16) {
      const centerX = geometry[8].x;
      ctx.fillStyle = "#030506";
      ctx.fillRect(centerX - 4, 0, 8, height);
      ctx.fillStyle = "#90a8b5";
      ctx.fillRect(centerX - 1, 0, 2, height);
    }
    ctx.strokeStyle = themeColor("--judge-line"); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(left, judgeY); ctx.lineTo(left + fieldWidth, judgeY); ctx.stroke();
    ctx.lineWidth = 1;

    if (chart) {
      const fixedPxPerSecond = Number(ui.speed.value);
      const pixelsPerBeat = judgeY * hiSpeed() / 4;
      const currentBeat = chart.secondsToBeat(time);
      const visibleSeconds = height / Math.max(1, fixedPxPerSecond);
      const lastBeat = Math.ceil(ui.scrollMode.value === "fixed"
        ? chart.secondsToBeat(time + visibleSeconds)
        : currentBeat + height / pixelsPerBeat);

      for (const beat of chart.measureStarts) {
        if (beat < currentBeat || beat > lastBeat) continue;
        const distance = ui.scrollMode.value === "iidx"
          ? (beat - currentBeat) * pixelsPerBeat
          : (chart.beatToSeconds(beat) - time) * fixedPxPerSecond;
        if (distance < 0 || distance > height) continue;
        const y = judgeY - distance;
        ctx.strokeStyle = themeColor("--measure-line");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + fieldWidth, y);
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      const notes = chart.displayNotes;
      const noteThickness = Number(ui.noteThickness.value);
      const noteDistance = (note) => ui.scrollMode.value === "iidx"
        ? (note.beat - currentBeat) * pixelsPerBeat
        : (note.time - time) * fixedPxPerSecond;

      for (const note of chart.longNotes) {
        if (!note.longStart || !note.longPair) continue;
        const startDistance = noteDistance(note);
        const endDistance = noteDistance(note.longPair);
        if (endDistance <= 0 || startDistance > height || endDistance > height && startDistance > height) continue;
        const lane = laneFor(note, lanes);
        const column = geometry[lane];
        const startY = Math.min(judgeY, judgeY - startDistance);
        const endY = Math.max(0, judgeY - endDistance);
        const bodyX = column.x + Math.max(5, column.width * 0.22);
        const bodyWidth = Math.max(4, column.width - Math.max(10, column.width * 0.44));
        const noteColor = column.scratch
          ? themeColor("--note-scratch")
          : isWhiteKeyLane(lane, lanes, hasScratch)
            ? themeColor("--note-white")
            : themeColor("--note-blue");
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = noteColor;
        ctx.fillRect(bodyX, endY, bodyWidth, Math.max(noteThickness, startY - endY));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = noteColor;
        ctx.strokeRect(bodyX + .5, endY + .5, bodyWidth - 1, Math.max(noteThickness, startY - endY) - 1);
        ctx.fillStyle = noteColor;
        ctx.fillRect(column.x + 3, endY - noteThickness / 2, column.width - 6, noteThickness);
        ctx.fillRect(column.x + 3, startY - noteThickness / 2, column.width - 6, noteThickness);
      }

      const visibleStart = upperBoundTime(notes, time);
      const visibleEnd = ui.scrollMode.value === "fixed"
        ? upperBoundTime(notes, time + visibleSeconds)
        : upperBoundTime(notes, chart.beatToSeconds(lastBeat));
      for (let index = visibleStart; index < visibleEnd; index++) {
        const note = notes[index];
        if (/^[56]/.test(note.channel)) continue;
        const delta = note.time - time;
        const distance = noteDistance(note);
        if (distance <= 0 || (ui.scrollMode.value === "fixed" && delta > visibleSeconds) || distance > height) continue;
        const lane = laneFor(note, lanes);
        const column = geometry[lane];
        const y = judgeY - distance;
        ctx.fillStyle = column.scratch
          ? themeColor("--note-scratch")
          : isWhiteKeyLane(lane, lanes, hasScratch)
            ? themeColor("--note-white")
            : themeColor("--note-blue");
        ctx.fillRect(column.x + 3, y - noteThickness / 2, column.width - 6, noteThickness);
        ctx.fillStyle = "rgba(255,255,255,.55)";
        ctx.fillRect(column.x + 4, y - noteThickness / 2 + 1, column.width - 8, Math.min(2, noteThickness));
      }

      if (state.suddenEnabled) {
        const coverHeight = judgeY * Number(ui.suddenAmount.value) / 100;
        ctx.fillStyle = themeColor("--cover-bg");
        ctx.fillRect(left, 0, fieldWidth, coverHeight);
        ctx.fillStyle = themeColor("--cover-edge");
        ctx.fillRect(left, coverHeight - 3, fieldWidth, 3);
        ctx.fillStyle = "rgba(127, 225, 255, .28)";
        ctx.fillRect(left, coverHeight, fieldWidth, 1);
      }

      state.effects = state.effects.filter((effect) => time - effect.started < 0.24);
      for (const effect of state.effects) {
        const column = geometry[effect.lane];
        const age = time - effect.started;
        const life = Math.max(0, 1 - age / 0.24);
        const x = column.x;
        const center = x + column.width / 2;
        const radius = 12 + age * 95;
        const glow = ctx.createRadialGradient(center, judgeY, 0, center, judgeY, radius);
        glow.addColorStop(0, effect.color);
        glow.addColorStop(0.35, effect.color + "99");
        glow.addColorStop(1, effect.color + "00");
        ctx.globalAlpha = life;
        ctx.fillStyle = glow;
        ctx.fillRect(x - radius / 2, judgeY - radius, column.width + radius, radius * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + 3, judgeY - 5, column.width - 6, 10);
        ctx.globalAlpha = 1;
      }
    }
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function updateScrollControls() {
    const iidx = ui.scrollMode.value === "iidx";
    ui.speedLabel.textContent = iidx ? "Hi-Speed" : "Scroll speed";
    if (iidx) {
      ui.speed.min = "1";
      ui.speed.max = "1999";
      ui.speed.step = "1";
      ui.speed.value = String(Math.round(state.iidxHispeed * 100));
      ui.speedValue.min = "0.01";
      ui.speedValue.max = "19.99";
      ui.speedValue.step = "0.01";
      ui.speedValue.value = state.iidxHispeed.toFixed(2);
      updateTempoDisplay();
    } else {
      ui.speed.min = "50";
      ui.speed.max = "2000";
      ui.speed.step = "10";
      ui.speed.value = String(state.fixedScrollSpeed);
      ui.speedValue.min = "50";
      ui.speedValue.max = "2000";
      ui.speedValue.step = "10";
      ui.speedValue.value = String(state.fixedScrollSpeed);
      ui.scrollModeValue.value = "PX";
    }
    draw(state.pausedAt);
  }

  function bindRange(input, output, suffix, onInput = () => draw(state.pausedAt)) {
    input.addEventListener("input", () => {
      output.value = `${input.value}${suffix}`;
      onInput();
    });
  }

  function restartPlaybackForAudioChange() {
    state.stretchedBuffers.clear();
    if (state.chart && state.playing) seekTo(state.pausedAt);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function bindControls() {
    ui.open.addEventListener("click", () => ui.folder.click());
    ui.openOsz.addEventListener("click", () => ui.osz.click());
    ui.folder.addEventListener("change", () => loadFolder(ui.folder.files));
    ui.osz.addEventListener("change", () => loadOsz(ui.osz.files[0]));
    ui.select.addEventListener("change", () => selectChart(Number(ui.select.value)));
    ui.play.addEventListener("click", () => state.playing ? pause() : play());
    ui.stop.addEventListener("click", stop);
    viewButtons.forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });
    ui.inspectorColumnSize.addEventListener("change", renderInspector);
    ui.inspectorCurrent.addEventListener("click", () => {
      updateInspectorCurrent();
      const current = ui.measureGrid.querySelector(".measure-card.current");
      current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
    ui.inspectorFollow.addEventListener("change", () => {
      state.followedMeasure = -1;
      if (ui.inspectorFollow.checked) updateInspectorCurrent();
    });
    ui.densityGraph.addEventListener("click", async (event) => {
      if (!state.chart) return;
      const bounds = ui.densityGraph.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      await seekTo(ratio * state.chart.duration);
      if (!state.playing) await play();
    });

    ui.scrollMode.addEventListener("change", updateScrollControls);
    ui.speed.addEventListener("input", () => {
      if (ui.scrollMode.value === "iidx") {
        state.iidxHispeed = Number(ui.speed.value) / 100;
        ui.speedValue.value = state.iidxHispeed.toFixed(2);
        updateTempoDisplay();
      } else {
        state.fixedScrollSpeed = Number(ui.speed.value);
        ui.speedValue.value = String(state.fixedScrollSpeed);
      }
      draw(state.pausedAt);
    });
    ui.speedValue.addEventListener("input", () => {
      const value = Number(ui.speedValue.value);
      if (!Number.isFinite(value)) return;
      if (ui.scrollMode.value === "iidx") {
        state.iidxHispeed = clamp(value, 0.01, 19.99);
        ui.speed.value = String(Math.round(state.iidxHispeed * 100));
        updateTempoDisplay();
      } else {
        state.fixedScrollSpeed = clamp(value, 50, 2000);
        ui.speed.value = String(state.fixedScrollSpeed);
      }
      draw(state.pausedAt);
    });
    ui.speedValue.addEventListener("change", () => {
      ui.speedValue.value = ui.scrollMode.value === "iidx"
        ? state.iidxHispeed.toFixed(2)
        : String(state.fixedScrollSpeed);
    });
    bindRange(ui.columnWidth, ui.columnWidthValue, "%");
    bindRange(ui.scratchWidth, ui.scratchWidthValue, "%");
    bindRange(ui.noteThickness, ui.noteThicknessValue, "px");
    bindRange(ui.suddenAmount, ui.suddenAmountValue, "%", () => {
      updateTempoDisplay();
      draw(state.pausedAt);
    });

    modButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.laneMod = button.dataset.mod;
        applyLaneMod();
      });
    });

    ui.sudden.addEventListener("click", () => {
      state.suddenEnabled = !state.suddenEnabled;
      ui.sudden.classList.toggle("active", state.suddenEnabled);
      ui.sudden.setAttribute("aria-pressed", String(state.suddenEnabled));
      ui.suddenAmount.disabled = !state.suddenEnabled;
      updateTempoDisplay();
      draw(state.pausedAt);
    });

    ui.songSpeed.addEventListener("input", () => {
      ui.songSpeedValue.value = ui.songSpeed.value;
      updateTempoDisplay();
    });
    ui.songSpeedValue.addEventListener("input", () => {
      const value = Number(ui.songSpeedValue.value);
      if (!Number.isFinite(value)) return;
      const clamped = clamp(value, 50, 200);
      ui.songSpeed.value = String(clamped);
      updateTempoDisplay();
    });
    ui.songSpeed.addEventListener("change", restartPlaybackForAudioChange);
    ui.songSpeedValue.addEventListener("change", () => {
      ui.songSpeedValue.value = ui.songSpeed.value;
      restartPlaybackForAudioChange();
    });
    ui.pitchWithSpeed.addEventListener("change", restartPlaybackForAudioChange);

    ui.volume.addEventListener("input", () => {
      ui.volumeValue.value = `${Math.round(Number(ui.volume.value) * 100)}%`;
      if (state.gain) state.gain.gain.value = Number(ui.volume.value);
    });

    ui.seek.addEventListener("pointerdown", () => {
      state.seeking = true;
    });
    ui.seek.addEventListener("input", () => {
      if (!state.chart) return;
      const target = Number(ui.seek.value) / 1000 * state.chart.duration;
      ui.time.textContent = `${formatTime(target)} / ${formatTime(state.chart.duration)}`;
      draw(target);
    });
    ui.seek.addEventListener("change", async () => {
      state.seeking = false;
      await seekTo(Number(ui.seek.value) / 1000 * state.chart.duration);
    });
    ui.back.addEventListener("click", () => seekTo(state.pausedAt - 10));
    ui.forward.addEventListener("click", () => seekTo(state.pausedAt + 10));
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", async (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)
      )) return;
      if (!state.chart) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (state.playing) pause();
        else await play();
        return;
      }
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        const direction = event.code === "ArrowLeft" ? -1 : 1;
        await seekTo(state.pausedAt + direction * (event.shiftKey ? 10 : 5));
        return;
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        stop();
      }
    });
    for (const media of [ui.video, ui.layerVideo]) {
      media.addEventListener("error", () => {
        ui.status.textContent = "A BGA video could not be decoded by this browser.";
      });
    }
  }

  function initialize() {
    ui.songSpeed.value = "100";
    ui.songSpeedValue.value = "100";
    ui.columnWidth.value = "80";
    ui.columnWidthValue.value = "80%";
    ui.scratchWidth.value = "155";
    ui.scratchWidthValue.value = "155%";

    bindControls();
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("bms-player-theme");
    refreshPalette();

    const canvasObserver = new ResizeObserver(() => {
      syncCanvasSize();
      draw(state.pausedAt);
    });
    canvasObserver.observe(ui.canvas);

    syncCanvasSize();
    updateLaneArrangement();
    updateScrollControls();
    ui.status.textContent += supportsHevc() ? " HEVC is available." : " HEVC is unavailable; compatible video fallbacks will be tried.";
  }

  initialize();
})();
