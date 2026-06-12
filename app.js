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
  const DIFFICULTIES = {
    1: ["BEGINNER", "#45dc67"],
    2: ["NORMAL", "#54a8ff"],
    3: ["HYPER", "#ffd642"],
    4: ["ANOTHER", "#ff4d59"],
    5: ["LEGGENDARIA", "#c77dff"]
  };

  const ui = {
    open: $("openButton"),
    folder: $("folderInput"),
    select: $("chartSelect"),
    play: $("playButton"),
    stop: $("stopButton"),
    canvas: $("playfield"),
    judgeText: $("judgeText"),
    seek: $("seekInput"),
    back: $("backButton"),
    forward: $("forwardButton"),
    video: $("bga"),
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
    status: $("status")
  };

  const ctx = ui.canvas.getContext("2d", { alpha: false, desynchronized: true });
  const modButtons = [...document.querySelectorAll(".mod-button")];

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
    failedAudio: new Set(),
    peakKps: 0,
    laneMod: "normal",
    laneMappings: [],
    suddenEnabled: false,
    canvasWidth: 1,
    canvasHeight: 1
  };

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
      noteCount: Number(header.TOTALNOTES) || playable.length
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
        : AUDIO_EXTENSIONS.has(extension)
          ? AUDIO_EXTENSIONS
          : VIDEO_EXTENSIONS.has(extension)
            ? VIDEO_EXTENSIONS
            : null;
    if (!family) return null;

    const alternatives = [...state.files.entries()].filter(([key]) => {
      const candidate = splitFilename(key);
      return candidate.stem === stem && family.has(candidate.extension);
    });
    return alternatives.length === 1 ? alternatives[0][1] : null;
  }

  async function loadFolder(fileList) {
    stop();
    state.files.clear();
    state.charts = [];
    for (const file of fileList) {
      const relative = file.webkitRelativePath || file.name;
      const parts = relative.split("/");
      parts.shift();
      state.files.set(normalizePath(parts.join("/")), file);
    }
    const chartFiles = [...state.files.values()].filter((file) => /\.(bms|bme)$/i.test(file.name));
    for (const file of chartFiles) {
      try { state.charts.push(parseChart(await decodeText(file), file.name)); }
      catch (error) { console.error(file.name, error); }
    }
    state.charts.sort((a, b) => a.name.localeCompare(b.name));
    ui.select.innerHTML = "";
    for (let index = 0; index < state.charts.length; index++) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = state.charts[index].name;
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
    const c = state.chart;
    ui.title.textContent = c.header.TITLE || c.name;
    ui.artist.textContent = c.header.ARTIST || "Unknown artist";
    ui.genre.textContent = c.header.GENRE || "BMS";
    ui.difficulty.textContent = c.header.PLAYLEVEL || "--";
    const difficulty = Number(c.header.DIFFICULTY) || difficultyFromName(c.name);
    const levelStyle = DIFFICULTIES[difficulty] || ["CHART", "#d5ff36"];
    ui.difficulty.dataset.label = levelStyle[0];
    ui.difficulty.style.setProperty("--level-color", levelStyle[1]);
    ui.notes.textContent = String(c.noteCount);
    ui.base.textContent = String(c.base);
    updateTempoDisplay(0);
    ui.time.textContent = `00:00 / ${formatTime(c.duration)}`;
    ui.seek.value = "0";
    applyLaneMod();
    updateNoteCounter(0);
    updateLiveStats(0);
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
          source.playbackRate.value = ui.pitchWithSpeed.checked ? playbackSpeed() : 1;
          source.connect(state.gain);
          source.start(Math.max(state.audio.currentTime, state.startAt + event.time / playbackSpeed()));
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
      const bufferOffset = changesPitch ? chartElapsed : chartElapsed / speed;
      if (bufferOffset < 0 || bufferOffset >= buffer.duration) continue;

      state.scheduled.add(event);
      const source = state.audio.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = changesPitch ? speed : 1;
      source.connect(state.gain);
      source.start(state.audio.currentTime, bufferOffset);
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
    state.currentBga = "";
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
    state.currentBga = "";
    draw(0);
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
    const eventIndex = upperBoundTime(state.chart.bgaEvents, time) - 1;
    const event = eventIndex >= 0 ? state.chart.bgaEvents[eventIndex] : null;
    const path = event ? state.chart.bmp.get(event.object) : "";
    if (!path || path === state.currentBga) return;
    const file = findFile(path, "video");
    if (!file) return;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);
    state.currentBga = path;
    ui.video.src = state.videoUrl;
    ui.video.style.display = "block";
    ui.placeholder.style.display = "none";
    ui.video.currentTime = Math.max(0, time - event.time);
    ui.video.playbackRate = playbackSpeed();
    ui.video.preservesPitch = !ui.pitchWithSpeed.checked;
    if (state.playing) ui.video.play().catch(() => {});
    else ui.video.pause();
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
    ui.time.textContent = `${formatTime(target)} / ${formatTime(state.chart.duration)}`;
    ui.seek.value = String(Math.round(target / state.chart.duration * 1000));
    ui.video.pause();
    state.currentBga = "";
    updateBga(target);
    if (resume) await play();
    else draw(target);
  }

  function laneFor(note, lanes) {
    const channel = typeof note === "string" ? note : note.channel;
    const side = Number(channel[0]);
    const key = typeof note === "string" ? channel[1] : (note.modKey || channel[1]);
    const local = LANE_ORDER[key] ?? 0;
    if (lanes === 8) return local;
    if (side === 2 || side === 6) return 8 + (local === 0 ? 7 : local - 1);
    return local;
  }

  function laneGeometry(lanes, fieldWidth, left) {
    const scratchRatio = Number(ui.scratchWidth.value) / 100;
    const scratchCount = lanes === 16 ? 2 : 1;
    const regularCount = lanes - scratchCount;
    const unit = fieldWidth / (regularCount + scratchCount * scratchRatio);
    const geometry = [];
    let cursor = left;
    for (let lane = 0; lane < lanes; lane++) {
      const scratch = lane === 0 || (lanes === 16 && lane === 15);
      const width = unit * (scratch ? scratchRatio : 1);
      geometry.push({ x: cursor, width, scratch });
      cursor += width;
    }
    return geometry;
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

    const currentBeat = state.chart.secondsToBeat(time);
    const measure = Math.max(0, upperBoundValue(state.chart.measureStarts, currentBeat) - 1);
    const endMeasure = Math.min(measure + 4, state.chart.measureStarts.length - 1);
    const endBeat = state.chart.measureStarts[endMeasure];
    const densityStart = lowerBoundBeat(notes, currentBeat);
    const densityEnd = lowerBoundBeat(notes, endBeat);

    ui.currentKps.textContent = currentKps.toFixed(1);
    ui.peakKps.textContent = state.peakKps.toFixed(1);
    ui.density.textContent = String(Math.max(0, densityEnd - densityStart));
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
    ctx.fillStyle = "#050607"; ctx.fillRect(0, 0, width, height);
    const chart = state.chart;
    const lanes = chart?.lanes || 8;
    const widthScale = Number(ui.columnWidth.value) / 100;
    const idealWidth = (lanes === 16 ? height * 1.28 : height * 0.78) * widthScale;
    const minimumWidth = (lanes === 16 ? 680 : 460) * widthScale;
    const fieldWidth = Math.min(width - 32, Math.max(minimumWidth, idealWidth));
    const left = (width - fieldWidth) / 2;
    const geometry = laneGeometry(lanes, fieldWidth, left);
    const judgeY = height - 86;

    for (let lane = 0; lane < lanes; lane++) {
      const column = geometry[lane];
      ctx.fillStyle = column.scratch ? "#15120e" : (lane % 2 ? "#171a1e" : "#0e1115 ");
      ctx.fillRect(column.x, 0, column.width, height);
      ctx.strokeStyle = lane === 8 ? "#dce4e9" : "#3d454d";
      ctx.beginPath(); ctx.moveTo(column.x, 0); ctx.lineTo(column.x, height); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(left + fieldWidth, 0); ctx.lineTo(left + fieldWidth, height); ctx.stroke();
    ctx.strokeStyle = "#f23c4d"; ctx.lineWidth = 3;
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
        ctx.strokeStyle = "rgba(210, 226, 235, .46)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + fieldWidth, y);
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      const notes = chart.displayNotes;
      const noteThickness = Number(ui.noteThickness.value);
      const visibleStart = upperBoundTime(notes, time);
      const visibleEnd = ui.scrollMode.value === "fixed"
        ? upperBoundTime(notes, time + visibleSeconds)
        : upperBoundTime(notes, chart.beatToSeconds(lastBeat));
      for (let index = visibleStart; index < visibleEnd; index++) {
        const note = notes[index];
        const delta = note.time - time;
        const distance = ui.scrollMode.value === "iidx"
          ? (note.beat - currentBeat) * pixelsPerBeat
          : delta * fixedPxPerSecond;
        if (distance <= 0 || (ui.scrollMode.value === "fixed" && delta > visibleSeconds) || distance > height) continue;
        const lane = laneFor(note, lanes);
        const column = geometry[lane];
        const y = judgeY - distance;
        ctx.fillStyle = column.scratch ? "#ffbf2f" : (lane % 2 ? "#f1f4f5" : "#5b78ff");
        ctx.fillRect(column.x + 3, y - noteThickness / 2, column.width - 6, noteThickness);
        ctx.fillStyle = "rgba(255,255,255,.55)";
        ctx.fillRect(column.x + 4, y - noteThickness / 2 + 1, column.width - 8, Math.min(2, noteThickness));
      }

      if (state.suddenEnabled) {
        const coverHeight = judgeY * Number(ui.suddenAmount.value) / 100;
        ctx.fillStyle = "rgba(5, 7, 9, .98)";
        ctx.fillRect(left, 0, fieldWidth, coverHeight);
        ctx.fillStyle = "#26323a";
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
      ui.speedValue.value = `${hiSpeed().toFixed(2)}x`;
      updateTempoDisplay();
    } else {
      ui.scrollModeValue.value = "PX";
      ui.speedValue.value = ui.speed.value;
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

  function bindControls() {
    ui.open.addEventListener("click", () => ui.folder.click());
    ui.folder.addEventListener("change", () => loadFolder(ui.folder.files));
    ui.select.addEventListener("change", () => selectChart(Number(ui.select.value)));
    ui.play.addEventListener("click", () => state.playing ? pause() : play());
    ui.stop.addEventListener("click", stop);

    ui.scrollMode.addEventListener("change", updateScrollControls);
    ui.speed.addEventListener("input", updateScrollControls);
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
      ui.songSpeedValue.value = `${ui.songSpeed.value}%`;
      updateTempoDisplay();
    });
    ui.songSpeed.addEventListener("change", restartPlaybackForAudioChange);
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
    ui.video.addEventListener("error", () => {
      const filename = state.currentBga.split(/[\\/]/).pop() || "BGA video";
      ui.status.textContent = `${filename} could not be played by this browser.`;
    });
  }

  function initialize() {
    ui.songSpeed.value = "100";
    ui.songSpeedValue.value = "100%";
    ui.columnWidth.value = "80";
    ui.columnWidthValue.value = "80%";
    ui.scratchWidth.value = "155";
    ui.scratchWidthValue.value = "155%";

    bindControls();

    const canvasObserver = new ResizeObserver(() => {
      syncCanvasSize();
      draw(state.pausedAt);
    });
    canvasObserver.observe(ui.canvas);

    syncCanvasSize();
    updateLaneArrangement();
    updateScrollControls();
  }

  initialize();
})();
